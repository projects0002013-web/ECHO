#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --no-cache-dir piper-tts==1.4.2 playwright==1.58.0
.venv/bin/python -m pip check
if [[ "${1:-}" == "--voice" ]]; then
  python3 -m venv .voice-venv
  .voice-venv/bin/python -m pip install --no-cache-dir torch==2.6.0+cpu torchaudio==2.6.0+cpu --index-url https://download.pytorch.org/whl/cpu
  .voice-venv/bin/python -m pip install --no-cache-dir -r requirements-voice-lock.txt
  .voice-venv/bin/python -m pip check
  HF_HOME="$PWD/.voice-cache" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .voice-venv/bin/python -c 'from chatterbox.mtl_tts import ChatterboxMultilingualTTS'
  # Official HTTPS download verifies every required weight against repository metadata.
  if [[ -f voice_models/echo-manifest.json ]]; then
    echo_model_revision=$(.voice-venv/bin/python -c 'import json; print(json.load(open("voice_models/echo-manifest.json"))["revision"])')
    .voice-venv/bin/python download_voice_model.py --revision "$echo_model_revision"
  else
    .voice-venv/bin/python download_voice_model.py
  fi
elif [[ -n "${1:-}" ]]; then
  echo "Usage: bash scripts/setup.sh [--voice]" >&2
  exit 2
fi
