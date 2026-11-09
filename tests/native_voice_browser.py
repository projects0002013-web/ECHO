"""Android JS bridge regressions. Host is mocked; these do NOT prove native inference."""
import base64,json,unittest
from playwright.sync_api import sync_playwright,expect
from browser_smoke import tone
from voice_browser import MOCK

class NativeVoice(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':393,'height':852});self.c.add_init_script(MOCK)
  self.c.add_init_script('''localStorage.setItem('echoLanguage','en');window.nativePhase='ready';window.nativeCalls=[];
    window.EchoAndroid={request(raw){const q=JSON.parse(raw);nativeCalls.push(q);
      let answer={};
      if(q.type==='status'||q.type==='prepare')answer={platform:'android',engine:'sherpa-onnx-pocket',localOnly:true,supportsReference:true,ready:nativePhase==='ready',phase:nativePhase,modelReady:nativePhase==='ready',licenseVerified:true,languages:['en']};
      if(q.type==='aiReferenceCheck')answer={valid:true,durationSeconds:7,sampleRate:24000};
      if(q.type==='synthesize'){window.nativeGeneration=q;if(window.holdGeneration)return;answer={wavBase64:window.resultWav};}
      if(q.type==='cancel')return;
      setTimeout(()=>window.echoNativeReply(q.id,answer),10);
    }};''')
  self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.on('dialog',lambda d:d.accept());self.q.goto('http://127.0.0.1:8000');self.q.wait_for_selector('#echoDataPanel',state='attached');self.q.locator('#echoVoiceStudioNav').click();self.q.evaluate('(wav)=>window.resultWav=wav',base64.b64encode(tone(1)).decode())
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def sample(self):
  self.q.locator('#echoAudioImport').set_input_files({'name':'owner-approved-test-tone.wav','mimeType':'audio/wav','buffer':tone(7)})
  expect(self.q.locator('#echoAudioDraft')).to_be_visible();self.q.locator('#echoVoiceConsent').check();self.q.locator('#echoDraftSave').click();expect(self.q.locator('#echoAudioDraft')).to_be_hidden()
 def prepare(self):
  self.sample();self.q.locator('#echoStudioText').fill('A completely new message.');self.q.locator('#echoStudioConsent').check()
 def count_cache(self):return self.q.evaluate("()=>new Promise(ok=>{const r=indexedDB.open('echo-local-voice',1);r.onsuccess=()=>{const t=r.result.transaction('cache'),q=t.objectStore('cache').count();t.oncomplete=()=>{ok(q.result);r.result.close();};};})")
 def test_android_messages_translate_in_all_four_languages(self):
  for language in ['ru','kk','en','be']:
   self.q.locator('.settings-btn').click();self.q.locator('[data-language="'+language+'"]').click();self.q.locator('#echoVoiceStudioNav').click();self.q.locator('#echoOfflineCheck').click()
   for element,key in [('#echoStudioPrivacyNote','Персональный голос создаёт новые английские фразы на этом Android по вашему образцу. Записи хранятся приватно на устройстве и не отправляются в облако.'),('#echoStudioSourceNote','Голос устройства использует установленные офлайн-голоса Android. PocketTTS создаёт новые фразы только на английском; для других языков доступны голос устройства и записи.')]:
    expect(self.q.locator(element)).to_have_text(self.q.evaluate('(key)=>echoI18n.t(key)',key))
   expect(self.q.locator('#echoOfflineModelStatus')).to_have_text(self.q.evaluate("echoI18n.t('Офлайн-модель PocketTTS найдена. Можно запустить английский AI-синтез с собственным WAV-образцом. Работа на устройстве ещё требует проверки.')"))
  self.assertEqual(self.q.evaluate('[...echoI18n.missing]'),[])
 def test_cache_quota_rolls_back_eviction_of_existing_audio(self):
  self.prepare()
  self.q.evaluate("""()=>new Promise(ok=>{const r=indexedDB.open('echo-local-voice',1);r.onsuccess=()=>{const d=r.result,t=d.transaction('cache','readwrite');for(let i=0;i<50;i++)t.objectStore('cache').put({key:'keep-'+i,blob:new Blob(['saved-audio']),time:i});t.oncomplete=()=>{d.close();ok();};};})""")
  self.q.evaluate("""()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='cache')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);};}""")
  self.q.locator('#echoStudioGenerate').click();expect(self.q.locator('#echoStudioResult')).to_be_visible();self.assertEqual(self.count_cache(),50)
  expect(self.q.locator('#echoStudioStatus')).to_contain_text('not saved offline',ignore_case=True)
 def test_stable_model_poll_does_not_repeat_screen_reader_announcements(self):
  expect(self.q.locator('#echoPCRequirement')).to_contain_text('The model is ready')
  self.q.evaluate("""()=>{window.statusMutations=0;new MutationObserver(records=>statusMutations+=records.length).observe(document.getElementById('echoPCRequirement'),{subtree:true,childList:true,characterData:true});}""")
  self.q.wait_for_timeout(3400);self.assertEqual(self.q.evaluate('statusMutations'),0)
 def test_old_page_native_reply_cannot_resolve_a_new_page_request(self):
  self.q.evaluate("""()=>{holdGeneration=true;echoNativeVoice.synthesize({text:'Old message.',language:'en',referenceWavBase64:'UklGRg==',consent:true}).catch(()=>{});}""")
  old=self.q.evaluate('nativeGeneration.id');self.q.reload();self.q.wait_for_selector('#echoDataPanel',state='attached')
  self.q.evaluate("""()=>{holdGeneration=true;window.replyState='pending';echoNativeVoice.synthesize({text:'New message.',language:'en',referenceWavBase64:'UklGRg==',consent:true}).then(()=>replyState='resolved').catch(()=>replyState='error');}""")
  new=self.q.evaluate('nativeGeneration.id');self.assertNotEqual(old,new)
  self.q.evaluate('(id)=>echoNativeReply(id,{wavBase64:"old-result"})',old);self.assertEqual(self.q.evaluate('replyState'),'pending')
  self.q.evaluate('(id)=>echoNativeReply(id,{wavBase64:"new-result"})',new);self.q.wait_for_function("replyState==='resolved'")
 def test_api_version_and_honest_gate(self):
  self.assertEqual(self.q.evaluate('echoNativeVoice.apiVersion'),1)
  self.assertTrue(self.q.evaluate('async()=>(await echoOfflineVoice.status()).ready'))
  expect(self.q.locator('#echoStudioGenerate')).to_be_disabled();self.prepare();expect(self.q.locator('#echoStudioGenerate')).to_be_enabled()
  self.q.locator('#echoStudioConsent').uncheck();expect(self.q.locator('#echoStudioGenerate')).to_be_disabled();self.q.locator('#echoStudioStop').click();expect(self.q.locator('#echoStudioGenerate')).to_be_disabled()
 def test_loading_and_failed_model_cannot_generate(self):
  self.q.evaluate("nativePhase='loading'");self.prepare();expect(self.q.locator('#echoStudioGenerate')).to_be_disabled();expect(self.q.locator('#echoPCRequirement')).to_contain_text('Loading',timeout=6000)
  self.q.evaluate("nativePhase='error'");expect(self.q.locator('#echoPCRequirement')).to_contain_text('Could not',timeout=6000);expect(self.q.locator('#echoStudioGenerate')).to_be_disabled()
  self.assertFalse(self.q.evaluate("nativeCalls.some(q=>q.type==='synthesize')"))
 def test_native_new_text_is_cached_and_plays_without_model(self):
  self.prepare();self.q.locator('#echoStudioGenerate').click();expect(self.q.locator('#echoStudioResult')).to_be_visible();self.assertEqual(self.count_cache(),1)
  q=self.q.evaluate('nativeGeneration');self.assertEqual(q['text'],'A completely new message.');self.assertEqual(q['language'],'en');self.assertTrue(q['consent']);self.assertEqual(base64.b64decode(q['referenceWavBase64'])[:4],b'RIFF')
  self.q.evaluate("nativePhase='error'");self.q.locator('#echoStudioUse').click();self.q.evaluate("echoLocalSpeech('A completely new message.')")
  expect(self.q.locator('#echoSpeechStatus')).to_contain_text('saved',ignore_case=True);self.assertEqual(self.q.evaluate("nativeCalls.filter(q=>q.type==='synthesize').length"),1)
 def test_withdrawing_consent_cancels_inflight_native_request(self):
  self.prepare();self.q.evaluate('holdGeneration=true');self.q.locator('#echoStudioGenerate').click();self.q.wait_for_function('window.nativeGeneration')
  self.q.locator('#echoStudioConsent').uncheck();self.q.wait_for_function("nativeCalls.some(q=>q.type==='cancel')")
  self.q.evaluate("echoNativeReply(nativeGeneration.id,{wavBase64:resultWav})");expect(self.q.locator('#echoStudioResult')).to_be_hidden();expect(self.q.locator('#echoStudioGenerate')).to_be_disabled();self.assertEqual(self.count_cache(),0)
 def test_stop_rejects_late_result_and_next_request_works(self):
  self.prepare();self.q.evaluate('holdGeneration=true');self.q.locator('#echoStudioGenerate').click();self.q.wait_for_function('window.nativeGeneration');self.q.locator('#echoStudioStop').click()
  self.q.evaluate("echoNativeReply(nativeGeneration.id,{wavBase64:resultWav})");expect(self.q.locator('#echoStudioResult')).to_be_hidden();self.assertEqual(self.count_cache(),0);self.assertTrue(self.q.evaluate("nativeCalls.some(q=>q.type==='cancel')"))
  self.q.evaluate('holdGeneration=false');self.q.locator('#echoStudioGenerate').click();expect(self.q.locator('#echoStudioResult')).to_be_visible();self.assertEqual(self.count_cache(),1)

if __name__=='__main__':unittest.main(verbosity=2)
