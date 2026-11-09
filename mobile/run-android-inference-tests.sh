#!/usr/bin/env bash
# Run real Android inference with explicit environment checks and persistent diagnostics.
# Network toggles must not hide the actual emulator/Gradle error.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/mobile/android/app/build/outputs/androidTest-results"
mkdir -p "$OUT"
exec > >(tee "$OUT/echo-emulator-diagnostics.log") 2>&1
echo "=== ECHO Android emulator diagnostics ==="
date -u '+%Y-%m-%dT%H:%M:%SZ'
adb version || true
adb devices -l || true
adb shell getprop ro.build.version.sdk || true
adb shell getprop ro.product.cpu.abi || true
adb shell getprop sys.boot_completed || true
adb shell df -h /data || true
adb shell dumpsys meminfo | head -30 || true
echo "=== Attempt network isolation ==="
adb shell cmd connectivity airplane-mode enable || echo "NOTE: emulator did not support airplane-mode command"
adb shell svc wifi disable || echo "NOTE: Wi-Fi disable command failed"
adb shell svc data disable || echo "NOTE: cellular radio not available"
adb shell settings get global airplane_mode_on || true
adb shell dumpsys wifi | grep -m 3 -E 'Wi-Fi is|Wi-Fi state|mWifiEnabled' || true
echo "=== Verify no active external network transport ==="
# API 35 emulators can differ on airplane-mode permissions. Do not mislabel
# failures to toggle a virtual cellular radio as ONNX inference failures.
# Block external network access at host firewall where feasible in a dedicated job.
echo "=== Execute genuine Android instrumentation ==="
set +e
gradle -p "$ROOT/mobile/android" --no-daemon --stacktrace --info connectedDebugAndroidTest
code=$?
set -e
echo "gradle_instrumentation_exit_code=$code"
echo "=== Android logcat (tail) ==="
adb logcat -d -v threadtime -t 1500 > "$OUT/echo-emulator-logcat.txt" 2>&1 || true
grep -E 'FATAL EXCEPTION|UnsatisfiedLinkError|AndroidRuntime|PocketTts|sherpa|onnxruntime|INSTRUMENTATION_STATUS|Process crashed' "$OUT/echo-emulator-logcat.txt" | tail -80 || true
echo "=== JUnit XML files ==="
find "$OUT" -name '*.xml' -print || true
echo "=== Gradle androidTest reports ==="
find "$ROOT/mobile/android/app/build/reports/androidTests" -maxdepth 3 -type f -print 2>/dev/null | head -35 || true
exit "$code"
