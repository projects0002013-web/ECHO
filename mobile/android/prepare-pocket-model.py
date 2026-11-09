#!/usr/bin/env python3
"""Stage the official 2026-01-26 quantized PocketTTS model into Android assets.

Downloads model weights ONLY during CI (not at runtime). All generation is local.
The build reports archive sha256 so it can be permanently pinned after first CI.
"""
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryFile
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
import time
import tarfile
import json

URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
       "sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2")
EXPECTED_ARCHIVE_SHA256 = "2f3b88823cbbb9bf0b2477ec8ae7b3fec417b3a87b6bb5f256dba66f2ad967cb"
ROOT = Path(__file__).resolve().parent / "app/src/main/assets/pockettts"
MODEL_ROOT = "sherpa-onnx-pocket-tts-int8-2026-01-26/"
FILES = {
    "lm_flow.int8.onnx": 14*1024*1024, "lm_main.int8.onnx": 90*1024*1024,
    "encoder.onnx": 85*1024*1024, "decoder.int8.onnx": 30*1024*1024,
    "text_conditioner.onnx": 25*1024*1024, "vocab.json": 1024*1024,
    "token_scores.json": 1024*1024, "LICENSE": 1024*1024,
}
ROOT.mkdir(parents=True, exist_ok=True)
with TemporaryFile() as archive:
    checksum = None
    for attempt in range(6):
        archive.seek(0)
        archive.truncate(0)
        size = 0
        digest = sha256()
        try:
            with urlopen(URL, timeout=180) as response:
                while chunk:=response.read(1024*1024):
                    size+=len(chunk)
                    if size>130*1024*1024:
                        raise RuntimeError("Unexpected PocketTTS archive size")
                    digest.update(chunk)
                    archive.write(chunk)
            checksum = digest.hexdigest()
            break
        except (HTTPError, URLError, TimeoutError) as error:
            if isinstance(error, HTTPError) and error.code not in (429,500,502,503,504):
                raise
            if attempt==5:
                raise
            delay=min(4*(2**attempt),30)
            print(f"Transient model download error ({type(error).__name__}); retry {attempt+1}/5 in {delay}s",flush=True)
            time.sleep(delay)
    if checksum is None:
        raise RuntimeError("PocketTTS model download failed")
    print("PocketTTS official release archive SHA-256:",checksum)
    if EXPECTED_ARCHIVE_SHA256 and checksum != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError("PocketTTS archive checksum mismatch")
    archive.seek(0)
    manifest={}
    total=0
    with tarfile.open(fileobj=archive,mode="r:bz2") as contents:
        for member in contents:
            if not member.isfile() or not member.name.startswith(MODEL_ROOT):
                continue
            name=member.name[len(MODEL_ROOT):]
            if name not in FILES:
                continue
            if name in manifest or member.size<=0 or member.size>FILES[name]:
                raise RuntimeError("Invalid model archive entry: "+name)
            total+=member.size
            if total>245*1024*1024:
                raise RuntimeError("Model size limit exceeded")
            payload=contents.extractfile(member)
            if payload is None:
                raise RuntimeError("Cannot read "+name)
            dest=ROOT/name
            hashfile=sha256()
            with dest.open("wb") as out:
                count=0
                while block:=payload.read(1024*1024):
                    count+=len(block)
                    if count>FILES[name]:
                        raise RuntimeError("Oversized model file")
                    hashfile.update(block)
                    out.write(block)
            if count != member.size:
                raise RuntimeError("Truncated model file "+name)
            manifest[name]=hashfile.hexdigest()
    if set(manifest)!=set(FILES):
        raise RuntimeError("Missing PocketTTS files: "+repr(set(FILES)-set(manifest)))
    (ROOT/"hashes.json").write_text(json.dumps(manifest,sort_keys=True),encoding="utf-8")
    print("PocketTTS model staged into Android assets:",total,"bytes")
