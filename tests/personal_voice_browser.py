"""Real personal voice through the UI, then cached offline replay. No stubs."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    text = 'Теперь я могу свободно общаться.'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        page = context.new_page(); requests = []; remote = []; errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: requests.append(r.url) if r.method == 'POST' else None)
        page.on('request', lambda r: remote.append(r.url) if r.url.startswith('http') and not r.url.startswith(args.url) else None)
        page.goto(args.url)
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        page.locator('.settings-btn').click()
        page.locator('#echoAudioImport').set_input_files(str(args.reference))
        expect(page.locator('#echoLocalVoiceStatus')).to_contain_text('Образец сохранён')
        page.locator('#echoSpeechMode').select_option('personal')
        expect(page.locator('#echoLocalVoiceStatus')).to_contain_text('Локальная модель установлена')
        page.locator('#phrasesTab').click()
        page.locator('#customPhrase').fill(text)
        page.locator('.speak-custom').click()
        expect(page.locator('#echoSpeechStatus')).to_contain_text('Произношу персональным голосом', timeout=240000)
        page.locator('#echoStopSpeech').click()
        assert len(requests) == 1, requests
        # Browser retains the real generated WAV, not a dummy fixture.
        cached = page.evaluate('''() => new Promise((resolve, reject) => {
          const request = indexedDB.open('echo-local-voice', 1);
          request.onsuccess = () => {
            const query = request.result.transaction('cache').objectStore('cache').getAll();
            query.onsuccess = () => resolve(query.result.map(e => ({key:e.key, bytes:e.blob.size, type:e.blob.type})));
            query.onerror = reject;
          }; request.onerror = reject;
        })''')
        assert len(cached) == 1 and cached[0]['bytes'] > 44 and cached[0]['type'] == 'audio/wav'
        context.set_offline(True)
        page.reload()
        page.wait_for_function("!document.getElementById('echoSamplePlay').disabled")
        page.locator('#customPhrase').fill(text)
        page.locator('.speak-custom').click()
        expect(page.locator('#echoSpeechStatus')).to_contain_text('сохранённая фраза')
        page.locator('#echoStopSpeech').click()
        assert len(requests) == 1, 'Cached replay made a new synthesis request'
        assert not errors, errors
        assert not remote, remote
        browser.close()
    print(json.dumps({'real_personal_voice_ui': 'passed', 'offline_cached_replay': 'passed',
                      'synthesis_requests': 1, 'cached_audio_bytes': cached[0]['bytes'],
                      'remote_browser_requests': 0, 'javascript_errors': errors}, ensure_ascii=False))


if __name__ == '__main__': main()
