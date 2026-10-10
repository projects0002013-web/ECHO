"""Local ECHO app and voice cloning server. No cloud synthesis or telemetry."""
import argparse
import base64
import binascii
import importlib.util
import hashlib
import io
import json
import os
import tempfile
import threading
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
MODEL_FILES = ("ve.pt", "s3gen.pt", "t3_mtl23ls_v2.safetensors",
               "grapheme_mtl_merged_expanded_v1.json")
LANGUAGES = ("ru", "en")  # Product languages with a personal-voice UI.
PUBLIC_FILES = {"index.html", "script.js", "style.css", "features.js", "features.css",
                "recorder-worklet.js", "sw.js", "manifest.json", "icon-192.png", "icon-512.png", "cover.png"}
MAX_REQUEST = 8 * 1024 * 1024


class VoiceEngine:
    def __init__(self, model_dir, device="cpu"):
        self.model_dir = Path(model_dir)
        self.device = device
        self.model = None
        self.lock = threading.Lock()

    def receipt(self):
        try:
            receipt = json.loads((self.model_dir / "echo-manifest.json").read_text())
            if receipt.get("repository") != "ResembleAI/chatterbox":
                return None
            if not all(isinstance(receipt.get("checksums", {}).get(name), str) for name in MODEL_FILES):
                return None
            return receipt
        except (OSError, ValueError):
            return None

    def verify_weights(self):
        receipt = self.receipt()
        if not receipt:
            raise RuntimeError("Download and verify the model using download_voice_model.py.")
        for name in MODEL_FILES:
            path = self.model_dir / name
            expected = receipt["checksums"][name]
            digest = hashlib.sha256() if len(expected) == 64 else hashlib.sha1()
            if len(expected) != 64:
                digest.update(f"blob {path.stat().st_size}\0".encode())
            with path.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""): digest.update(block)
            if digest.hexdigest() != expected:
                raise RuntimeError("Model checksum mismatch. Download verified weights again.")

    def status(self):
        installed = importlib.util.find_spec("chatterbox") is not None
        missing = [name for name in MODEL_FILES if not (self.model_dir / name).is_file()]
        return {"engine": "Chatterbox Multilingual", "installed": installed,
                "ready": installed and not missing and self.receipt() is not None, "missing_models": missing,
                "loaded": self.model is not None, "languages": LANGUAGES,
                "local_only": True, "device": self.device}

    def synthesize(self, text, language, reference):
        if not self.status()["ready"]:
            raise RuntimeError("Локальная модель не установлена. Выполните инструкции из README.")
        # One inference at a time: model conditionals contain the current speaker.
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("Предыдущая фраза ещё обрабатывается. Подождите и повторите.")
        try:
            # Never download weights or send a recording during a synthesis request.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
            os.environ["HF_HOME"] = str(ROOT / ".voice-cache")
            os.environ["PKUSEG_HOME"] = str(ROOT / ".voice-cache" / "pkuseg")
            import torch
            import soundfile as sf
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            if self.model is None:
                self.verify_weights()
                torch.set_num_threads(min(4, os.cpu_count() or 1))
                self.model = ChatterboxMultilingualTTS.from_local(self.model_dir, self.device)
            # Private temporary input, removed even if loading/inference fails.
            with tempfile.TemporaryDirectory(prefix="echo-voice-") as directory:
                sample = Path(directory) / "reference.wav"
                sample.write_bytes(reference)
                with torch.inference_mode():
                    audio = self.model.generate(text, language_id=language,
                                                audio_prompt_path=str(sample))
                result = io.BytesIO()
                sf.write(result, audio.squeeze(0).detach().cpu().numpy(), self.model.sr,
                         format="WAV", subtype="PCM_16")
                return result.getvalue()
        finally:
            self.lock.release()


def validate_payload(data):
    if not isinstance(data, dict):
        raise ValueError("Ожидается JSON-объект.")
    text = data.get("text")
    language = data.get("language", "ru")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 300:
        raise ValueError("Введите от 1 до 300 символов.")
    if language not in LANGUAGES:
        raise ValueError("Этот язык пока не поддерживает персональный голос. Выберите голос устройства.")
    encoded = data.get("reference")
    if not isinstance(encoded, str):
        raise ValueError("Добавьте образец своего голоса.")
    try:
        audio = base64.b64decode(encoded, validate=True)
        with wave.open(io.BytesIO(audio)) as wav:
            duration = wav.getnframes() / wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise ValueError("Нужна монофоническая запись WAV PCM 16 бит.")
            if not 8000 <= wav.getframerate() <= 96000 or not 6 <= duration <= 30:
                raise ValueError("Образец голоса должен длиться от 6 до 30 секунд.")
            if len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2:
                raise ValueError("Запись повреждена или неполная.")
    except (binascii.Error, wave.Error, EOFError, ZeroDivisionError) as exc:
        raise ValueError("Не удалось прочитать запись WAV.") from exc
    return text.strip(), language, audio


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond(self, status, data, mime="application/json; charset=utf-8"):
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def allowed_host(self):
        # Block DNS rebinding and cross-origin access to local voice inference.
        host = self.headers.get("Host", "")
        return host in {f"127.0.0.1:{self.server.server_port}",
                        f"localhost:{self.server.server_port}"}

    def public_path(self):
        path = urlparse(self.path).path.lstrip("/") or "index.html"
        return path in PUBLIC_FILES or (path.startswith("fonts/") and
               Path(path).name.endswith(".woff2") and len(Path(path).parts) == 2)

    def do_GET(self):
        if not self.allowed_host():
            return self.respond(403, {"error": "Используйте локальный адрес приложения."})
        if urlparse(self.path).path == "/api/voice/status":
            return self.respond(200, self.server.engine.status())
        if not self.public_path():
            return self.respond(404, {"error": "Not found"})
        super().do_GET()

    def do_HEAD(self):
        if not self.allowed_host() or not self.public_path():
            return self.respond(404, {"error": "Not found"})
        super().do_HEAD()

    def do_POST(self):
        if not self.allowed_host():
            return self.respond(403, {"error": "Invalid host"})
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + self.headers.get("Host", ""):
            return self.respond(403, {"error": "Запрос разрешён только из локального ECHO."})
        if urlparse(self.path).path != "/api/voice/synthesize":
            return self.respond(404, {"error": "Not found"})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.respond(415, {"error": "Ожидается application/json."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST:
                return self.respond(413, {"error": "Запись слишком большая."})
            text, language, reference = validate_payload(json.loads(self.rfile.read(length)))
            audio = self.server.engine.synthesize(text, language, reference)
            self.respond(200, audio, "audio/wav")
        except (ValueError, UnicodeDecodeError) as exc:
            self.respond(400, {"error": str(exc)})
        except BlockingIOError as exc:
            self.respond(429, {"error": str(exc)})
        except Exception:
            # Do not log text, audio, request bodies, or private file paths.
            self.respond(503, {"error": "Локальный синтез недоступен. Проверьте модель и зависимости по README."})

    def log_message(self, fmt, *args):
        # Access logs do not retain communication history.
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--model-dir", type=Path, default=ROOT / "voice_models")
    parser.add_argument("--device", choices=("cpu", "cuda", "mps"), default="cpu")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.engine = VoiceEngine(args.model_dir, args.device)
    print(f"ECHO: http://127.0.0.1:{args.port} — данные остаются на этом устройстве", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
