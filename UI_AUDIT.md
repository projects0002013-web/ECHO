# Executive Light: audit and implementation

Base inspected: current main `24f3744`, including Android WebView microphone/audio fixes. Changes continue in `feature/echo-executive-light-offline-voice`; the existing app, storage keys, card IDs, backup schema and voice APIs are retained.

## Findings and corrections

| Area | Finding | Implemented change |
|---|---|---|
| Screens | Phrases/favorites, editor, categories, history, quick phrases, composer, SOS, settings, voice studio/profiles, accessibility and backup already existed | All use the same tokens/components; no replacement app or framework |
| CSS | style.css had 4,369 lines and features.css had accumulated competing themes, mobile rules and dozens of important declarations | One active executive-light.css; legacy files are retired comments, not competing imports. One important rule enforces hidden semantics |
| Cards | Absolute secondary buttons and fixed footer allowances risked covering long phrases | Existing controls moved intact into a flow layout below speech/text. Minimum 44px, default 48px. Concise preset names; full spoken text/data stay intact |
| Speech states | A 400ms press pulse did not represent actual speech duration | Separate selected/speaking indicators, text plus border pattern; lifecycle events from Web Speech/media and native TTS. Existing pulse/API retained |
| Navigation | Seven bottom entries occupied two rows | Four primary tabs; history/quick phrases remain direct links; SOS stays beside Stop/Compose in the permanent action dock |
| Settings | Unstructured panels and a very long voice area obscured basic controls | Speech/interface/ease/data/safety groups with direct jump links. Device controls first, studio still available directly. Text follows system/browser scaling, no fake text-size slider |
| Modals | Fixed heights and legacy colors conflicted; focus could be lost when edited nodes moved | Scrollable dialogs bounded to visual viewport, keyboard insets, focus trap/return retained. Reparenting preserves focused controls |
| Android | Main now contained native shells; file inputs and blob downloads had no shell handlers, Web Speech was not a dependable Android TTS path | Explicit document picker and chunked SAF backup export, native local-voice TTS adapter, text scale, safe area, adjustResize, orientation preservation and local SW asset loader |
| Build | Asset list did not include the new design/modules; Actions only built main | Portable validated packaging, all new assets in APK/cache, feature-branch Actions trigger and APK content verification |

## Design system

Default light: background #F8FAF8, surface #FFFFFF, primary #166534, dark green #123D29, soft green #E8F5E9, text #17231B, muted #526459, borders #DCE7DE, danger #B42332. Saved light/dark/contrast choices and card-size/voice preferences are not renamed. System fonts with Cyrillic; headings 26–30px, card names 18–22px, body 15–17px, helper text 13–14px and navigation 12px at normal text scale. Cards 20px, buttons 14px, fields 15px. Local SVG icons replace system decoration; personal symbols/images remain unchanged.

## Verification boundaries

Automated Chromium checks cover 320/360/393/412/480/768 widths in portrait/landscape, long card names, 200% text, reduced viewport/dialogs, four languages and all three themes, 300 cards, empty states, keyboard/focus, no overlap and minimum targets. axe checks selected WCAG A/AA rules, not WCAG certification. Data and legacy compatibility are tested in isolated profiles, never against a person's actual storage.

Android adapter tests use a fake native transport to verify TTS settings/Stop and exact streamed backup JSON/storage-failure behavior. The Java implementation is compiled by a real Android build; these facts do not establish physical audio, microphone, picker or lifecycle behavior. Android TTS lists only voices that the engine marks as installed/local. The app does not install voices or silently send samples to a cloud API. SAF saves only after the user selects a destination; a failed save is reported and app data is retained.

## Manual/device checks still required

Actual Redmi Note 14 and another Android device: system voice/audio output, mic permission grant/denial, route changes, backgrounding, rotation, system font scale, gesture navigation/safe areas, input keyboard, import picker, backup destination/full disk, TalkBack and upgrade with existing data. Test offline after restarting the app. A debug APK must use the same signing certificate to update an existing installation; do not clear/uninstall user data to force an update. iPhone/VoiceOver and real user one-hand/motor usability were not tested. Native personalized AI remains experimental; the earlier Linux Pocket CLI smoke is not a phone capability.


## Files and results

Active design: executive-light.css, executive.js, index.html; retired style.css/features.css. Speech lifecycle/provider integration: script.js/features.js/mobile-voice.js. Android: MainActivity.java, AndroidManifest.xml, app/build.gradle. Offline/package: backup.js, sw.js, echo_server.py, locales/catalog.json, mobile/package-web.py, package-web.ps1, check-apk.py and the Android workflow. Regression tests: redesign_browser.py plus existing fixtures adjusted to current main's permission text and AudioContext startup order. Native research/prototype files from the preceding phase are retained separately; no AI model is shipped in APK.

Final local runs: 20 server + 6 redesign + 7 executive + 10 accessibility + 13 localization + 7 studio + 15 backup + 28 voice + 14 regression = 120 unittest cases; 12 core groups + 15 smoke groups; 18 axe scans; ten JavaScript syntax checks. The full suite passed after the last code change. APK assembled with JDK 17/Gradle 8.10.2/SDK 35; all 28 packaged web assets match their sources and apksigner verifies the debug signature. VersionCode 2, versionName 1.0-executive-debug. Actions repeats the package/build/content verification on this feature branch; remote status must be checked separately. No real-phone test is implied.

Resolved test failures: focus lost while moving newly recreated editor controls (now preserved); the composer radius overridden by generic panels (component selector now preserves 22px without another important override); an immediate viewport assertion now waits for the resize event; old microphone/cancel mocks updated to current main's Android preflight/resume/source order while retaining close/no-data checks. None of the final failures is left hidden or marked as passed without rerun.
