"""One-time download of official weights; never uploads audio."""
import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ["HF_HOME"] = str(Path(__file__).resolve().parent / ".voice-cache")
os.environ["PKUSEG_HOME"] = str(Path(__file__).resolve().parent / ".voice-cache" / "pkuseg")


def main():
    from huggingface_hub import HfApi, snapshot_download, hf_hub_download
    from echo_server import MODEL_FILES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", help="Optional pinned commit from the official model repository")
    args = parser.parse_args()
    if args.revision and (len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision)):
        parser.error("Use the official repository's full 40-character commit SHA.")
    info = HfApi().model_info("ResembleAI/chatterbox", revision=args.revision or "main", files_metadata=True)
    destination = Path(__file__).resolve().parent / "voice_models"
    snapshot_download("ResembleAI/chatterbox", revision=info.sha,
                      allow_patterns=list(MODEL_FILES) + ["Cangjie5_TC.json", "LICENSE"], local_dir=destination)
    verified = {}
    for filename in MODEL_FILES:
        metadata = next(item for item in info.siblings if item.rfilename == filename)
        path = destination / filename
        digest = hashlib.sha256() if metadata.lfs else hashlib.sha1()
        if not metadata.lfs:
            digest.update(f"blob {path.stat().st_size}\0".encode())
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""): digest.update(block)
        expected = metadata.lfs.sha256 if metadata.lfs else metadata.blob_id
        if not expected or digest.hexdigest() != expected:
            raise RuntimeError(f"Checksum verification failed for {filename}. Do not use this download.")
        verified[filename] = expected
    (destination / "echo-manifest.json").write_text(json.dumps({"repository": "ResembleAI/chatterbox", "revision": info.sha, "checksums": verified}, indent=2))
    # Chatterbox initializes its Chinese segmenter even for Russian/English.
    # Prepare its supported cache now, not during a user's synthesis request.
    hf_hub_download("ResembleAI/chatterbox", "Cangjie5_TC.json", cache_dir=destination)
    from spacy_pkuseg import pkuseg
    pkuseg()  # Official downloader checks the hash pinned by spacy-pkuseg.
    print("Модель скачана. Теперь синтез работает локально, без интернета.")


if __name__ == "__main__":
    main()
