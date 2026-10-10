import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from echo_server import Handler, ThreadingHTTPServer, VoiceEngine, validate_payload, MODEL_FILES


def wav_bytes(seconds=7, rate=16000, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(struct.pack("<h", 2000) * int(rate * seconds) * channels)
    return output.getvalue()


def payload(**changes):
    data = {"text": "Привет", "language": "ru", "reference": base64.b64encode(wav_bytes()).decode()}
    data.update(changes)
    return data


class Validation(unittest.TestCase):
    def test_valid_audio_and_text(self):
        text, language, audio = validate_payload(payload(text="  Привет  "))
        self.assertEqual((text, language, audio), ("Привет", "ru", wav_bytes()))

    def test_invalid_text(self):
        for value in (None, 42, "", "  ", "а" * 301):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_payload(payload(text=value))

    def test_unsupported_language(self):
        with self.assertRaises(ValueError): validate_payload(payload(language="kk"))

    def test_audio_length_and_channels(self):
        for audio in (wav_bytes(1), wav_bytes(31), wav_bytes(channels=2)):
            with self.subTest(size=len(audio)), self.assertRaises(ValueError):
                validate_payload(payload(reference=base64.b64encode(audio).decode()))

    def test_corrupt_reference(self):
        for reference in ("%bad", base64.b64encode(b"not a wav").decode(), None,
                          base64.b64encode(wav_bytes()[:-12]).decode()):
            with self.subTest(reference_type=type(reference)), self.assertRaises(ValueError):
                validate_payload(payload(reference=reference))

    def test_missing_model_never_generates_fake_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = VoiceEngine(directory)
            self.assertFalse(engine.status()["ready"])
            with self.assertRaises(RuntimeError): engine.synthesize("Привет", "ru", wav_bytes())

    def test_model_files_without_verified_receipt_are_not_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in MODEL_FILES: (Path(directory) / name).write_bytes(b'unverified')
            engine = VoiceEngine(directory)
            self.assertFalse(engine.status()['ready'])
            with self.assertRaises(RuntimeError): engine.verify_weights()

    def test_changed_model_is_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            hashes = {}
            for name in MODEL_FILES:
                data = name.encode(); (Path(directory) / name).write_bytes(data)
                hashes[name] = hashlib.sha256(data).hexdigest()
            (Path(directory) / 'echo-manifest.json').write_text(json.dumps({'repository': 'ResembleAI/chatterbox', 'checksums': hashes}))
            engine = VoiceEngine(directory); engine.verify_weights()
            (Path(directory) / MODEL_FILES[0]).write_bytes(b'changed')
            with self.assertRaises(RuntimeError): engine.verify_weights()


class LocalHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.engine = VoiceEngine(cls.directory.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        cls.directory.cleanup()

    def request(self, path, body=None, headers=None):
        request = urllib.request.Request(self.url + path, data=body, headers=headers or {})
        try: response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error: response = error
        with response: return response.status, response.headers, response.read()

    def test_app_is_served(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"features.js", body)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_private_and_source_files_are_not_served(self):
        for path in ("/.git/config", "/.voice-venv/pyvenv.cfg", "/echo_server.py", "/denis_test.wav", "/fonts/../echo_server.py"):
            with self.subTest(path=path): self.assertEqual(self.request(path)[0], 404)

    def test_dns_rebinding_host_is_rejected(self):
        self.assertEqual(self.request("/api/voice/status", headers={"Host": "evil.example"})[0], 403)

    def test_engine_status_is_honest_and_not_cached(self):
        status, headers, body = self.request("/api/voice/status")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["ready"])
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_cross_origin_upload_rejected(self):
        self.assertEqual(self.request("/api/voice/synthesize", b"{}", {"Content-Type": "application/json", "Origin": "https://evil.example"})[0], 403)

    def test_validation_errors(self):
        self.assertEqual(self.request("/api/voice/synthesize", b"{}", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("/api/voice/synthesize", b"{}", {"Content-Type": "text/plain"})[0], 415)

    def test_missing_model_http_503(self):
        self.assertEqual(self.request("/api/voice/synthesize", json.dumps(payload()).encode(), {"Content-Type": "application/json"})[0], 503)


if __name__ == "__main__":
    unittest.main()
