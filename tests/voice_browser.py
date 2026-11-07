"""Voice integration regressions. Web Speech is deterministic; WAV/IndexedDB are real."""
import json
import tempfile
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright, expect
from browser_smoke import tone

URL='http://127.0.0.1:8000'
MOCK=r'''
(() => {
 const voices=[['RU one','ru-RU'],['RU two','ru-RU'],['EN local','en-US'],['KK local','kk-KZ'],['BE local','be-BY']].map(([name,lang])=>({name,lang,localService:true}));
 class Synth extends EventTarget {
   constructor(){super();this.voices=voices;this.calls=[];this.cancels=0;}
   getVoices(){return this.voices;}
   speak(u){this.calls.push({u,end:u.onend,error:u.onerror,start:u.onstart});u.onstart?.();}
   cancel(){this.cancels++;}
 }
 window.testSpeech=new Synth();Object.defineProperty(window,'speechSynthesis',{value:testSpeech,configurable:true});
 window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
 window.setTestVoices=(voices)=>{testSpeech.voices=voices;testSpeech.dispatchEvent(new Event('voiceschanged'));};
})();
'''

class VoiceBrowser(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.runtime=sync_playwright().start();cls.temp=tempfile.TemporaryDirectory()
  microphone=Path(cls.temp.name)/'mic.wav';microphone.write_bytes(tone(10))
  cls.browser=cls.runtime.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={microphone}'])
 @classmethod
 def tearDownClass(cls):cls.browser.close();cls.runtime.stop();cls.temp.cleanup()
 def setUp(self):
  self.context=self.browser.new_context(viewport={'width':390,'height':844},permissions=['microphone'])
  self.context.add_init_script(MOCK);self.page=self.context.new_page();self.errors=[]
  self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.on('dialog',lambda d:d.accept())
  self.page.goto(URL);self.page.wait_for_function('navigator.serviceWorker.controller !== null')
 def tearDown(self):
  self.assertEqual(self.errors,[]);self.context.close()
 def settings(self):self.page.locator('.settings-btn').click()
 def stage(self,seconds=1,target='phrase',text='Я хочу пить'):
  p=self.page;p.locator('#echoRecordTarget').select_option(target)
  if target=='phrase':p.locator('#echoRecordText').fill(text)
  p.locator('#echoAudioImport').set_input_files({'name':'voice.wav','mimeType':'audio/wav','buffer':tone(seconds)})
  expect(p.locator('#echoAudioDraft')).to_be_visible()
 def save_draft(self,sample=False):
  if sample:self.page.locator('#echoVoiceConsent').check()
  self.page.locator('#echoDraftSave').click();expect(self.page.locator('#echoAudioDraft')).to_be_hidden()
 def db_records(self,store='audio'):
  return self.page.evaluate('''store=>new Promise((resolve,reject)=>{const r=indexedDB.open('echo-local-voice',1);r.onsuccess=()=>{const d=r.result,t=d.transaction(store),q=t.objectStore(store).getAll();t.oncomplete=()=>{resolve(q.result.map(x=>({key:x.key,id:x.id,size:x.blob.size,type:x.blob.type})));d.close();};r.onerror=()=>reject(r.error);};})''',store)
 def test_voice_choice_survives_reload_and_language_roundtrip(self):
  p=self.page;self.settings();p.locator('#echoVoiceSelect').select_option('RU two');p.reload();self.settings()
  expect(p.locator('#echoVoiceSelect')).to_have_value('RU two')
  p.locator('[data-language="en"]').click();p.locator('#echoVoiceSelect').select_option('EN local')
  p.locator('[data-language="ru"]').click();expect(p.locator('#echoVoiceSelect')).to_have_value('RU two')
 def test_all_four_languages_and_rate_keep_explicit_voice(self):
  p=self.page;self.settings();p.locator('#echoVoiceRate').fill('1.2');p.locator('#echoVoiceRate').dispatch_event('input')
  for language,voice in [('ru','RU one'),('kk','KK local'),('en','EN local'),('be','BE local')]:
   p.locator(f'[data-language="{language}"]').click();p.locator('#echoVoiceSelect').select_option(voice)
   p.locator('#echoTestVoice').click()
   result=p.evaluate('() => {const u=testSpeech.calls.at(-1).u;return {lang:u.lang,voice:u.voice.name,rate:u.rate,text:u.text};}')
   self.assertTrue(result['lang'].startswith(language));self.assertEqual(result['voice'],voice);self.assertEqual(result['rate'],1.2);self.assertTrue(result['text'])
  p.reload();self.settings();expect(p.locator('#echoVoiceRate')).to_have_value('1.2');expect(p.locator('[data-language="be"]')).to_have_attribute('aria-pressed','true')
 def test_rapid_clicks_and_late_events_do_not_replace_new_status(self):
  p=self.page;p.locator('.card-speak').nth(0).click();p.locator('.card-speak').nth(1).click()
  self.assertEqual(p.evaluate('testSpeech.calls.map(c=>c.u.text)'),['Я хочу пить','Я хочу есть'])
  p.evaluate('() => testSpeech.calls[0].end()')
  expect(p.locator('#echoSpeechStatus')).to_contain_text('Произношу')
  p.locator('#echoStopSpeech').click();p.evaluate('() => testSpeech.calls[1].end()')
  expect(p.locator('#echoSpeechStatus')).to_contain_text('остановлена');self.assertTrue(p.evaluate('testSpeech.cancels')>=2)
 def test_web_speech_errors_and_sync_throw_are_visible(self):
  p=self.page;p.locator('.card-speak').first.click();p.evaluate('() => testSpeech.calls.at(-1).error({error:"not-allowed"})')
  expect(p.locator('#echoSpeechStatus')).to_contain_text('заблокировал')
  p.evaluate('() => {testSpeech.speak=()=>{throw new Error("engine unavailable")};}')
  p.locator('.card-speak').first.click();expect(p.locator('#echoSpeechStatus')).to_contain_text('Не удалось запустить')
 def test_empty_delayed_and_missing_voice_never_replay_old_phrase(self):
  p=self.page;self.settings();p.locator('#echoVoiceSelect').select_option('RU two')
  p.evaluate('() => setTestVoices([])');p.locator('#echoTestVoice').click()
  expect(p.locator('#echoSpeechStatus')).to_contain_text('Нет локального голоса')
  self.assertEqual(p.evaluate('testSpeech.calls.length'),0)
  p.evaluate('() => setTestVoices([{name:"Fallback",lang:"ru-RU",localService:true}])')
  expect(p.locator('#echoVoiceAvailability')).to_contain_text('недоступен');expect(p.locator('#echoVoiceSelect')).to_have_value('RU two')
  self.assertEqual(p.evaluate('testSpeech.calls.length'),0)
  p.locator('#echoTestVoice').click();self.assertEqual(p.evaluate('testSpeech.calls[0].u.voice.name'),'Fallback')
  self.assertEqual(p.evaluate('echoCurrentLanguage'),'ru')
 def test_voice_change_and_language_change_stop_active_speech(self):
  p=self.page;self.settings();p.locator('#echoTestVoice').click();before=p.evaluate('testSpeech.cancels')
  p.locator('#echoVoiceSelect').select_option('RU two');self.assertGreater(p.evaluate('testSpeech.cancels'),before)
  p.locator('#echoTestVoice').click();before=p.evaluate('testSpeech.cancels');p.locator('[data-language="en"]').click()
  self.assertGreater(p.evaluate('testSpeech.cancels'),before)
 def test_preview_discard_save_and_offline_legacy_recording(self):
  p=self.page;self.settings();self.stage();self.assertEqual(self.db_records(),[])
  p.locator('#echoDraftPlay').click();p.locator('#echoDraftDiscard').click();self.assertEqual(self.db_records(),[])
  self.stage();self.save_draft();records=self.db_records();self.assertEqual(records[0]['type'],'audio/wav');self.assertGreater(records[0]['size'],44)
  p.locator('#echoSpeechMode').select_option('recordings');p.reload();self.context.set_offline(True)
  p.locator('.card-speak').first.click();expect(p.locator('#echoSpeechStatus')).to_contain_text('сохранённой записью')
  self.settings();p.locator('#echoRecordingsList button').last.click();expect(p.locator('#echoRecordingsList')).to_contain_text('пока нет')
 def test_sample_requires_permission_confirmation_and_preserves_old_audio(self):
  self.settings();self.stage(7,'sample');expect(self.page.locator('#echoDraftSave')).to_be_disabled();self.assertEqual(self.db_records(),[])
  self.save_draft(True);old=self.db_records();self.stage(8,'sample');self.page.locator('#echoDraftDiscard').click();self.assertEqual(self.db_records(),old)
 def test_source_change_cancels_and_persists_without_automatic_speech(self):
  p=self.page;p.locator('.card-speak').first.click();self.settings();before=p.evaluate('testSpeech.cancels')
  p.locator('#echoSpeechMode').select_option('recordings');self.assertGreater(p.evaluate('testSpeech.cancels'),before)
  p.reload();self.settings();expect(p.locator('#echoSpeechMode')).to_have_value('recordings');self.assertEqual(p.evaluate('testSpeech.calls.length'),0)
 def test_microphone_permission_denial_does_not_save_or_stay_busy(self):
  p=self.page;self.settings();p.evaluate('() => {navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException("denied","NotAllowedError"));}')
  p.locator('#echoRecordStart').click();expect(p.locator('#echoLocalVoiceStatus')).to_contain_text('Разрешите доступ')
  expect(p.locator('#echoRecordStart')).to_be_enabled();expect(p.locator('#echoRecordStop')).to_be_disabled();self.assertEqual(self.db_records(),[])
 def test_late_microphone_permission_is_stopped_after_leaving_settings(self):
  p=self.page;self.settings();p.evaluate('''() => {window.trackStopped=false; navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.allowMic=()=>r({getTracks:()=>[{stop(){trackStopped=true;}}]}));}''')
  p.locator('#echoRecordStart').click();p.locator('#phrasesTab').click();p.evaluate('() => allowMic()');p.wait_for_function('trackStopped')
  self.settings();expect(p.locator('#echoRecordStop')).to_be_disabled();self.assertEqual(self.db_records(),[])
 def test_worklet_loading_cannot_restart_canceled_recording(self):
  p=self.page;self.settings();p.evaluate('''() => {window.micClosed=false;window.resumed=false;
    navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){micClosed=true;}}]});
    window.AudioContext=class {constructor(){this.audioWorklet={addModule:()=>new Promise(r=>window.finishWorklet=r)};}
      async close(){} async resume(){resumed=true;} };
  }''')
  p.locator('#echoRecordStart').click();p.wait_for_function('typeof finishWorklet==="function"');p.locator('#phrasesTab').click();p.evaluate('() => finishWorklet()')
  p.wait_for_timeout(50);self.assertFalse(p.evaluate('resumed'));self.assertTrue(p.evaluate('micClosed'))
 def test_indexeddb_write_failure_keeps_preview_and_old_data(self):
  p=self.page;self.settings();self.stage()
  p.evaluate('''() => {const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='audio')throw new DOMException('full','QuotaExceededError');return old.apply(this,args);};}''')
  p.locator('#echoDraftSave').click();expect(p.locator('#echoAudioDraft')).to_be_visible();expect(p.locator('#echoLocalVoiceStatus')).not_to_contain_text('сохранена')
  self.assertEqual(self.db_records(),[]);expect(p.locator('#echoDraftSave')).to_be_enabled()
 def test_unavailable_ai_offers_explicit_alternative_without_upload(self):
  p=self.page;self.settings();p.locator('#echoSpeechMode').select_option('personal');p.locator('#phrasesTab').click();p.locator('.card-speak').first.click()
  expect(p.locator('#echoVoiceFallback')).to_be_visible();expect(p.locator('#echoSpeechStatus')).to_contain_text('Сначала запишите')
  p.locator('#echoUseDevice').click();p.locator('.card-speak').first.click();self.assertEqual(p.evaluate('testSpeech.calls.length'),1)
 def test_personal_cache_survives_reload_offline_and_stop_discards_old_result(self):
  p=self.page;self.settings();self.stage(7,'sample');self.save_draft(True)
  calls=[]
  def generate(route):calls.append(route.request.post_data_json);route.fulfill(status=200,content_type='audio/wav',body=tone(2))
  p.route('**/api/voice/synthesize',generate);p.locator('#echoSpeechMode').select_option('personal');p.locator('#phrasesTab').click();p.locator('.card-speak').first.click()
  expect(p.locator('#echoSpeechStatus')).to_contain_text('Произношу персональным');self.assertEqual(len(calls),1)
  p.locator('#echoStopSpeech').click();p.reload();p.wait_for_function('!document.getElementById("echoSamplePlay").disabled');self.context.set_offline(True)
  p.locator('.card-speak').first.click();expect(p.locator('#echoSpeechStatus')).to_contain_text('сохранённая фраза');self.assertEqual(len(calls),1)
 def test_audio_autoplay_error_is_not_reported_as_microphone_denial(self):
  p=self.page;self.settings();self.stage();p.evaluate('() => {HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException("blocked","NotAllowedError"));}')
  p.locator('#echoDraftPlay').click();expect(p.locator('#echoLocalVoiceStatus')).to_contain_text('заблокировал звук');expect(p.locator('#echoLocalVoiceStatus')).not_to_contain_text('микрофон')
  expect(p.locator('#echoResumeAudio')).to_be_visible()
  p.evaluate('() => {HTMLMediaElement.prototype.play=async()=>{};}')
  p.locator('#echoResumeAudio').click();expect(p.locator('#echoSpeechStatus')).to_contain_text('Произношу подготовленную')

 def test_source_persistence_failure_rolls_back(self):
  p=self.page;self.settings();p.evaluate('''() => {const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='echoSpeechMode')throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};}''')
  p.locator('#echoSpeechMode').select_option('personal');expect(p.locator('#echoSpeechMode')).to_have_value('device');expect(p.locator('#echoLocalVoiceStatus')).to_contain_text('не сохранён')
 def test_piper_old_timeout_cannot_abort_new_request_or_play_stale_audio(self):
  p=self.page
  p.evaluate("""() => {
   echoPiperConfig.enabled=true;echoPiperConfig.voice='local';window.piperRequests=[];window.piperTimers=[];window.piperPlays=0;
   const fetchOriginal=window.fetch;window.fetch=(url,options)=>String(url).includes(':8765/api/tts')
    ? new Promise(resolve=>piperRequests.push({resolve,signal:options.signal})) : fetchOriginal(url,options);
   const timerOriginal=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{
    if(ms===15000)piperTimers.push(fn);return timerOriginal(fn,ms,...args);};
   HTMLMediaElement.prototype.play=async()=>{piperPlays++;};
  }""")
  p.locator('.card-speak').nth(0).click();p.wait_for_function('piperRequests.length===1')
  p.locator('.card-speak').nth(1).click();p.wait_for_function('piperRequests.length===2')
  p.evaluate('() => piperTimers[0]()')
  self.assertTrue(p.evaluate('piperRequests[0].signal.aborted'));self.assertFalse(p.evaluate('piperRequests[1].signal.aborted'))
  p.locator('#echoStopSpeech').click();self.assertTrue(p.evaluate('piperRequests[1].signal.aborted'))
  p.evaluate("""() => piperRequests.forEach(r=>r.resolve(new Response(new Blob([new Uint8Array(44)],{type:'audio/wav'}),{headers:{'Content-Type':'audio/wav'}})))""")
  p.wait_for_timeout(50);self.assertEqual(p.evaluate('piperPlays'),0);expect(p.locator('#echoSpeechStatus')).to_contain_text('остановлена')
 def test_missing_piper_offers_device_without_changing_language(self):
  p=self.page;p.route('http://127.0.0.1:8765/**',lambda route:route.abort())
  p.evaluate("() => {echoPiperConfig.enabled=true;echoPiperConfig.voice='local';}")
  p.locator('.card-speak').first.click();expect(p.locator('#echoSpeechStatus')).to_contain_text('Piper недоступен')
  p.locator('#echoUseDevice').click();p.locator('.card-speak').first.click()
  self.assertEqual(p.evaluate('testSpeech.calls.length'),1);self.assertEqual(p.evaluate('echoCurrentLanguage'),'ru')
 def test_stopped_personal_response_never_repopulates_cache(self):
  p=self.page;self.settings();self.stage(7,'sample');self.save_draft(True)
  p.evaluate("""() => {const fetchOriginal=window.fetch;window.fetch=(url,options)=>String(url)==='/api/voice/synthesize'
    ? new Promise(resolve=>window.releasePersonal=()=>resolve(new Response(new Blob([new Uint8Array(44)],{type:'audio/wav'}))))
    : fetchOriginal(url,options);}""")
  p.locator('#echoSpeechMode').select_option('personal');p.locator('#phrasesTab').click();p.locator('.card-speak').first.click()
  p.wait_for_function('typeof releasePersonal==="function"');p.locator('#echoStopSpeech').click();p.evaluate('() => releasePersonal()')
  p.wait_for_timeout(50);self.assertEqual(self.db_records('cache'),[]);expect(p.locator('#echoSpeechStatus')).to_contain_text('остановлена')
 def test_cache_quota_is_visible_but_does_not_prevent_playback(self):
  p=self.page;self.settings();self.stage(7,'sample');self.save_draft(True)
  p.route('**/api/voice/synthesize',lambda route:route.fulfill(status=200,content_type='audio/wav',body=tone(2)))
  p.evaluate("""() => {const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='cache')throw new DOMException('full','QuotaExceededError');return old.apply(this,args);};}""")
  p.locator('#echoSpeechMode').select_option('personal');p.locator('#phrasesTab').click();p.locator('.card-speak').first.click()
  expect(p.locator('#echoSpeechStatus')).to_contain_text('не сохранено офлайн');self.assertEqual(self.db_records('cache'),[])
 def test_voice_selection_quota_rolls_back_without_erasing_previous_choice(self):
  p=self.page;self.settings();p.locator('#echoVoiceSelect').select_option('RU two')
  p.evaluate("""() => {const old=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='echoSettings')throw new DOMException('full','QuotaExceededError');return old.call(this,k,v);};}""")
  p.locator('#echoVoiceSelect').select_option('RU one');expect(p.locator('#echoVoiceSelect')).to_have_value('RU two')
  self.assertEqual(p.evaluate('JSON.parse(localStorage.getItem("echoSettings")).voiceName'),'RU two')
 def test_voice_settings_and_preview_fit_mobile_widths(self):
  p=self.page;self.settings();self.stage(7,'sample')
  for width in [320,375,390,768,1280]:
   p.set_viewport_size({'width':width,'height':900});self.assertTrue(p.evaluate('document.documentElement.scrollWidth<=innerWidth'),width)
   for selector in ['#echoDraftPlay','#echoDraftSave','#echoDraftDiscard','#echoStopSpeech','#echoTestVoice']:
    self.assertGreaterEqual(p.locator(selector).bounding_box()['height'],44,(width,selector))
 def test_replaced_sample_cannot_reuse_previous_voice_cache(self):
  p=self.page;self.settings();self.stage(7,'sample');self.save_draft(True)
  old=self.db_records()[0]['id']
  p.evaluate("""old=>new Promise(resolve=>{const r=indexedDB.open('echo-local-voice',1);r.onsuccess=()=>{const d=r.result,t=d.transaction('cache','readwrite');t.objectStore('cache').put({key:old+':ru:Я хочу пить',blob:new Blob(['old']),time:Date.now()});t.oncomplete=()=>{d.close();resolve();};};})""",old)
  self.stage(8,'sample');self.save_draft(True);self.assertNotEqual(self.db_records()[0]['id'],old);self.assertEqual(self.db_records('cache'),[])
 def test_stop_before_microphone_permission_cannot_save_empty_wav(self):
  p=self.page;self.settings();p.evaluate("""() => {window.closedTrack=false;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.resolveMicrophone=()=>r({getTracks:()=>[{stop(){closedTrack=true;}}]}));}""")
  p.locator('#echoRecordStart').click();p.locator('#echoRecordStop').click()
  expect(p.locator('#echoRecordStart')).to_be_enabled();expect(p.locator('#echoAudioDraft')).to_be_hidden()
  p.evaluate('() => resolveMicrophone()');p.wait_for_function('closedTrack');self.assertEqual(self.db_records(),[])
 def test_language_change_cancels_pending_recording(self):
  p=self.page;self.settings();p.evaluate("""() => {window.closedTrack=false;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.resolveMicrophone=()=>r({getTracks:()=>[{stop(){closedTrack=true;}}]}));}""")
  p.locator('#echoRecordStart').click();p.locator('[data-language="en"]').click()
  p.evaluate('() => resolveMicrophone()');p.wait_for_function('closedTrack');expect(p.locator('#echoRecordStop')).to_be_disabled();self.assertEqual(self.db_records(),[])
 def test_voice_controls_keyboard_and_status_semantics(self):
  p=self.page;self.settings();p.locator('#echoVoiceSelect').focus();p.keyboard.press('ArrowDown');p.keyboard.press('Tab')
  self.assertEqual(p.locator('#echoSpeechStatus').get_attribute('role'),'status');self.assertEqual(p.locator('#echoSpeechStatus').get_attribute('aria-live'),'polite')
  p.locator('#echoTestVoice').focus();p.keyboard.press('Enter');self.assertEqual(p.evaluate('testSpeech.calls.length'),1)
  p.locator('#echoStopSpeech').focus();p.keyboard.press('Enter');expect(p.locator('#echoSpeechStatus')).to_contain_text('остановлена')

if __name__=='__main__':unittest.main(verbosity=2)
