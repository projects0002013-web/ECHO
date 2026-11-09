"""Commercial UI geometry, keyboard/text scaling and Android transport regressions."""
import json,unittest
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from voice_browser import MOCK
HOST=r'''(()=>{window.nativeRequests=[];window.nativeBytes=[];window.nativeFail=false;window.EchoAndroid={request(raw){const r=JSON.parse(raw);nativeRequests.push(r);let answer={};
 if(r.type==='ttsVoices')answer={voices:[{name:'Android RU local',lang:'ru-RU'},{name:'Android EN local',lang:'en-US'}],loading:false};
 else if(r.type==='status')answer={platform:'android',ready:false,languages:[]};
 else if(r.type==='ttsSpeak')answer={accepted:true};
 else if(r.type==='saveStart')answer={session:r.id};
 else if(r.type==='saveChunk'){if(nativeFail)answer={error:'Не удалось записать файл. Проверьте свободное место.'};else{nativeBytes.push(r.base64);answer={written:true};}}
 else if(r.type==='saveFinish')answer={saved:true};
 else if(r.type==='saveAbort')answer={saved:false};
 else answer={stopped:true};queueMicrotask(()=>window.echoNativeReply(r.id,answer));
 }}})();'''
class Redesign(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):self.c=self.b.new_context(viewport={'width':393,'height':852});self.c.add_init_script(MOCK);self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.on('dialog',lambda d:d.accept());self.q.goto('http://127.0.0.1:8000');self.ready()
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def ready(self):self.q.wait_for_selector('#echoDataPanel',state='attached')
 def create(self,name='Длинное название моей личной карточки для общения'):
  q=self.q;q.locator('.add-button').click();q.locator('#newPhraseName').fill(name);q.locator('#newPhraseText').fill('Пожалуйста, помогите мне найти человека, который сможет понять меня.');q.locator('#savePhrase').click();expect(q.locator('.custom-card')).to_be_visible()
 def test_one_stylesheet_four_main_tabs_and_persistent_sos(self):
  self.assertEqual(self.q.locator('link[rel=stylesheet]').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("href"))'),['executive-light.css']);self.assertEqual(self.q.locator('.bottom-nav button').count(),4)
  for target,section in [('.echo-history-nav','history'),('.echo-quick-nav','quick'),('#settingsTab','settings'),('.echo-sos-nav','sos'),('#phrasesTab','phrases')]:self.q.locator(target).click();self.assertEqual(self.q.evaluate('document.body.dataset.echoSection'),section);expect(self.q.locator('.echo-action-dock .echo-sos-nav')).to_be_visible()
  self.q.locator('#settingsTab').click();expect(self.q.locator('.echo-settings-group:visible')).to_have_count(5);expect(self.q.locator('.echo-settings-group').filter(has_text='Речь').locator('#echoVoiceSelect')).to_be_visible()
 def test_card_tools_do_not_overlap_text_at_required_sizes_and_orientation(self):
  self.create();q=self.q
  for width in [320,360,393,412,480,768]:
   for height in [852,390]:
    q.set_viewport_size({'width':width,'height':height});self.assertTrue(q.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,height));card=q.locator('.custom-card');text=card.locator('.phrase-text').bounding_box();tools=card.locator('.echo-card-tools').bounding_box();self.assertGreaterEqual(tools['y'],text['y']+text['height'])
    for selector in ['.echo-card-tools button','.echo-card-tools [role=button]']:
     for button in card.locator(selector).all():
      box=button.bounding_box();self.assertGreaterEqual(box['width'],44);self.assertGreaterEqual(box['height'],44)
 def test_text_200_percent_and_keyboard_modal_remain_usable(self):
  self.create();q=self.q;q.evaluate("document.documentElement.style.fontSize='200%'");self.assertTrue(q.evaluate('document.documentElement.scrollWidth<=innerWidth'));q.locator('.custom-card .edit-card').click();q.set_viewport_size({'width':393,'height':400});q.wait_for_function("document.querySelector('.modal-box').getBoundingClientRect().bottom<=innerHeight+1");box=q.locator('.modal-box').bounding_box();self.assertGreaterEqual(box['y'],0);self.assertLessEqual(box['y']+box['height'],401);q.locator('#savePhrase').scroll_into_view_if_needed();expect(q.locator('#savePhrase')).to_be_in_viewport();q.locator('#closeModal').click();expect(q.locator('.custom-card .edit-card')).to_be_focused()
 def test_actual_speech_state_outlasts_press_and_stop_is_clear(self):
  q=self.q;card=q.locator('.phrase-card').first;card.locator('.card-speak').click();expect(card).to_have_class(__import__('re').compile('echo-speaking'));q.wait_for_timeout(500);expect(card.locator('.echo-card-state')).to_have_text('Произносится');q.locator('#echoDockStop').click();expect(card.locator('.echo-card-state')).to_have_text('Выбрано');self.assertNotIn('echo-speaking',card.get_attribute('class'))
 def test_android_local_tts_transport_keeps_voice_settings_and_stop(self):
  self.c.add_init_script(HOST);self.q.reload();self.ready();q=self.q;q.wait_for_function('window.echoAndroidSpeech?.getVoices().length===2');q.locator('.settings-btn').click();q.locator('#echoVoiceSelect').select_option('Android RU local');q.locator('#echoTestVoice').click();q.wait_for_function("nativeRequests.some(x=>x.type==='ttsSpeak')");request=q.evaluate("nativeRequests.find(x=>x.type==='ttsSpeak')");self.assertEqual(request['voice'],'Android RU local');self.assertEqual(request['language'],'ru-RU');self.assertTrue(request['text']);q.evaluate("echoNativeTTSEvent(nativeRequests.find(x=>x.type==='ttsSpeak').utteranceId,'start')");expect(q.locator('#echoSpeechStatus')).to_contain_text('Произношу');q.locator('#echoStopSpeech').click();self.assertTrue(q.evaluate("nativeRequests.some(x=>x.type==='ttsStop')"))
 def test_android_backup_stream_has_valid_json_and_handles_storage_failure(self):
  self.c.add_init_script(HOST);self.q.reload();self.ready();q=self.q;q.locator('.settings-btn').click();q.locator('#echoBackupExport').click();q.wait_for_function("nativeRequests.some(x=>x.type==='saveFinish')");result=q.evaluate("JSON.parse(new TextDecoder().decode(Uint8Array.from(nativeBytes.map(x=>atob(x)).join(''),c=>c.charCodeAt(0))))");self.assertEqual(result['format'],'ECHO-backup');self.assertIn('sha256',result);self.assertTrue(all(len(r['base64'])<=90000 for r in q.evaluate("nativeRequests.filter(x=>x.type==='saveChunk')")))
  before=q.evaluate("localStorage.getItem('echoCustomPhrases')");q.evaluate('nativeFail=true');q.locator('#echoBackupExport').click();expect(q.locator('#echoBackupStatus')).to_contain_text('Не удалось записать файл');self.assertEqual(q.evaluate("localStorage.getItem('echoCustomPhrases')"),before)
if __name__=='__main__':unittest.main(verbosity=2)
