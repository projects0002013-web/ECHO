"""Voice Studio critical flow. Mocked inference is not a real AI quality test."""
import base64,json,tempfile,unittest
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_smoke import tone
from voice_browser import MOCK
URL='http://127.0.0.1:8000'
class Studio(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.p=sync_playwright().start();cls.temp=tempfile.TemporaryDirectory();mic=Path(cls.temp.name)/'mic.wav';mic.write_bytes(tone(12))
  cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={mic}'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop();cls.temp.cleanup()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':390,'height':844},permissions=['microphone']);self.c.add_init_script(MOCK);self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.on('dialog',lambda d:d.accept());self.q.goto(URL);self.q.wait_for_selector('#echoDataPanel',state='attached')
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def studio(self):self.q.locator('#echoVoiceStudioNav').click();expect(self.q.locator('#echoStudioTitle')).to_be_focused()
 def sample(self):
  self.q.locator('#echoAudioImport').set_input_files({'name':'my-voice.wav','mimeType':'audio/wav','buffer':tone(7)});expect(self.q.locator('#echoAudioDraft')).to_be_visible();self.q.locator('#echoVoiceConsent').check();self.q.locator('#echoDraftSave').click();expect(self.q.locator('#echoAudioDraft')).to_be_hidden()
 def prepare(self):self.studio();self.sample();self.q.locator('#echoStudioText').fill('Это новый текст, которого не было в образце.');self.q.locator('#echoStudioConsent').check()
 def cache_count(self):return self.q.evaluate("()=>new Promise(resolve=>{const r=indexedDB.open('echo-local-voice',1);r.onsuccess=()=>{const d=r.result,t=d.transaction('cache'),q=t.objectStore('cache').count();t.oncomplete=()=>{resolve(q.result);d.close();};};})")
 def mock(self,body=None):
  self.requests=[]
  def answer(route):self.requests.append(route.request.post_data_json);route.fulfill(status=200,content_type='audio/wav',body=body if body is not None else tone(1))
  self.q.route('**/api/voice/synthesize',answer)
 def test_consent_new_text_synthesis_preview_use_on_cards_and_delete(self):
  self.prepare();self.mock();q=self.q;q.locator('#echoStudioConsent').uncheck();q.locator('#echoStudioGenerate').click();expect(q.locator('#echoStudioStatus')).to_contain_text('Подтвердите');self.assertEqual(self.requests,[])
  q.locator('#echoStudioConsent').check();q.locator('#echoStudioGenerate').click();expect(q.locator('#echoStudioResult')).to_be_visible();self.assertEqual(self.requests[0]['text'],'Это новый текст, которого не было в образце.');self.assertEqual(base64.b64decode(self.requests[0]['reference'])[:4],b'RIFF');self.assertGreater(len(base64.b64decode(self.requests[0]['reference'])),100000)
  q.locator('#echoStudioPlay').click();expect(q.locator('#echoStudioStatus')).to_contain_text('Проигрываю результат');q.locator('#echoStudioStop').click()
  q.locator('#echoStudioGenerate').click();expect(q.locator('#echoStudioResult')).to_be_visible();self.assertEqual(len(self.requests),2);self.assertEqual(self.cache_count(),1)
  q.locator('#echoStudioUse').click();self.assertEqual(q.evaluate("localStorage.getItem('echoSpeechMode')"),'personal');q.locator('#echoStudioDelete').click();expect(q.locator('#echoStudioResult')).to_be_hidden();self.assertEqual(self.cache_count(),0);expect(q.locator('#echoSamplePlay')).to_be_enabled()
  q.locator('#echoStudioBack').click();q.locator('.card-speak').first.click();expect(q.locator('#echoSpeechStatus')).to_contain_text('персональным голосом');self.assertEqual(len(self.requests),3)
 def test_actual_missing_model_gives_setup_without_claiming_generation(self):
  status=self.q.request.get(URL+'/api/voice/status').json()
  if status['ready']:self.skipTest('Model installed: run personal_voice_browser.py with an owner-approved sample')
  self.prepare();self.q.locator('#echoStudioGenerate').click();expect(self.q.locator('#echoStudioStatus')).to_contain_text('Локальный синтез недоступен');expect(self.q.locator('#echoStudioSetup')).to_have_attribute('open','');expect(self.q.locator('#echoStudioResult')).to_be_hidden();self.assertEqual(self.cache_count(),0);expect(self.q.locator('#echoStudioText')).to_have_value('Это новый текст, которого не было в образце.')
 def test_record_sample_using_real_worklet_with_test_microphone(self):
  self.studio();q=self.q;q.locator('#echoRecordStart').click();expect(q.locator('#echoLocalVoiceStatus')).to_contain_text('Запись идёт');q.wait_for_timeout(7100);q.locator('#echoRecordStop').click();expect(q.locator('#echoAudioDraft')).to_be_visible();q.locator('#echoVoiceConsent').check();q.locator('#echoDraftSave').click();expect(q.locator('#echoAudioDraft')).to_be_hidden();q.reload();q.wait_for_selector('#echoDataPanel',state='attached');self.studio();expect(q.locator('#echoSamplePlay')).to_be_enabled()
 def test_stop_ignores_late_wav_and_does_not_cache_it(self):
  self.prepare();q=self.q;q.evaluate("""()=>{const original=fetch;window.fetch=(url,options)=>url==='/api/voice/synthesize'?new Promise(resolve=>window.finishStudio=()=>resolve(new Response(new Blob([new Uint8Array(50)],{type:'audio/wav'})))):original(url,options);}""")
  q.locator('#echoStudioGenerate').click();q.wait_for_function('typeof finishStudio==="function"');q.locator('#echoStudioStop').click();q.evaluate('finishStudio()');q.wait_for_timeout(100);expect(q.locator('#echoStudioResult')).to_be_hidden();self.assertEqual(self.cache_count(),0);expect(q.locator('#echoStudioGenerate')).to_be_enabled()
 def test_invalid_success_response_is_not_a_generated_result(self):
  self.prepare();self.mock(b'<html>server error</html>');self.q.locator('#echoStudioGenerate').click();expect(self.q.locator('#echoStudioStatus')).to_contain_text('некорректный WAV');expect(self.q.locator('#echoStudioResult')).to_be_hidden();self.assertEqual(self.cache_count(),0)
 def test_languages_themes_and_mobile_layout(self):
  q=self.q
  for lang,title,generate in [('ru','Мой голос','Синтезировать'),('kk','Менің даусым','Синтездеу'),('en','My voice','Synthesize'),('be','Мой голас','Сінтэзаваць')]:
   q.locator('.settings-btn').click();q.locator(f'[data-language="{lang}"]').click();self.studio();expect(q.locator('#echoStudioTitle')).to_have_text(title);expect(q.locator('#echoStudioGenerate')).to_have_text(generate)
   for width in [320,375,390,768,1280]:q.set_viewport_size({'width':width,'height':844});self.assertTrue(q.evaluate('document.documentElement.scrollWidth<=innerWidth'),(lang,width))
  self.assertEqual(q.evaluate('[...echoI18n.missing]'),[])
  q.set_viewport_size({'width':390,'height':844});q.screenshot(path='.test-output/studio-be.png',full_page=True)
 def test_studio_axe_in_three_themes(self):
  q=self.q
  for theme in ['light','dark','contrast']:
   q.locator('.settings-btn').click();q.locator(f'[data-theme="{theme}"]').click();self.studio();q.add_script_tag(path='.test-output/axe.min.js');result=q.evaluate("async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})");self.assertEqual(result['violations'],[],[(v['id'],[n['target'] for n in v['nodes']]) for v in result['violations']])
if __name__=='__main__':unittest.main(verbosity=2)
