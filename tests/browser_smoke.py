"""Real browser checks. Run with ECHO's local server running; no model required."""
import argparse
import io
import json
import math
from pathlib import Path
import struct
import tempfile
import wave
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect


def tone(seconds):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(i * 2 * math.pi * 200 / 16000))) for i in range(int(seconds * 16000))))
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    args = parser.parse_args()
    passed = []
    output = Path(__file__).resolve().parents[1] / ".test-output"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as directory, sync_playwright() as p:
        mic = Path(directory) / "test-microphone.wav"; mic.write_bytes(tone(10))
        browser = p.chromium.launch(executable_path=args.chromium, headless=True,
            args=["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                  f"--use-file-for-fake-audio-capture={mic}"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, permissions=["microphone"])
        page = context.new_page(); errors = []; remote_requests = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: remote_requests.append(r.url) if r.url.startswith("http") and not r.url.startswith(args.url) else None)
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(args.url + "/index.html")
        expect(page.locator(".phrase-card")).to_have_count(6)
        page.wait_for_function("navigator.serviceWorker.controller !== null")
        assert page.locator('.echo-composer').evaluate("e => getComputedStyle(e).borderRadius") == "22px"
        passed.append("app and local assets")

        # Create a card through the real dialog and preserve user data on reload.
        page.locator(".add-button").click()
        page.locator("#newPhraseName").fill("Моя фраза")
        page.locator("#newPhraseText").fill("Пожалуйста, помоги мне")
        page.locator("#savePhrase").click()
        custom = page.locator(".custom-card").first
        expect(custom).to_be_visible()
        custom.locator(".favorite-star").click()
        page.locator("#favoritesTab").click()
        expect(page.locator(".phrase-card:visible")).to_have_count(1)
        page.reload()
        page.locator("#favoritesTab").click()
        expect(page.locator(".phrase-card:visible")).to_have_count(1)
        passed.append("cards and favorites persist")
        page.locator("#phrasesTab").click()
        page.locator("#echoSearchInput").fill("помоги")
        expect(page.locator(".phrase-card:visible")).to_have_count(1)
        page.locator("#echoSearchInput").fill("")
        page.locator('.echo-category-button[data-category="food"]').click()
        expect(page.locator(".phrase-card:visible")).to_have_count(2)
        page.locator('.echo-category-button[data-category="all"]').click()
        passed.append("search and categories")

        page.locator(".settings-btn").click()
        expect(page.locator(".phrase-grid")).to_be_hidden()
        page.locator('.theme-option[data-theme="dark"]').click()
        page.locator('.card-size-option[data-size="large"]').click()
        page.locator('#echoVoiceRate').fill('1.2')
        page.locator('#echoVoiceRate').dispatch_event('input')
        page.locator('.vibration-option[data-vibration="on"]').click()
        page.locator('.language-option[data-language="en"]').click()
        page.reload()
        assert page.locator("body").evaluate("e => e.classList.contains('dark-theme') && e.classList.contains('cards-large')")
        assert page.locator("html").get_attribute("lang") == "en"
        page.locator(".settings-btn").click()
        expect(page.locator('#echoVoiceRate')).to_have_value('1.2')
        expect(page.locator('.vibration-option[data-vibration="on"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('#echoVoiceRate').fill('0.9')
        page.locator('#echoVoiceRate').dispatch_event('input')
        page.locator('.language-option[data-language="ru"]').click()
        passed.append("theme, card size, voice settings, vibration setting and language persist")
        page.locator("#phrasesTab").click()
        page.locator("#echoWordChoices").get_by_role("button", name="Я", exact=True).click()
        page.locator("#echoWordChoices").get_by_role("button", name="хочу", exact=True).click()
        page.locator("#echoWordChoices").get_by_role("button", name="пить", exact=True).click()
        expect(page.locator("#echoSentence")).to_have_value("Я хочу пить")
        page.locator("#echoSentenceUndo").click()
        expect(page.locator("#echoSentence")).to_have_value("Я хочу")
        page.locator("#echoSentenceSave").click()
        expect(page.locator("#newPhraseText")).to_have_value("Я хочу")
        page.locator("#closeModal").click()
        passed.append("sentence composer")

        page.locator(".settings-btn").click()
        expect(page.locator("#echoStoreHistory")).not_to_be_checked()
        page.locator("#echoStoreHistory").check()
        page.locator("#echoRecordTarget").select_option("phrase")
        page.locator("#echoRecordText").fill("Я хочу пить")
        page.locator("#echoAudioImport").set_input_files({"name": "phrase.wav", "mimeType": "audio/wav", "buffer": tone(1)})
        expect(page.locator("#echoLocalVoiceStatus")).to_contain_text("Запись фразы сохранена")
        page.locator("#echoSpeechMode").select_option("recordings")
        page.reload()
        page.locator(".settings-btn").click()
        expect(page.locator("#echoRecordingsList")).to_contain_text("Я хочу пить")
        passed.append("phrase recording import and persistence")

        # Capture actual fake microphone audio through the production AudioWorklet.
        page.locator("#echoRecordStart").click()
        expect(page.locator("#echoLocalVoiceStatus")).to_contain_text("Запись идёт", timeout=10000)
        page.wait_for_timeout(6500)
        page.locator("#echoRecordStop").click()
        expect(page.locator("#echoLocalVoiceStatus")).to_contain_text("Образец сохранён", timeout=10000)
        expect(page.locator("#echoSamplePlay")).to_be_enabled()
        page.locator("#echoSamplePlay").click()
        passed.append("microphone capture and local voice sample")
        page.locator('#echoRecordStart').click()
        expect(page.locator('#echoLocalVoiceStatus')).to_contain_text('Запись идёт')
        page.locator('#phrasesTab').click()
        page.locator('.settings-btn').click()
        expect(page.locator('#echoLocalVoiceStatus')).to_contain_text('Микрофон выключен')
        expect(page.locator('#echoRecordStop')).to_be_disabled()
        passed.append('microphone stops when leaving settings')

        page.locator("#echoRecordTarget").select_option("sample")
        page.locator("#echoAudioImport").set_input_files({"name": "too-short.wav", "mimeType": "audio/wav", "buffer": tone(1)})
        expect(page.locator("#echoLocalVoiceStatus")).to_contain_text("6 до 30 секунд")
        page.locator("#echoSpeechMode").select_option("personal")
        model_ready = page.request.get(args.url + '/api/voice/status').json()['ready']
        if not model_ready:
            expect(page.locator("#echoLocalVoiceStatus")).to_contain_text("нужны файлы модели")
        def unavailable_stub(route):
            route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'Локальный синтез недоступен'}))
        if model_ready: page.route('**/api/voice/synthesize', unavailable_stub)
        page.locator("#phrasesTab").click()
        page.locator(".phrase-card").first.click()
        expect(page.locator("#echoSpeechStatus")).to_contain_text("Локальный синтез недоступен", timeout=10000)
        if model_ready: page.unroute('**/api/voice/synthesize', unavailable_stub)
        passed.append("missing model and short sample errors")

        # Stub only the synthesis response to exercise client caching. This does
        # not validate the neural model or voice similarity.
        generated = []
        def synthesize_stub(route):
            body = route.request.post_data_json
            assert body["language"] == "ru" and body["text"] == "Я хочу пить"
            assert body["reference"].startswith("UklGR")
            generated.append(body["text"])
            route.fulfill(status=200, content_type="audio/wav", body=tone(3))
        page.route("**/api/voice/synthesize", synthesize_stub)
        page.locator(".phrase-card").first.click()
        expect(page.locator("#echoSpeechStatus")).to_contain_text("Произношу персональным голосом", timeout=10000)
        page.locator("#echoStopSpeech").click()
        context.set_offline(True)
        page.reload()
        page.wait_for_function("!document.getElementById('echoSamplePlay').disabled")
        page.locator(".phrase-card").first.click()
        expect(page.locator("#echoSpeechStatus")).to_contain_text("сохранённая фраза")
        assert len(generated) == 1
        page.locator("#echoStopSpeech").click()
        context.set_offline(False)
        page.unroute("**/api/voice/synthesize", synthesize_stub)
        passed.append("personal voice client cache and stop (stub response; model untested)")

        # Routes must hide settings and leave SOS controls functional.
        page.locator(".echo-sos-nav").click()
        expect(page.locator("#echoSOSSpeak")).to_be_visible()
        expect(page.locator("#echoSpeechMode")).to_be_hidden()
        page.locator("#echoSOSStop").click()
        page.locator(".echo-history-nav").click()
        expect(page.locator("#echoHistoryList")).to_contain_text("Я хочу пить")
        expect(page.locator(".echo-sos-panel")).to_be_hidden()
        passed.append("SOS, history and section navigation")

        # Offline: app shell and previously saved real recording still work.
        page.locator(".settings-btn").click()
        page.locator("#echoSpeechMode").select_option("recordings")
        page.locator('.theme-option[data-theme="light"]').click()
        page.locator('.card-size-option[data-size="medium"]').click()
        context.set_offline(True)
        page.reload()
        page.locator(".phrase-card").first.click()
        expect(page.locator("#echoSpeechStatus")).to_contain_text("сохранённой записью")
        page.locator("#echoStopSpeech").click()
        page.locator(".settings-btn").click()
        expect(page.locator("#echoRecordingsList")).to_contain_text("Я хочу пить")
        expect(page.locator("#echoSamplePlay")).to_be_enabled()
        page.locator("#echoDeleteAllAudio").click()
        expect(page.locator("#echoRecordingsList")).to_contain_text("пока нет")
        expect(page.locator("#echoSamplePlay")).to_be_disabled()
        passed.append("offline app, audio playback and deletion")
        context.set_offline(False)
        page.locator("#phrasesTab").click()

        for width in (320, 390, 768, 1280):
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            for nav in page.locator(".bottom-nav .nav-item").all():
                box = nav.bounding_box(); assert box["width"] >= 44 and box["height"] >= 44, (width, box)
            for control in page.locator('.phrase-card:visible [role="button"]').all():
                box = control.bounding_box(); assert box['width'] >= 44 and box['height'] >= 44, (width, box)
            page.locator(".settings-btn").click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, "settings")
            page.locator("#phrasesTab").click()
        passed.append("mobile and desktop layout and touch targets")
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(output / "mobile.png"), full_page=True)
        page.locator(".settings-btn").click()
        page.screenshot(path=str(output / "settings.png"), full_page=True)
        assert not remote_requests, remote_requests
        assert not errors, errors
        passed.append("no remote requests or JavaScript errors")

        # Simulate a public HTTPS deployment, fulfill all assets locally, and
        # prove no voice sample POST can leave the public-origin app.
        public = browser.new_context(service_workers='block')
        posted = []
        def public_asset(route):
            if route.request.method == 'POST':
                posted.append(route.request.url)
                return route.fulfill(status=500, body='Unexpected sample upload')
            path = urlsplit(route.request.url).path
            response = public.request.get(args.url + path)
            route.fulfill(response=response)
        public.route('https://echo.example/**', public_asset)
        hosted = public.new_page()
        hosted.goto('https://echo.example/index.html')
        hosted.locator('.settings-btn').click()
        hosted.locator('#echoAudioImport').set_input_files({'name':'sample.wav', 'mimeType':'audio/wav', 'buffer':tone(7)})
        expect(hosted.locator('#echoLocalVoiceStatus')).to_contain_text('Образец сохранён')
        hosted.locator('#echoSpeechMode').select_option('personal')
        hosted.locator('#phrasesTab').click()
        hosted.locator('.phrase-card').first.click()
        expect(hosted.locator('#echoSpeechStatus')).to_contain_text('Образец не будет отправлен на сайт')
        assert not posted, posted
        public.close()
        passed.append('public-origin app never uploads a voice sample')
        browser.close()
    print(json.dumps({"passed": len(passed), "checks": passed, "voice_clone_synthesis": "unrun in browser smoke: requires separate real-model check"}, ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
