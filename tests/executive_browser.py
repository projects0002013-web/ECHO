"""Executive UI and experimental native boundary; no real on-device model is used."""
import unittest,json
from urllib.parse import urlsplit
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_smoke import tone
class Executive(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':390,'height':844});self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.goto('http://127.0.0.1:8000');self.ready()
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def ready(self):self.q.wait_for_selector('#echoDataPanel',state='attached');self.q.wait_for_selector('#echoOfflineModelPanel',state='attached')
 def studio(self):self.q.locator('#echoVoiceStudioNav').click()
 def test_voice_studio_ai_shortcut_is_visible_keyboard_accessible_and_no_fake_web_ai(self):
  q=self.q
  entry=q.locator('#echoVoiceStudioNav')
  expect(entry).to_be_visible()
  entry.click()
  shortcut=q.locator('#echoVoiceGoToAI')
  expect(shortcut).to_be_visible()
  expect(shortcut).to_have_attribute('aria-controls','echoStudioText')
  shortcut.click()
  expect(q.locator('#echoStudioText')).to_be_focused()
  self.assertFalse(q.evaluate("!!window.EchoAndroid"))
  self.assertTrue(q.evaluate("document.getElementById('echoVoiceHeroTitle').textContent.includes('фразу')"))
  self.assertTrue(q.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))

 def test_keyboard_arrows_home_end_on_cards_preserve_tab(self):
  q=self.q
  cards=q.locator('.phrase-card:not(.custom-card)')
  first=cards.nth(0)
  first.locator('.card-speak').focus()
  active_text="document.activeElement?.closest('.phrase-card')?.dataset.text"
  self.assertEqual(q.evaluate(active_text),first.get_attribute('data-text'))
  q.keyboard.press('ArrowRight')
  self.assertEqual(q.evaluate(active_text),cards.nth(1).get_attribute('data-text'))
  q.keyboard.press('End')
  self.assertEqual(q.evaluate(active_text),cards.nth(5).get_attribute('data-text'))
  q.keyboard.press('Home')
  self.assertEqual(q.evaluate(active_text),first.get_attribute('data-text'))
  # Tab navigates to another control instead of being consumed by arrow navigation.
  q.keyboard.press('Tab')
  self.assertFalse(q.evaluate("document.activeElement===document.querySelector('.phrase-card .card-speak')"))

 def test_sos_stop_and_persistent_stop_across_navigation(self):
  q=self.q
  activity=q.evaluate("""() => {
    window.testVoiceActivity=[];
    window.addEventListener('echo-voice-activity', e => testVoiceActivity.push(e.detail.playing));
    return document.querySelectorAll('#echoDockStop').length;
  }""")
  self.assertEqual(activity,1)
  q.locator('.echo-sos-nav').click()
  expect(q.locator('#echoSOSStop')).to_be_visible()
  q.locator('#echoSOSStop').click()
  expect(q.locator('#echoSpeechStatus')).to_contain_text('остановлена')
  self.assertIn(False,q.evaluate('window.testVoiceActivity'))
  q.locator('#settingsTab').click()
  expect(q.locator('#echoDockStop')).to_be_visible()
  q.locator('#echoDockStop').click()
  expect(q.locator('#echoSpeechStatus')).to_contain_text('остановлена')
  q.locator('#phrasesTab').click()
  expect(q.locator('#echoDockStop')).to_be_visible()
  self.assertEqual(self.errors,[])
 def test_talkback_navigation_and_card_toggle_states(self):
  q=self.q
  expect(q.locator('#phrasesTab')).to_have_attribute('aria-current','page')
  card=q.locator('.phrase-card:not(.custom-card)').first
  favorite=card.locator('.favorite-star')
  pin=card.locator('.echo-pin-button')
  expect(favorite).to_have_attribute('aria-pressed','false')
  expect(pin).to_have_attribute('aria-pressed','false')
  favorite.click()
  expect(favorite).to_have_attribute('aria-pressed','true')
  pin.click()
  expect(pin).to_have_attribute('aria-pressed','true')
  q.locator('#settingsTab').click()
  expect(q.locator('#settingsTab')).to_have_attribute('aria-current','page')
  self.assertEqual(q.locator('#phrasesTab[aria-current]').count(),0)
  q.locator('.echo-sos-nav').click()
  expect(q.locator('.echo-sos-nav')).to_have_attribute('aria-current','page')
  self.assertEqual(q.locator('#settingsTab[aria-current]').count(),0)
 def test_default_palette_professional_icons_and_personal_symbols_preserved(self):
  q=self.q
  self.assertEqual(q.evaluate('getComputedStyle(document.body).backgroundColor'),'rgb(248, 250, 248)');self.assertEqual(q.evaluate('getComputedStyle(document.body).color'),'rgb(23, 35, 27)');self.assertEqual(q.evaluate("getComputedStyle(document.body).getPropertyValue('--primary').trim()"),'#166534')
  self.assertEqual(q.locator('.phrase-card:not(.custom-card) .phrase-icon svg').count(),6)
  q.evaluate("localStorage.setItem('echoCustomPhrases',JSON.stringify([{id:'mine',name:'Моя',text:'Личное',emoji:'💧'}]))");q.reload();self.ready();expect(q.locator('.custom-card .phrase-icon')).to_have_text('💧');self.assertEqual(q.locator('.custom-card .phrase-icon svg').count(),0)
  q.screenshot(path='.test-output/executive-home.png',full_page=True)
 def test_existing_dark_contrast_and_backup_preferences_are_preserved(self):
  q=self.q
  for theme in ['dark','contrast','light']:
   q.locator('.settings-btn').click();q.locator(f'[data-theme="{theme}"]').click();q.reload();self.ready();q.locator('.settings-btn').click();expect(q.locator(f'[data-theme="{theme}"]')).to_have_attribute('aria-pressed','true')
   exported=q.evaluate('async()=> (await echoBackup.parseFile(await echoBackup.exportFile(false))).local');self.assertEqual(exported['echoTheme'],theme)
 def test_no_native_engine_means_no_fake_ready_or_network_calls(self):
  requests=[];self.q.on('request',lambda r:requests.append(r.url) if r.method=='POST' else None);self.studio();self.q.locator('#echoOfflineCheck').click();expect(self.q.locator('#echoOfflineModelStatus')).to_contain_text('не подключена');self.assertFalse(self.q.evaluate('(async()=> (await echoOfflineVoice.status()).ready)()'));self.assertEqual(requests,[])
  error=self.q.evaluate("async()=>{try{await echoOfflineVoice.synthesize({text:'New words',language:'en',reference:new Blob(['test']),consent:true});}catch(e){return e.message;}}")
  self.assertEqual(error,'native_missing');self.q.locator('#echoOfflineUseRecordings').click();self.assertEqual(self.q.evaluate("localStorage.getItem('echoSpeechMode')"),'recordings');self.q.locator('#echoOfflineUseDevice').click();self.assertEqual(self.q.evaluate("localStorage.getItem('echoSpeechMode')"),'device')
 def test_native_status_requires_model_license_reference_and_correct_language(self):
  q=self.q
  for bad in [{'engine':'other'},{'modelReady':False},{'licenseVerified':False},{'supportsReference':False},{'localOnly':False},{'languages':['ru']}]:
   q.evaluate("bad=>{window.echoNativeOfflineVoice={apiVersion:1,status:async()=>({...{engine:'sherpa-onnx-pocket',modelReady:true,licenseVerified:true,supportsReference:true,localOnly:true,languages:['en']},...bad}),synthesize:async()=>{throw Error('must not run')}}}",bad);self.assertFalse(q.evaluate('async()=> (await echoOfflineVoice.status()).ready'))
 def test_native_contract_passes_new_text_and_validates_wav_without_fetch(self):
  q=self.q;wav=list(tone(1));reference=list(tone(7));q.evaluate("wav=>{window.nativeCalls=[];window.echoNativeOfflineVoice={apiVersion:1,status:async()=>({engine:'sherpa-onnx-pocket',modelReady:true,licenseVerified:true,supportsReference:true,localOnly:true,languages:['en']}),synthesize:async request=>{nativeCalls.push({text:request.text,language:request.language,bytes:request.referenceWav.length,consent:request.consent});return new Uint8Array(wav);}};}",wav)
  result=q.evaluate("async bytes=>{const blob=await echoOfflineVoice.synthesize({text:'This is newly generated text.',language:'en',reference:new Blob([new Uint8Array(bytes)]),consent:true});return {size:blob.size,type:blob.type,calls:nativeCalls};}",reference)
  self.assertEqual(result['size'],len(wav));self.assertEqual(result['calls'][0]['bytes'],len(reference));self.assertEqual(result['calls'][0]['text'],'This is newly generated text.')
  for language,consent,error in [('ru',True,'language_unsupported'),('en',False,'owner_consent_required')]:
   actual=q.evaluate("async a=>{try{await echoOfflineVoice.synthesize({...a,text:'x',reference:new Blob(['x'])});}catch(e){return e.message;}}",{'language':language,'consent':consent});self.assertEqual(actual,error)
  self.assertEqual(q.evaluate('nativeCalls.length'),1)
 def test_four_languages_offline_model_status_and_responsive_studio(self):
  q=self.q;q.wait_for_function('navigator.serviceWorker.controller!==null')
  for lang in ['ru','kk','en','be']:
   q.locator('.settings-btn').click();q.locator(f'[data-language="{lang}"]').click();self.studio();q.locator('#echoOfflineCheck').click();expected=q.evaluate("echoI18n.t('Автономная модель телефона не подключена. Android и iPhone не проверены. Используйте голос устройства или записи.')");expect(q.locator('#echoOfflineModelStatus')).to_have_text(expected)
   for width in [320,375,390,768,1280]:q.set_viewport_size({'width':width,'height':844});self.assertTrue(q.evaluate('document.documentElement.scrollWidth<=innerWidth'),(lang,width))
  self.assertEqual(q.evaluate('[...echoI18n.missing]'),[]);q.set_viewport_size({'width':390,'height':844});q.screenshot(path='.test-output/executive-studio.png',full_page=True);self.c.set_offline(True);q.reload();self.ready();self.studio();expect(q.locator('#echoOfflineModelPanel')).to_be_visible()
 def test_public_pwa_has_no_fake_synthesis_action_or_sample_post(self):
  public=self.b.new_context(service_workers='block');posted=[]
  def asset(route):
   if route.request.method=='POST':posted.append(route.request.url);return route.fulfill(status=500,body='Unexpected upload')
   response=public.request.get('http://127.0.0.1:8000'+urlsplit(route.request.url).path);route.fulfill(response=response)
  public.route('https://echo.example/**',asset);q=public.new_page();q.on('pageerror',lambda e:self.errors.append(str(e)))
  try:
   q.goto('https://echo.example/index.html');q.wait_for_selector('#echoDataPanel',state='attached');q.locator('#echoVoiceStudioNav').click();expect(q.locator('#echoStudioGenerate')).to_be_disabled();expect(q.locator('#echoStudioGenerate')).to_contain_text('локального сервера ПК')
   q.locator('.settings-btn').click();q.locator('[data-language="en"]').click();q.locator('#echoVoiceStudioNav').click();expect(q.locator('#echoStudioGenerate')).to_be_disabled();expect(q.locator('#echoStudioGenerate')).to_contain_text('local computer server');self.assertEqual(posted,[])
  finally:public.close()
if __name__=='__main__':unittest.main(verbosity=2)
