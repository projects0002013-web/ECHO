"""Non-invasive ECHO 1.0 release invariants: localization, user privacy, offline assets."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("ru", "kk", "en", "be")
PLACEHOLDER = re.compile(r"\{v\d+\}")


class ReleaseReadiness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / "locales/catalog.json").read_text(encoding="utf-8"))
        cls.messages = cls.catalog["messages"]

    def test_all_four_catalogs_have_exactly_the_same_keys(self):
        self.assertEqual(set(self.messages), set(LANGUAGES))
        original = set(self.messages["ru"])
        self.assertGreater(len(original), 400)
        for language in LANGUAGES:
            with self.subTest(language=language):
                self.assertEqual(set(self.messages[language]), original)
                self.assertTrue(all(isinstance(value, str) and value.strip()
                                    for value in self.messages[language].values()))

    def test_dynamic_translation_placeholders_are_preserved(self):
        for key in self.messages["ru"]:
            expected = sorted(PLACEHOLDER.findall(key))
            for language in LANGUAGES:
                with self.subTest(key=key, language=language):
                    self.assertEqual(sorted(PLACEHOLDER.findall(self.messages[language][key])), expected)

    def test_dictionary_and_word_keys_resolve_for_all_languages(self):
        reference = self.messages["ru"]
        for key in self.catalog["wordKeys"]:
            self.assertIn(key, reference)
        for translated, key in self.catalog["aliases"].items():
            self.assertTrue(translated.strip())
            self.assertIn(key, reference)

    def test_offline_bundle_includes_translation_and_backup(self):
        pack = (ROOT / "mobile/package-web.py").read_text(encoding="utf-8")
        service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        for name in ("backup.js", "i18n.js", "accessibility.js", "executive.js",
                     "executive-light.css", "mobile-voice.js"):
            with self.subTest(name=name):
                self.assertIn(name, pack)
                self.assertIn(name, service_worker)
        self.assertIn('href="executive-light.css"', html)
        self.assertNotIn('href="style.css"', html)

    def test_test_apk_does_not_replace_production_application(self):
        gradle = (ROOT / "mobile/android/app/build.gradle").read_text(encoding="utf-8")
        debug = (ROOT / "mobile/android/app/src/debug/AndroidManifest.xml").read_text(encoding="utf-8")
        self.assertIn("applicationId 'org.echo.aac'", gradle)
        self.assertIn("applicationIdSuffix '.preview'", gradle)
        self.assertIn('ECHO Тест', debug)

    def test_personal_audio_stays_out_of_public_app_bundle(self):
        pack = (ROOT / "mobile/package-web.py").read_text(encoding="utf-8")
        manifest = (ROOT / "mobile/android/app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
        self.assertNotIn("voice_models/", pack)
        self.assertNotIn("personal.wav", pack)
        self.assertIn('android:allowBackup="false"', manifest)


if __name__ == "__main__":
    unittest.main()
