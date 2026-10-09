"""ECHO Piper Bridge: local-only HTTP adapter for installed Piper CLI.
Run: python piper_bridge.py
Install Piper CLI separately; put matching .onnx + .onnx.json in piper_models/.
"""
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "piper_models"
MODELS.mkdir(exist_ok=True)
MAX_CHARS = 300


def voices():
    result = []
    for model in sorted(MODELS.glob("*.onnx")):
        if not Path(str(model) + ".json").is_file():
            continue
        result.append({"id": model.stem, "label": model.stem.replace("_", " ")})
    return result


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
        self.wfile.write(content)

    def do_OPTIONS(self):
        self.respond(204, b"", "text/plain")

    def do_GET(self):
        if urlparse(self.path).path == "/api/voices":
            self.respond(200, json.dumps(voices()).encode(), "application/json")
        else:
            self.respond(404, b"Not found", "text/plain")

    def do_POST(self):
        if urlparse(self.path).path != "/api/tts":
            return self.respond(404, b"Not found", "text/plain")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(length))
            voice = str(data.get("voice", ""))
            text = str(data.get("text", "")).strip()
            if not 0 < len(text) <= MAX_CHARS:
                raise ValueError("Text must contain 1-300 characters")
            models = {item["id"]: MODELS / (item["id"] + ".onnx") for item in voices()}
            if voice not in models:
                raise ValueError("Unknown voice. Check model files")
            with tempfile.TemporaryDirectory() as tmp:
                wave = Path(tmp) / "output.wav"
                # No shell; voice name can only select an existing local model.
                subprocess.run(["piper", "--model", str(models[voice]), "--output_file", str(wave)],
                               input=text, text=True, capture_output=True, check=True, timeout=30)
                audio = wave.read_bytes()
            self.respond(200, audio, "audio/wav")
        except (ValueError, json.JSONDecodeError) as exc:
            self.respond(400, str(exc).encode(), "text/plain; charset=utf-8")
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            self.respond(503, ("Piper unavailable: " + str(exc)).encode(), "text/plain; charset=utf-8")


if __name__ == "__main__":
    print("ECHO Piper Bridge: http://127.0.0.1:8765")
    print("Available models:", len(voices()))
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
