"""Real-model integration check. Requires downloaded weights and a 6–30s WAV."""
import argparse
import base64
import io
import json
from pathlib import Path
import urllib.error
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path(".test-output/personal-voice.wav"))
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    status = json.load(urllib.request.urlopen(args.url + "/api/voice/status"))
    if not status["ready"]:
        raise RuntimeError("Install the local model first; a missing-model check does not validate voice cloning.")
    request = urllib.request.Request(args.url + "/api/voice/synthesize",
        data=json.dumps({"text": "Я могу говорить новые фразы своим голосом.", "language": "ru",
                         "reference": base64.b64encode(args.reference.read_bytes()).decode()}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=240) as response:
        assert response.headers.get_content_type() == "audio/wav"
        audio = response.read()
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
        assert wav.getnframes() > 0
        duration = wav.getnframes() / wav.getframerate()
        assert 0.1 < duration < 120
        assert any(wav.readframes(wav.getnframes())), "Generated audio is silent"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(audio)
    print(json.dumps({"real_model_synthesis": "passed", "duration_seconds": round(duration, 2),
                      "output": str(args.output), "similarity": "requires listening with the reference speaker"}))


if __name__ == "__main__": main()
