#!/usr/bin/env python3
"""Pinned test-only axe-core; never bundled into ECHO or loaded at app runtime."""
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen
URL = 'https://unpkg.com/axe-core@4.10.3/axe.min.js'
EXPECTED = '880970c081707360e64f34cea25ff91892f5bc95675b0776925b9709dd8a68bb'
TARGET = Path(__file__).resolve().parents[1] / '.test-output/axe.min.js'
if not TARGET.exists() or sha256(TARGET.read_bytes()).hexdigest() != EXPECTED:
    with urlopen(URL, timeout=60) as response:
        payload=response.read(2*1024*1024)
    if sha256(payload).hexdigest() != EXPECTED:
        raise RuntimeError('axe-core integrity mismatch')
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_bytes(payload)
print('Verified axe-core 4.10.3 test asset')
