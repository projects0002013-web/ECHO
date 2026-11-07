# ECHO: Qwen3-TTS Android separate-app experiment — phone-only checklist

This is **a separate proof of concept**, not an ECHO update. The experimental APK has its own application ID. Do not uninstall ECHO or delete its data.

## Before testing
1. Confirm GitHub Actions "Experimental on-device Qwen3 TTS (separate APK)" completed **successfully** and published artifact `qwen3-tts-android-experimental-debug`. Do not install anything from a failed run.
2. Check enough phone storage for the APK and the GGUF model downloads; the app itself downloads model components from Hugging Face on first use. The APK artifact does **not** bundle Qwen3 weights.
3. Save your existing ECHO recordings or use its backup feature, and keep ECHO installed.
4. Do not test with other people's voices unless they have consented. Keep audio samples local. Using the experimental app may involve a one-time model download; verify its source and privacy behaviour before using sensitive audio.

## Device test
- Install the separate Qwen3-TTS test APK.
- Open Settings and download the Q4_K_M model. Check available internal storage and use Wi-Fi.
- Record a 6–15 second reference clip with a clear, quiet voice. If the app requests it, enter the **exact words** spoken.
- Choose Russian and enter a new, never-recorded phrase (e.g. "Сегодня я могу говорить своим голосом.").
- If the app supports it, generate, play and save a WAV. Check whether the phrase is understandable and whether its voice resembles the reference. Record time-to-first-audio, total time, crashes, Android warnings and whether phone becomes unusually hot.
- Turn on airplane mode **after model download** and repeat a new phrase. Offline success requires fully working generation with no internet.
- Confirm opening ECHO afterwards still plays phrase cards and old recordings.

## Results to report
Android version: ______
RAM total / available before test: ______
Storage available before model download: ______
APK installed: yes / no
Q4 model downloaded: yes / no
Short Russian phrase generated: yes / no
Audio intelligible: yes / no
Resembles consented voice: yes / no
Works in airplane mode: yes / no
Crash or thermal warning: ______
Approximate time: ______
Error text (if any): ______

## Explicit limits
A green CI build only proves that the APK compiles; it does not establish Qwen3 model correctness, Russian quality, speed, safety, or feasibility on a Redmi Note 14. Do not mark ECHO personalized synthesis ready until the device test passes. Do not merge the separate experimental APK code into ECHO's own runtime based only on its build success.

References: https://github.com/Danmoreng/qwen3-tts-android and https://github.com/Danmoreng/qwen3-tts.cpp
