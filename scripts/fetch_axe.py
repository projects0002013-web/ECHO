"""Fetch a pinned test-only axe-core build from npm and verify its package integrity."""
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

VERSION = '4.10.3'
root = Path(__file__).resolve().parents[1] / '.test-output'
root.mkdir(exist_ok=True)
with urllib.request.urlopen(f'https://registry.npmjs.org/axe-core/{VERSION}', timeout=30) as response:
    metadata = json.load(response)
with urllib.request.urlopen(metadata['dist']['tarball'], timeout=60) as response:
    package = response.read()
actual = 'sha512-' + base64.b64encode(hashlib.sha512(package).digest()).decode()
if actual != metadata['dist']['integrity']:
    raise SystemExit('axe-core package integrity mismatch')
with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as archive:
    script = archive.extractfile('package/axe.min.js').read()
(root / 'axe.min.js').write_bytes(script)
print(f'axe-core {VERSION}: package integrity verified; test asset saved')
