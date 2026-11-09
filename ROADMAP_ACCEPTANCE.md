# ECHO Roadmap — протокол закрытия этапов (2026-11-09)

Это документ для **аккуратного обновления первоначальных статусов** в `ECHO_ROADMAP.html`.

## Правило

- «Готово» на уровне программной функции = проверка существующего кода и воспроизводимый автоматический тест.
- «Готово» на уровне научного документа = законченный самостоятельный материал, без вымышленных испытаний.
- Физические испытания Android/iOS и реальные исследования **не считаются выполненными** по результатам CI. Их отдельные задачи в roadmap остаются открыты.
- Базовый отчёт: [GitHub ECHO Quality Gates](https://github.com/projects0002013-web/ECHO/actions/runs/42553551384); [Android APK](https://github.com/projects0002013-web/ECHO/actions/runs/42553551344).

## Проверяемые пункты — технический и документальный объём

| Roadmap ID | Доказательство и завершённый объём | Что НЕ считается проверенным |
|---|---|---|
| `voice_switch` | `tests/voice_browser.py::test_source_change_cancels_and_persists_without_automatic_speech`, `test_voice_change_and_language_change_stop_active_speech`, `test_source_persistence_failure_rolls_back` | На конкретном Android голоса проверяет `voice_android` |
| `voice_errors` | `test_web_speech_errors_and_sync_throw_are_visible`, `test_audio_autoplay_error_is_not_reported_as_microphone_denial`, `test_stopped_personal_response_never_repopulates_cache` | Реальная специфичная ошибка драйвера устройства |
| `voice_cache` | `test_personal_cache_survives_reload_offline_and_stop_discards_old_result`, `test_replaced_sample_cannot_reuse_previous_voice_cache` | Кэш нейросети PocketTTS на реальном Android и производительность |
| `design_nav` | `tests/redesign_browser.py::test_card_tools_do_not_overlap_text_at_required_sizes_and_orientation`, `test_one_stylesheet_four_main_tabs_and_persistent_sos` | Удобство на конкретном Redmi Note 14 (`design_screen`) |
| `design_keyboard` | `test_text_200_percent_and_keyboard_modal_remain_usable`, `tests/final_regression.py::test_editor_returns_keyboard_focus_after_cancel_and_save` | TalkBack/VoiceOver (`design_reader`) |
| `data_deletion` | `test_rapid_delete_and_sequential_edit_preserve_legacy_data`, `tests/core_browser.py`, `tests/backup_browser.py` (атомарность сохранения); функции отмены удаления уже реализованы | Перенос всех данных на новое устройство |
| `data_failure` | `test_partial_failure_rolls_back_local_and_binary_data`, `test_quota_local_write_rolls_back_after_indexeddb_commit`, `test_startup_recovers_journal_after_interrupted_restore`, `test_failed_rollback_retains_journal_and_recovers_on_restart` | Физическое извлечение батареи/сбой Android; отдельно `data_export_test`, `data_import_test` |
| `lang_voice_fallback` | `test_missing_piper_offers_device_without_changing_language`, `test_empty_delayed_and_missing_voice_never_replay_old_phrase`, `test_unavailable_ai_offers_explicit_alternative_without_upload` | Наличие локальных голосов для RU/KK/EN/BE на каждом устройстве (`lang_tts`) |
| `rel_regression` | Полный набор автоматических Python + Playwright регрессионных тестов: `tests/final_regression.py`, `tests/executive_browser.py`, `tests/backup_browser.py` | Реальная ручная приёмка Android/iOS (`rel_android`, `rel_iphone`) |
| `rel_docs` | `USER_GUIDE.md`, `DEVICE_ACCEPTANCE.md`, `RELEASE_CHECKLIST.md`, безопасная ссылка обратной связи через Issues; техническая инструкция для тестовой версии завершена | Правила публикации, окончательная юридическая политика, публичная поддержка без GitHub (`rel_stable`) |
| `sci_problem` | `SCIENCE_BACKGROUND.md`: проблема, актуальность, исследовательский вопрос, границы и источники ВОЗ + ASHA. Обоснование не выдаёт статистику по всем ассистивным технологиям за число пользователей AAC | Прямое доказательство пользы ECHO |
| `sci_compare` | `AAC_COMPARISON.md`: документальное сравнение ECHO с Proloquo2Go, TD Snap, Public AAC по официальным описаниям | Практический сравнительный пользовательский эксперимент |
| `sci_slides` | Готовая презентация **на 10 слайдов**, создана в сеансе ChatGPT. В репозитории есть воспроизводимый `scripts/generate_science_slides.py`, генерация + проверка 10 слайдов в CI, PPTX как артефакт CI | Не проведённый эксперимент; финальная устная защита |

## Незакрытые действительно важные пункты

Итоговая физическая приёмка Android и iPhone, качество персонального AI-голоса на устройствах, доступность TalkBack/VoiceOver, установка/обновление стабильного приложения без потери данных, финальные документы публикации, добровольное исследование и его реальные результаты.

**Итог:** закрытие этих 13 пунктов не означает, что ECHO 1.0 выпущен или 60% пользовательской/медицинской эффективности доказаны. Это доля задач исходного списка с критериями выполнения.


## Проверка release-hardening, 9 ноября 2026

Исходная ветка: `feature/echo-executive-light-offline-voice` (`b2dbe87`); отдельная ветка изменений: `feature/echo-1-0-release-hardening`. Исходный seed действительно содержит **94 задачи: 57 Done, 18 Partial, 19 Todo**. Все 94 ID уникальны, иных начальных статусов нет. Доли не повышались ради процента. Локально сохранённые пользовательские отметки Roadmap не очищались.

- `voice_ai_native` / `voice_ai_quality`: [успешный Android workflow 42555182123](https://github.com/projects0002013-web/ECHO/actions/runs/42555182123) на `ab7ad77` выполняет **реальный Android JNI/ONNX-инференс в эмуляторе**, не Linux и не mock. `PocketAndroidInferenceTest` проверяет загрузку весов, 48/44.1 kHz reference audio, новый WAV через MediaPlayer, отмену до/во время inference, повторную генерацию, повреждение/восстановление модели и последовательность запросов. Wi-Fi/data выключены перед тестами. Эти пункты остаются **Partial** до физической приёмки владельцем; сходство синтетическим тестом не оценивается.
- `voice_ai_ui`: `mobile-voice.js` объявляет API version 1; `offline-voice.js` ожидает проверку весов и JNI, затем проверенный сохранённый WAV, согласие, текст и EN. `tests/native_voice_browser.py` проверяет модель loading/error, отмену, поздний WAV, кэш без готовой модели, отзыв согласия и RU/KK/EN/BE. Браузерный host здесь mock и не доказывает inference.
- `voice_cache` / `data_failure`: `features.js::cacheGenerated` атомарно сохраняет WAV и вытесняет старые записи. `test_cache_quota_rolls_back_eviction_of_existing_audio` сохраняет все 50 прежних элементов при ошибке записи. Ключи и версии IndexedDB/localStorage прежние.
- `rel_ci`: локально собраны `assembleDebug` и `assembleDebugAndroidTest`; [APK CI](https://github.com/projects0002013-web/ECHO/actions/runs/42555182123#artifacts) содержит `arm64-v8a`, `x86_64`, веса и лицензии. `mobile/check-apk.py` сверяет актуальные web-файлы, графы и JNI. Пакет только `org.echo.aac.preview`.
- `rel_regression`: [Quality Gates 42555182083](https://github.com/projects0002013-web/ECHO/actions/runs/42555182083) успешно выполнил web/Python и настоящий Linux JNI-инференс. Полный локальный журнал и границы проверок ниже в QA.md.

Дополнительный `PocketWebViewFlowTest` проверяет упакованный WebView → импорт WAV → сохранение образца → согласие → новый текст → Java/JNI → WAV в IndexedDB. Он реально выполнен без skip в успешном [Android CI 42556243850](https://github.com/projects0002013-web/ECHO/actions/runs/42556243850) на `637a79d`; четыре теста проверены обязательным разбором JUnit XML. `mobile/summarize-android-tests.py` требует исполнения всех четырёх инструментальных тестов без skip и публикует фактические имена/время в summary workflow.
