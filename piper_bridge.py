"""ECHO Piper Bridge: local HTTP speech synthesis using Piper Python API.

Run from the ECHO virtual environment: python piper_bridge.py
Place .onnx and matching .onnx.json files in piper_models/.
"""
import io
import json
import logging
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from piper import PiperVoice

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "piper_models"
MODELS.mkdir(exist_ok=True)
MAX_CHARS = 300
MAX_REQUEST_BYTES = 4096

# Keep one model cached at a time to limit memory use.
_voice_lock = threading.Lock()
_cached_voice_id = None
_cached_voice = None


def voices():
    result = []
    for model in sorted(MODELS.glob("*.onnx")):
        if Path(str(model) + ".json").is_file():
            result.append({"id": model.stem, "label": model.stem.replace("_", " ")})
    return result


def synthesize(voice_id, text):
    global _cached_voice_id, _cached_voice
    # Lock protects the cache and prevents concurrent inference on the same voice.
    with _voice_lock:
        if _cached_voice_id != voice_id:
            model_path = MODELS / (voice_id + ".onnx")
            new_voice = PiperVoice.load(str(model_path))
            _cached_voice = new_voice
            _cached_voice_id = voice_id
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            _cached_voice.synthesize_wav(text, wav_file)
        audio = buffer.getvalue()
        if len(audio) <= 44:
            raise RuntimeError("Piper produced empty audio")
        return audio


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self.respond(204, b"", "text/plain")

    def do_GET(self):
        if urlparse(self.path).path == "/api/voices":
            self.respond(200, json.dumps(voices(), ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")
        else:
            self.respond(404, b"Not found", "text/plain")

    def do_POST(self):
        if urlparse(self.path).path != "/api/tts":
            return self.respond(404, b"Not found", "text/plain")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST_BYTES:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            voice = data.get("voice")
            text = data.get("text")
            if not isinstance(voice, str) or not isinstance(text, str):
                raise ValueError("Voice and text must be strings")
            text = text.strip()
            if not 0 < len(text) <= MAX_CHARS:
                raise ValueError("Text must contain 1-300 characters")
            if voice not in {item["id"] for item in voices()}:
                raise ValueError("Unknown voice. Check model files")
            audio = synthesize(voice, text)
            self.respond(200, audio, "audio/wav")
        except (ValueError, json.JSONDecodeError) as exc:
            self.respond(400, str(exc).encode("utf-8"), "text/plain; charset=utf-8")
        except Exception as exc:
            logging.exception("Piper synthesis failed")
            self.respond(503, ("Piper unavailable: " + str(exc)).encode("utf-8"), "text/plain; charset=utf-8")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("ECHO Piper Bridge: http://127.0.0.1:8765", flush=True)
    print("Available models:", len(voices()), flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
