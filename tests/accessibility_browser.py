"""UI/accessibility checks; axe scans do not replace real assistive-technology users."""
import unittest,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
URL='http://127.0.0.1:8000'
class UI(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':390,'height':844});self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.on('dialog',lambda d:d.accept());self.q.goto(URL);self.q.wait_for_selector('#echoDataPanel',state='attached')
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def settings(self):self.q.locator('.settings-btn').click()
 def reload(self):self.q.reload();self.q.wait_for_selector('#echoDataPanel',state='attached')
 def create(self):
  q=self.q;q.locator('.add-button').click();q.locator('#newPhraseName').fill('Моя фраза');q.locator('#newPhraseText').fill('Пожалуйста помоги');q.locator('#savePhrase').click();expect(q.locator('#addPhraseModal')).not_to_have_class('modal open')
 def test_simple_mode_preserves_data_and_access_to_sos_settings(self):
  self.create();before=self.q.evaluate('localStorage.getItem("echoCustomPhrases")');self.settings();self.q.locator('#echoSimpleMode').check();self.q.locator('#phrasesTab').click()
  expect(self.q.locator('.custom-card')).to_be_visible();expect(self.q.locator('.custom-card .edit-card')).to_be_hidden();self.q.locator('.echo-sos-nav').click();expect(self.q.locator('#echoSOSSpeak')).to_be_visible()
  self.reload();self.settings();expect(self.q.locator('#echoSimpleMode')).to_be_checked();self.q.locator('#echoSimpleMode').uncheck();self.q.locator('#phrasesTab').click();expect(self.q.locator('.custom-card .edit-card')).to_be_visible();self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),before)
 def test_three_themes_persist_and_backup_accepts_new_preferences(self):
  self.settings()
  for theme in ['light','dark','contrast']:
   self.q.locator(f'[data-theme="{theme}"]').click();self.reload();self.settings();expect(self.q.locator(f'[data-theme="{theme}"]')).to_have_attribute('aria-pressed','true')
  self.q.locator('#echoSimpleMode').check()
  result=self.q.evaluate('async()=>{const file=await echoBackup.exportFile(false);const restored=await echoBackup.parseFile(file);return restored.local;}')
  self.assertEqual(result['echoSimpleMode'],'true');self.assertEqual(result['echoTheme'],'contrast')
 def test_keyboard_dialogs_trap_and_return_focus(self):
  q=self.q;q.locator('.add-button').focus();q.keyboard.press('Enter');expect(q.locator('#newPhraseName')).to_be_focused();q.locator('#closeModal').focus();q.keyboard.press('Shift+Tab');expect(q.locator('#savePhrase')).to_be_focused();q.keyboard.press('Escape');expect(q.locator('.add-button')).to_be_focused()
  q.locator('.echo-add-category').click();q.locator('#echoCancelCategory').focus();q.keyboard.press('Shift+Tab');expect(q.locator('#echoSaveCategory')).to_be_focused();q.keyboard.press('Escape');expect(q.locator('.echo-add-category')).to_be_focused()
 def test_navigation_all_widths_orientations_and_reachable_actions(self):
  q=self.q
  for width in [320,360,375,390,430,768,1024,1280]:
   for height in [844,430]:
    q.set_viewport_size({'width':width,'height':height});self.assertTrue(q.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,height))
    for b in q.locator('.bottom-nav button:visible,.echo-action-dock button').all():
     rect=b.bounding_box();self.assertGreaterEqual(rect['width'],44);self.assertGreaterEqual(rect['height'],44)
    q.locator('#echoDockCompose').click();expect(q.locator('#echoSentence')).to_be_focused();q.locator('#echoDockStop').click();expect(q.locator('#echoSpeechStatus')).to_contain_text('остановлена')
 def test_quota_does_not_change_simple_mode(self):
  self.settings();self.q.evaluate("()=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='echoSimpleMode')throw new DOMException('full','QuotaExceededError');return old.call(this,k,v);};}")
  self.q.locator('#echoSimpleMode').click();expect(self.q.locator('#echoSimpleMode')).not_to_be_checked();expect(self.q.locator('#echoAccessStatus')).to_contain_text('не удалось',ignore_case=True)
 def test_many_cards_keep_buttons_semantic_and_search_responsive(self):
  self.q.evaluate("localStorage.setItem('echoCustomPhrases',JSON.stringify(Array.from({length:300},(_,i)=>({id:'c'+i,name:'Фраза '+i,text:'Сообщение '+i,emoji:'💧'}))))");self.reload();expect(self.q.locator('.custom-card')).to_have_count(300)
  self.q.locator('#echoSearchInput').fill('Сообщение 299');expect(self.q.locator('.custom-card:visible')).to_have_count(1);self.assertEqual(self.q.locator('button button,button [role="button"]').count(),0)
 def test_restore_keeps_contrast_and_simple_mode_and_offline_ui(self):
  self.create();self.settings();self.q.locator('[data-theme="contrast"]').click();self.q.locator('#echoSimpleMode').check()
  self.q.evaluate('async()=>{window.savedBackup=await echoBackup.parseFile(await echoBackup.exportFile(false));}')
  self.q.locator('#echoSimpleMode').uncheck();self.q.locator('[data-theme="light"]').click()
  self.q.evaluate("async()=>echoBackup.restore(savedBackup,'replace',false)")
  self.q.wait_for_function('navigator.serviceWorker.controller!==null');self.c.set_offline(True);self.reload();self.settings()
  expect(self.q.locator('#echoSimpleMode')).to_be_checked();expect(self.q.locator('[data-theme="contrast"]')).to_have_attribute('aria-pressed','true');self.q.locator('#phrasesTab').click();expect(self.q.locator('.custom-card')).to_be_visible()
 def test_keyboard_viewport_hides_fixed_controls(self):
  self.q.evaluate("()=>{window.fakeViewport=new EventTarget();fakeViewport.height=innerHeight;Object.defineProperty(window,'visualViewport',{value:fakeViewport});}")
  self.reload()
  # Real viewport events are covered by layout tests; emulate the reduced visual viewport explicitly.
  self.q.evaluate("()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>innerHeight-300});}")
  self.q.locator('#customPhrase').focus();self.q.evaluate("visualViewport.dispatchEvent(new Event('resize'))")
  expect(self.q.locator('.bottom-nav')).to_be_hidden();expect(self.q.locator('.echo-action-dock')).to_be_hidden()
 def test_card_size_setting_increases_touch_area_without_changing_cards(self):
  self.create();old=self.q.locator('.phrase-card').first.bounding_box()['width'];before=self.q.evaluate('localStorage.getItem("echoCustomPhrases")')
  self.settings();self.q.locator('[data-size="large"]').click();self.q.locator('#phrasesTab').click();self.assertGreater(self.q.locator('.phrase-card').first.bounding_box()['width'],old)
  self.reload();self.assertEqual(self.q.evaluate('localStorage.getItem("echoCardSize")'),'large');self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),before)
 def test_axe_wcag_aa_on_main_settings_dialog_and_sos_all_themes(self):
  axe=Path('.test-output/axe.min.js');self.assertTrue(axe.exists(),'Install integrity-verified axe-core test asset first')
  for theme in ['light','dark','contrast']:
   self.settings();self.q.locator(f'[data-theme="{theme}"]').click()
   for screen in ['main','settings','dialog','category','sos']:
    if screen=='main':self.q.locator('#phrasesTab').click()
    if screen=='settings':self.settings()
    if screen=='dialog':self.q.locator('.add-button').click()
    if screen=='category':self.q.locator('#closeModal').click();self.q.locator('#phrasesTab').click();self.q.locator('.echo-add-category').click()
    if screen=='sos':self.q.locator('#echoCancelCategory').click();self.q.locator('.echo-sos-nav').click()
    self.q.add_script_tag(path=str(axe))
    results=self.q.evaluate("async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22a','wcag22aa']}})")
    self.assertEqual([(v['id'],[(n['target'],n['failureSummary']) for n in v['nodes'][:5]]) for v in results['violations']],[],(theme,screen))

if __name__=='__main__':unittest.main(verbosity=2)
