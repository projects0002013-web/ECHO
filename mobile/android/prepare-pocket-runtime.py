#!/usr/bin/env python3
"""Fetch pinned, independently checksummed official sherpa-onnx 2.0.1 JNI and Java API.

Run before Android Gradle. No voice samples, model files or tokens are downloaded.
The model itself remains an explicit offline user-installed prerequisite.
"""
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile
from io import BytesIO

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/"
ASSETS = {
    "sherpa-onnx-jvm-2.0.1.jar": "8320e2457b6e38dd624fb619d3552e11ef78ffeb394622056126b16f2fd99d12",
    "sherpa-onnx-2.0.1.aar": "a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7",
}
ROOT = Path(__file__).resolve().parent / "app"
LIB = ROOT / "libs"
JNI = ROOT / "src/main/jniLibs/arm64-v8a"
LIB.mkdir(parents=True, exist_ok=True)
JNI.mkdir(parents=True, exist_ok=True)


def obtain(name):
    with urlopen(BASE + name, timeout=120) as response:
        payload = response.read()
    digest = sha256(payload).hexdigest()
    if digest != ASSETS[name]:
        raise RuntimeError(f"Official checksum mismatch: {name} {digest}")
    return payload


jar = obtain("sherpa-onnx-jvm-2.0.1.jar")
(LIB / "sherpa-onnx-jvm-2.0.1.jar").write_bytes(jar)
aar = obtain("sherpa-onnx-2.0.1.aar")
with ZipFile(BytesIO(aar)) as archive:
    libs = [n for n in archive.namelist() if n.startswith("jni/arm64-v8a/") and n.endswith(".so")]
    if not libs:
        raise RuntimeError("Verified release does not contain Android arm64 JNI libraries")
    for entry in libs:
        target = JNI / Path(entry).name
        target.write_bytes(archive.read(entry))
        print(f"Verified Android native library: {target.name}")
print("Official sherpa-onnx 2.0.1 JVM API + arm64 Android libraries prepared")
