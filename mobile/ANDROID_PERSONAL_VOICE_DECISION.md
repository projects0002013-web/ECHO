# ECHO Android — offline personalized voice: implementation decision (2026-11-08)

## Product requirement
On a Redmi Note 14, a user must be able to consent to recording their own voice, enter a **previously unrecorded Russian sentence**, and hear it in a recognizably similar voice **without Internet**. Existing recorded phrases and default TTS must continue to work even if the AI engine is unavailable. Never send voice data to servers.

## Verified available technology vs. gaps

| Candidate | Offline Android capability | Russian new text | Clone from user audio | Decision |
|---|---|---|---|---|
| sherpa-onnx Piper ru_RU (ruslan / denis / dmitri / irina) | Released Android ARM64 TTS APKs | Yes | **No** | Practical ordinary Russian fallback, not personal voice |
| sherpa-onnx PocketTTS | Offline zero-shot cloning, Android third-party implementation | **Not verified** / language packs provided do not list Russian | Yes for supported languages | Don't claim Russian support |
| sherpa-onnx ZipVoice zh-en-emilia | Offline zero-shot cloning with reference transcript | Published sample is Chinese/English only | Yes for supported languages | Don't use as Russian solution |
| ESpeech-TTS-1 Russian F5-TTS model | Russian local GPU generation documented | Yes | Yes | **Research / porting candidate**; Android CPU/ONNX performance, RAM and licensing need validation before integration |

References:
- https://k2-fsa.github.io/sherpa/onnx/tts/apk.html
- https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html
- https://k2-fsa.github.io/sherpa/onnx/tts/zipvoice.html
- https://github.com/The-unknown-Shadowman/PocketTTS-Android-Engine
- https://github.com/meshoklv/ru-speech-bench/blob/master/docs/engines/espeech-tts.md

## Existing ECHO integration
- Web UI `features.js` calls `window.echoNativeVoice.status()` and `synthesize({text, language, referenceWavBase64, signal})`.
- `mobile-voice.js` bridges JavaScript requests to Android `EchoAndroid.request`.
- `mobile/android/app/src/main/java/org/echo/aac/MainActivity.java` currently replies `ready:false` and **does not have an inference engine**.
- The UI records and replays authorized personal WAV samples separately; this is not text-to-speech cloning.

## Implementation stages
1. **Russian fallback:** retain Android system TTS / recorded phrases as reliable core. If a Piper engine is added later, label it as a *standard Russian voice*.
2. **Model feasibility:** pick a license-compatible Russian zero-shot model; on an Android ARM64 device measure cold and warm synthesis latency, RAM peak, model size, output quality, pronunciation, battery drain, app compatibility. Only select a model with actual evidence.
3. **Native inference:** add an inference library and model files, installation with download/hash checks (or release bundled model) and private encrypted-at-rest storage where feasible. Never commit recordings or user profiles.
4. **Bridge:** perform inference on a background executor; validate text length <=300, language and model readiness; validate input audio duration/format and reference consent. Reply with valid RIFF/WAVE and support cancellation / cleanup.
5. **Phone-only release:** GitHub Actions builds an installable APK. On Redmi Note 14: record own reference, generate never-before-recorded Russian text, airplane-mode test, user confirms whether the timbre resembles their voice, verify no crashes or overheating.
6. **Honesty gate:** do not set `ready:true` or advertise offline personalized synthesis until step 5 passes.

## Privacy and safety
Use only a voice belonging to the user or a consenting person. Keep audio entirely on-device; voice profile deletion must remove saved profiles and any derived audio, and there should be no background uploads.

## Progress note
This is a **model evaluation and engineering plan, not an implemented voice cloning feature**. The app's existing microphone recording can function while the native synthesis engine is still absent.
