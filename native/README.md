# Offline personal voice: experimental native foundation

**Android implementation now lives in `mobile/android/`: real JNI/ONNX inference passed on an offline Android emulator in [run 42555182123](https://github.com/projects0002013-web/ECHO/actions/runs/42555182123). Physical phone quality and iOS remain unverified.**
The C++ material below describes the earlier portable prototype. See `POCKET_TTS_INTEGRATION.md` and `PocketVoiceService.java` for the active Android implementation.
The shipped PWA contains no Pocket model/runtime and cannot advertise one merely because WebAssembly/WebGPU exists. It preserves device TTS, local recordings and cached Chatterbox phrases. Chatterbox still requires a local computer server for new text. The model check makes no HTTP requests or uploads. There is no new browser synthesis button for this prototype.

## Evidence checked, 2026-11-07

| Candidate | Reference voice? | Actual scope and license evidence |
|---|---|---|
| PocketTTS, Kyutai | Yes: official `--voice own.wav`, reference transcript not required in sherpa | Original 100M CPU model. Upstream now lists EN/FR/DE/PT/IT/ES/NL and newer 18.2M/6.9M/1.9M EN variants. This foundation permits **EN only**, targeting the documented January int8 sherpa package. Smaller models were not verified with this adapter. Code LICENSE is MIT. The downloaded converted package ships **CC BY 4.0** in its LICENSE; preserve attribution and license when distributing those weights. The upstream HF model-card request was blocked (403), so it was not used as evidence. |
| sherpa-onnx | Runtime supports Pocket reference audio through `SherpaOnnxGenerationConfig`, not every TTS model clones voices | Code LICENSE Apache-2.0; model licenses remain separate. Official docs include Pocket C, Kotlin, Swift examples and EN WASM voice-cloning demo. Android/iOS bindings establish an implementation path, not successful ECHO device tests. |
| Existing system TTS / Piper | Installed voices, not sample-based voice cloning | Preserved as existing alternatives. A multi-speaker `sid` is not cloning. |

Primary sources, fetched from the repositories; the compatible int8 package was subsequently downloaded only into /tmp for the native CPU check:

- [Pocket README at 28770c0](https://github.com/kyutai-labs/pocket-tts/blob/28770c06f7deb1b65617834e60a6add7a4ff5b6d/README.md), [MIT code license](https://github.com/kyutai-labs/pocket-tts/blob/28770c06f7deb1b65617834e60a6add7a4ff5b6d/LICENSE).
- [sherpa README at 347ec76](https://github.com/k2-fsa/sherpa-onnx/blob/347ec768a01ca53e766780f7759b14e145b643e6/README.md), [Apache-2.0 license](https://github.com/k2-fsa/sherpa-onnx/blob/347ec768a01ca53e766780f7759b14e145b643e6/LICENSE), [C API](https://github.com/k2-fsa/sherpa-onnx/blob/347ec768a01ca53e766780f7759b14e145b643e6/sherpa-onnx/c-api/c-api.h).
- [Pocket model/package documentation](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/tts/pocket.rst), [Kotlin Pocket example](https://github.com/k2-fsa/sherpa-onnx/blob/347ec768a01ca53e766780f7759b14e145b643e6/kotlin-api-examples/test_pocket_tts.kt), [Swift Pocket example](https://github.com/k2-fsa/sherpa-onnx/blob/347ec768a01ca53e766780f7759b14e145b643e6/swift-api-examples/tts-pocket-en.swift).
- [Weights model card](https://huggingface.co/kyutai/pocket-tts): inaccessible from this environment; the release archive LICENSE supplied the CC BY 4.0 evidence instead. Do not infer weights licensing from code LICENSE.

## Selected path and resource limits

A native CPU sherpa-onnx + Pocket int8 engine avoids shipping Python/PyTorch, a server or a GPU requirement. Start with two CPU threads, one sentence and one cached speaker embedding. The documented package is `sherpa-onnx-pocket-tts-int8-2026-01-26`: `lm_flow.int8.onnx`, `lm_main.int8.onnx`, `encoder.onnx`, `decoder.int8.onnx`, `text_conditioner.onnx`, `vocab.json`, `token_scores.json`.

The checked archive is **98,336,520 bytes**, and its seven selected runtime assets plus license total **198,310,484 bytes** (mixed int8/FP32 graphs). A Linux CPU CLI run measured peak RSS 574,216 KiB (~561 MiB); this is one host observation, not a phone minimum. Two short-text trials took 1.87 s and 14.78 s, with different generated durations because inference is stochastic and the artificial reference is not speech. Mobile RAM, speed, energy and voice similarity remain unmeasured. New smaller EN models are promising but require their own ONNX export/API/license/clone validation. No RAM or iOS compatibility guarantee is made.

WASM is a real upstream option, but a desktop demo does not prove Safari/iPhone survival under memory pressure, mobile worker/thread support or durable model storage. WebGPU presence does not implement the autoregressive/flow/codec pipeline. A native shell with app-private files is the chosen foundation for predictable asset persistence; Android JNI and iOS Swift wrappers are still to be built. No app-store release or native binary is included.

## What the code does

`pocket_voice.cpp` calls the real sherpa C API, supplies reference PCM and generates a **new** WAV. It does not replay/copy the sample. It enforces consent, EN, text length, mono PCM16 sample loading, 6–30 seconds and a separate output path that must not already exist. All input/output is local. `echo_pocket_create` accepts the seven verified local model paths; CPU threads=2 and embedding cache=1. The host must verify model/asset SHA-256 and licenses before creation, serialize generation on a worker, use app-private files, keep the reference out of logs, and destroy the engine when deleting voice data. Existing reference/output paths must be canonicalized by the host to prevent aliases overwriting the sample.

The C++ adapter and CLI compiled/linked against the actual sherpa-onnx 2.0.1 wheel C API and performed **real CPU inference** in the restricted Linux workspace. The regression harness verified a non-empty mono PCM16 WAV at 24 kHz, a new output hash, unchanged reference, consent rejection and no overwrite. Its reference was an artificial tone created by the test, not a human voice; intelligibility, speaker similarity and human use were not assessed. The second observed output lasted 39.781 s (1,909,534 bytes), so this is a numerical/inference smoke test, not a quality acceptance test. **Android NDK/Xcode builds, iPhone/Android inference and CMake were not run**. Runtime and model binaries remain outside Git/PWA.

```sh
# After separately installing/validating the matching sherpa native SDK:
cmake -S native -B native/build -DCMAKE_PREFIX_PATH=/path/to/sherpa-install
cmake --build native/build
```

## Experimental JS boundary

`offline-voice.js` exports `echoOfflineVoice.status()` and `synthesize({text, language, reference: Blob, consent: true, signal})`. They never fetch a model or send voice over HTTP. A native shell must inject `window.echoNativeOfflineVoice` **before** notifying `echo-native-voice-ready`:

```js
// Contract only: these methods must be implemented by the actual native shell.
// Never return modelReady/licenseVerified=true from a placeholder.
{
  apiVersion: 1,
  status: async () => ({
    engine: 'sherpa-onnx-pocket', localOnly: true, supportsReference: true,
    modelReady: true, licenseVerified: true, languages: ['en']
  }),
  synthesize: async ({text, language, referenceWav, consent}) => {
    // Call the native worker/echo_pocket_generate and return WAV bytes.
    // referenceWav is a Uint8Array, not a URL or cloud upload.
  }
}
```

The PWA treats absence, incompatible engines, missing/unverified models, timeouts and unsupported languages as unavailable. Readiness is host-reported and explicitly experimental, not a device certification. The boundary checks consent, language, WAV signature and late aborted results; the native host must repeat PCM/duration validation and enforce immediate cancellation/resource cleanup. No automatic fallback changes a chosen source: the user explicitly selects device voice or recordings. Successful boundary tests use a fake native host and synthetic WAV, not real AI.

Before enabling mobile synthesis in production: retain the checked CC BY 4.0 license/attribution and validate assets against pocket-model.json; build JNI/Swift workers and trusted-origin bridge; wire generation/playback/cancellation and deletion; test airplane mode after reboot, denied permissions, storage pressure, large text, thermal/memory limits and quality using the owner's consenting sample on actual Android and iPhone. RU/KK/BE support requires separate suitable verified models; four-language UI does not imply four-language AI.


## Reproduce the actual Linux prototype check

`pocket-model.json` records the archive identity, byte counts and SHA-256 of each downloaded asset. These are hashes of the official TLS-fetched snapshot, not an independent publisher signature. `POCKET_MODEL_LICENSE.txt` is the archive's CC BY 4.0 text. Attribution: **PocketTTS by Kyutai; ONNX conversion/distribution by k2-fsa/sherpa-onnx**; ECHO did not modify model weights. No sample voices from the archive were extracted or used.

The test installation used temporary `sherpa-onnx==2.0.1` / `sherpa-onnx-core==2.0.1` wheels (about 15 MB download), separate from ECHO's dependencies. Given the local SDK `include` and `lib` directories:

```sh
g++ -std=c++17 -O2 -I/PATH/TO/SHERPA/include \
  native/pocket_voice.cpp native/pocket_cli.cpp \
  -L/PATH/TO/SHERPA/lib -Wl,-rpath,/PATH/TO/SHERPA/lib \
  -lsherpa-onnx-c-api -o /tmp/echo-pocket-cli
.venv/bin/python tests/pocket_native_smoke.py \
  --binary /tmp/echo-pocket-cli --model-dir /PATH/TO/CHECKED/MODEL
```

Without `--reference` this creates a synthetic test signal. A real person's sample requires `--reference OWN.wav --owner-consent`; do not use another person's voice without permission. The CLI uses a text file rather than putting private text in process arguments. This is a runnable desktop/native-core prototype, **not** a phone feature or automatic model installer.
