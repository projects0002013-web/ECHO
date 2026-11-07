# ECHO Native — Android & iPhone (starter shells)

**Android debug APK builds are supported; this is not a tested production APK/IPA.** As of this commit: the mobile UI shell and two-way status bridge exist, but the PocketTTS native inference implementation is **not installed**. Status always reports `ready:false`, so ECHO will not claim to clone the user's voice offline. Current audio recordings and UI are unaffected.

## Windows: Android

1. Install Android Studio + Android SDK 35 + JDK 17 (requires downloads). Open `mobile/android` as a Gradle project.
2. From the repository root in PowerShell run `powershell -ExecutionPolicy Bypass -File mobile/package-web.ps1`. This copies existing web assets to `app/src/main/assets/www`.
3. Sync Gradle and run the app on a connected Android phone with USB debugging. If an Android environment is unavailable, **do not claim an APK was built**.
4. Test cards, recording permission, private storage and airplane-mode app launch. Voice Studio reports that the native model is not ready.

Android shell serves a bundled HTTPS virtual origin through `WebViewAssetLoader`, blocks navigation and resource loading outside the bundled origin, and exposes `EchoAndroid` only to that app WebView. The bridge returns `ready:false` until native sherpa-onnx inference is implemented.

## iPhone: requires macOS/Xcode

An iOS app must be built/signed by Xcode on a Mac or on a permitted macOS CI machine. On Windows, **only the source can be prepared**; a normal iPhone app cannot be built locally.

1. Open Xcode, create a SwiftUI iOS app with a unique bundle ID, use `mobile/ios/ECHOApp.swift` and add `mobile/ios/Info.plist` microphone usage description to the target settings.
2. Run `mobile/package-web.ps1` on Windows first (or manually copy the same web assets). Add the `mobile/ios/www` directory as a **folder reference** in the Xcode target.
3. Sign and install on a physical iPhone and test. `WKWebView` loads local app files; external navigation is blocked. A real microphone recording test on WKWebView is still required. The native synthesizer is not present.

## Voice bridge contract

`mobile-voice.js` discovers only native host transports (`EchoAndroid.request` or `window.webkit.messageHandlers.echoNative`); it defines `window.echoNativeVoice` for `features.js` and otherwise does nothing. See `mobile/NATIVE_VOICE_BRIDGE.md`. Both hosts currently return `ready:false`, and **no audio is generated**. The native PocketTTS/sherpa-onnx module must be implemented for each platform, include runtime model install/checksum validation, WAV encoding, private audio handling, and cancellation.

No model weights, private voice samples, or user data are committed to GitHub. Do not publish or advertise offline mobile personalized generation until real devices pass the test plan in `mobile/OFFLINE_PERSONAL_VOICE.md`.

## Tooling verification

The JavaScript adapter was syntax-checked. Native Android/iOS builds, permissions, model inference and on-device offline operation are **not verified**.


## Executive Light build

Use `python3 mobile/package-web.py` (PowerShell helper remains supported). The APK includes executive-light.css, executive.js, offline-voice.js, mobile-voice.js and all original runtime assets. Verify with `python3 mobile/check-apk.py PATH.apk`. Actions builds feature/echo-executive-light-offline-voice and main, checks the actual APK asset hashes and uploads `echo-executive-light-debug`.

The Android shell now implements local Android TextToSpeech, file chooser, chunked backup export through the system document picker, system text scaling, visual insets, rotation preservation and native Back handling. Local CPU Pocket inference is still a separate experimental prototype in native/; it is not wired into the APK. Physical Android audio/permissions/SAF/TalkBack/upgrade behavior and iPhone still require manual validation. Keep the existing package/origin and signing identity when upgrading; never clear user data as a workaround.
