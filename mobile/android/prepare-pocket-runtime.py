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
JNI = ROOT / "src/main/jniLibs"
LIB.mkdir(parents=True, exist_ok=True)
JNI.mkdir(parents=True, exist_ok=True)


def obtain(name):
    cache = Path('/tmp/echo-sherpa-downloads')
    cache.mkdir(exist_ok=True)
    cached = cache / name
    if cached.is_file() and sha256(cached.read_bytes()).hexdigest() == ASSETS[name]:
        return cached.read_bytes()
    with urlopen(BASE + name, timeout=120) as response:
        payload = response.read()
    digest = sha256(payload).hexdigest()
    if digest != ASSETS[name]:
        raise RuntimeError(f"Official checksum mismatch: {name} {digest}")
    cached.write_bytes(payload)
    return payload


jar = obtain("sherpa-onnx-jvm-2.0.1.jar")
(LIB / "sherpa-onnx-jvm-2.0.1.jar").write_bytes(jar)
aar = obtain("sherpa-onnx-2.0.1.aar")
with ZipFile(BytesIO(aar)) as archive:
    # arm64 for physical phones; x86_64 for real Android JNI instrumentation in CI.
    for abi in ("arm64-v8a", "x86_64"):
        libs = [n for n in archive.namelist() if n.startswith("jni/"+abi+"/") and n.endswith(".so")]
        if not libs:
            raise RuntimeError("Verified release lacks Android JNI ABI: "+abi)
        (JNI/abi).mkdir(parents=True,exist_ok=True)
        for entry in libs:
            target = JNI / abi / Path(entry).name
            target.write_bytes(archive.read(entry))
            print(f"Verified Android native library: {abi}/{target.name}")
print("Official sherpa-onnx 2.0.1 JVM API + Android arm64/x86_64 libraries prepared")
