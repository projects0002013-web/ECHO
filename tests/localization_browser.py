"""Four-language UI, user-data isolation, catalog contracts and offline restoration."""
import json,re,unittest
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_smoke import tone
from voice_browser import MOCK
URL='http://127.0.0.1:8000'
class Locales(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':390,'height':844});self.q=self.c.new_page();self.errors=[];self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.dialog=lambda d:d.accept();self.q.on('dialog',self.dialog);self.q.goto(URL);self.ready()
 def tearDown(self):self.assertEqual(self.errors,[]);self.c.close()
 def ready(self):self.q.wait_for_selector('#echoDataPanel',state='attached')
 def language(self,lang):self.q.locator('.settings-btn').click();self.q.locator(f'[data-language="{lang}"]').click();self.q.wait_for_function('(lang)=>echoI18n.language===lang',arg=lang)
 def test_catalog_keys_placeholders_and_no_empty_values(self):
  data=json.loads(Path('locales/catalog.json').read_text())['messages'];keys=set(data['ru']);self.assertGreaterEqual(len(keys),400)
  for lang in ['ru','kk','en','be']:
   self.assertEqual(set(data[lang]),keys)
   for key,value in data[lang].items():self.assertTrue(value.strip());self.assertEqual(sorted(re.findall(r'\{v\d+\}',key)),sorted(re.findall(r'\{v\d+\}',value)),(lang,key))
 def test_menu_settings_forms_and_sos_in_all_languages(self):
  for lang,phrases,settings,backup in [('ru','Фразы','Настройки','Мои данные'),('kk','Фразалар','Баптаулар','Менің деректерім'),('en','Phrases','Settings','My data'),('be','Фразы','Налады','Мае даныя')]:
   self.language(lang);expect(self.q.locator('#phrasesTab')).to_contain_text(phrases);expect(self.q.locator('#settingsTab')).to_contain_text(settings);expect(self.q.locator('#echoDataPanel h3')).to_have_text(backup)
   self.q.locator('.add-button').click();expected=self.q.evaluate("echoI18n.t('Карточка фразы')");expect(self.q.locator('#addPhraseModal')).to_have_attribute('aria-label',expected);self.q.locator('#closeModal').click()
   self.q.locator('.echo-sos-nav').click();expected=self.q.evaluate("echoI18n.t('Помогите! Мне срочно нужна помощь!')");expect(self.q.locator('#echoSOSMessage')).to_have_text(expected)
 def test_user_text_categories_favorites_and_order_never_translate(self):
  self.q.evaluate('''()=>{localStorage.setItem('echoCustomPhrases',JSON.stringify([{id:'mine',name:'Настройки',text:'Удалить <img src=x onerror=alert(1)>',emoji:'💧'}]));localStorage.setItem('echoUserCategories',JSON.stringify([{id:'user-a',name:'Избранное',icon:'📁'}]));localStorage.setItem('echoCardCategories',JSON.stringify({mine:'user-a'}));localStorage.setItem('echoFavorites','["custom:mine"]');}''');self.q.reload();self.ready();before=self.q.evaluate('localStorage.getItem("echoCustomPhrases")')
  for lang in ['en','kk','be','ru']:
   self.language(lang);self.q.locator('#phrasesTab').click();expect(self.q.locator('.custom-card .phrase-name')).to_have_text('Настройки');expect(self.q.locator('.custom-card .phrase-text')).to_have_text('Удалить <img src=x onerror=alert(1)>');expect(self.q.locator('.echo-user-category span').last).to_have_text('Избранное');self.assertEqual(self.q.locator('.custom-card img').count(),0);self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),before)
 def test_language_persists_and_catalog_is_offline(self):
  self.q.wait_for_function('navigator.serviceWorker.controller!==null')
  for lang in ['kk','en','be','ru']:
   self.language(lang);self.q.reload();self.ready();self.q.wait_for_function('(lang)=>echoI18n.language===lang',arg=lang);self.assertEqual(self.q.evaluate('document.documentElement.lang'),lang);self.assertEqual(self.q.evaluate("async()=>{const link=document.querySelector('link[rel=manifest]');return (await (await fetch(link.href)).json()).lang;}"),lang)
  self.language('be');self.c.set_offline(True);self.q.reload();self.ready();self.language('kk');expect(self.q.locator('#echoDataPanel h3')).to_have_text('Менің деректерім')
 def test_dynamic_errors_and_variable_text_are_safe(self):
  self.language('en');self.q.evaluate("echoShowSaveError()");expected=self.q.evaluate("echoI18n.t('Не удалось сохранить карточку. Проверьте свободное место и настройки браузера. Окно осталось открытым, чтобы вы не потеряли текст.')");expect(self.q.locator('#echoSaveError')).to_have_text(expected)
  self.q.evaluate("document.getElementById('echoAccessStatus').textContent='Порядок изменён: <script>boom</script>'")
  expect(self.q.locator('#echoAccessStatus')).to_have_text('Order changed: <script>boom</script>');self.assertEqual(self.q.locator('#echoAccessStatus script').count(),0)
  self.language('kk');expect(self.q.locator('#echoAccessStatus')).to_have_text('Реті өзгертілді: <script>boom</script>')
 def test_native_dialog_and_import_errors_are_localized(self):
  self.language('en');self.q.locator('#echoBackupFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'bad json'})
  expect(self.q.locator('#echoBackupStatus')).to_have_text('Error: Could not read the file. Check the format and try again.')
  result=self.q.evaluate("echoI18n.translate('Удалить категорию «Настройки»? Карточки сохранятся.')");self.assertEqual(result,'Delete category “Настройки”? Cards will remain.')
 def test_backup_preview_restore_preserves_language_and_preferences(self):
  self.language('kk');self.q.locator('[data-theme="contrast"]').click();self.q.locator('#echoSimpleMode').check()
  self.q.evaluate('async()=>{window.copy=await echoBackup.parseFile(await echoBackup.exportFile(false));}')
  self.q.locator('#echoSimpleMode').uncheck();self.language('en');self.q.evaluate("async()=>echoBackup.restore(copy,'replace',false)");self.q.reload();self.ready();expect(self.q.locator('#phrasesTab')).to_contain_text('Фразалар');self.q.locator('.settings-btn').click();expect(self.q.locator('#echoSimpleMode')).to_be_checked()
 def test_recording_and_preview_are_translated_without_changing_wav(self):
  for lang in ['ru','kk','en','be']:
   self.language(lang);self.q.locator('#echoRecordTarget').select_option('phrase');self.q.locator('#echoRecordText').fill('Настройки');self.q.locator('#echoAudioImport').set_input_files({'name':'voice.wav','mimeType':'audio/wav','buffer':tone(1)});expect(self.q.locator('#echoAudioDraft')).to_be_visible();expected=self.q.evaluate("echoI18n.t('Сохранить запись')");expect(self.q.locator('#echoDraftSave')).to_have_text(expected);self.q.locator('#echoDraftSave').click();expect(self.q.locator('#echoAudioDraft')).to_be_hidden();self.assertTrue(all(re.fullmatch(r'Настройки · (ru|kk|en|be) · ', text) for text in self.q.locator('.echo-recording-row [data-no-i18n]').all_text_contents()))
 def test_mobile_labels_in_kk_and_be_fit_and_no_missing_ui_keys(self):
  for lang in ['kk','be','en']:
   self.language(lang)
   for width in [320,360,375,390,430,768,1280]:self.q.set_viewport_size({'width':width,'height':844});self.assertTrue(self.q.evaluate('document.documentElement.scrollWidth<=innerWidth'),(lang,width))
   for target in ['#phrasesTab','.echo-history-nav','.echo-quick-nav','.echo-sos-nav']:
    self.q.locator(target).click()
   self.language(lang);self.q.locator('.add-button').click();self.q.locator('#closeModal').click();self.q.locator('#phrasesTab').click();self.q.locator('.echo-add-category').click();self.q.locator('#echoCancelCategory').click()
  self.assertEqual(self.q.evaluate('[...echoI18n.missing]'),[])
 def test_create_edit_favorite_category_search_and_composer_each_language(self):
  q=self.q
  for lang in ['ru','kk','en','be']:
   self.language(lang);q.locator('#phrasesTab').click();q.locator('.add-button').click();name='Личная '+lang
   q.locator('#newPhraseName').fill(name);q.locator('#newPhraseText').fill('Настройки '+lang);q.locator('#savePhrase').click();card=q.locator('.custom-card').filter(has_text=name)
   card.locator('.favorite-star').click();card.locator('.edit-card').click();q.locator('#newPhraseName').fill(name+'!');q.locator('#savePhrase').click();expect(card.locator('.phrase-name')).to_have_text(name+'!')
   q.locator('#echoSearchInput').fill('Настройки '+lang);expect(q.locator('.custom-card:visible')).to_have_count(1);q.locator('#echoSearchInput').fill('')
   q.locator('.echo-add-category').click();q.locator('#echoNewCategoryName').fill('Моя '+lang);q.locator('#echoSaveCategory').click()
   choice=str(q.evaluate('echoUserCategories.length+1'));q.remove_listener('dialog',self.dialog)
   choose=lambda d:d.accept(choice) if d.type=='prompt' else d.accept()
   q.on('dialog',choose);card.locator('.echo-move-card').click();q.remove_listener('dialog',choose);q.on('dialog',self.dialog)
   self.assertEqual(q.evaluate('(id)=>echoCardCategories[id]',card.get_attribute('data-id')),q.evaluate('echoUserCategories.at(-1).id'))
   q.locator('#echoWordChoices button').first.click();self.assertTrue(q.locator('#echoSentence').input_value());q.locator('#echoSentenceClear').click()
   card.locator('.delete-card').click();q.locator('.undo-delete').click();expect(card).to_be_visible()
 def test_language_switch_does_not_replay_speech_or_erase_voice_preferences(self):
  self.c.add_init_script(MOCK);self.q.reload();self.ready();self.language('ru');self.q.locator('#echoVoiceSelect').select_option('RU two');self.q.locator('#phrasesTab').click();self.q.locator('.phrase-card .card-speak').first.click()
  self.assertEqual(self.q.evaluate('testSpeech.calls.length'),1)
  for lang in ['en','kk','be','ru']:self.language(lang);self.assertEqual(self.q.evaluate('testSpeech.calls.length'),1)
  expect(self.q.locator('#echoVoiceSelect')).to_have_value('RU two');expect(self.q.locator('#echoSpeechStatus')).to_have_text('Озвучка остановлена')
 def test_backup_preview_and_cancel_are_localized_in_each_language(self):
  q=self.q
  for lang in ['ru','kk','en','be']:
   self.language(lang);file=q.evaluate('async()=>await (await echoBackup.exportFile(false)).text()')
   q.locator('#echoBackupFile').set_input_files({'name':'copy.json','mimeType':'application/json','buffer':file.encode()})
   expect(q.locator('#echoBackupPreview')).to_be_visible();expected=q.evaluate("echoI18n.t('Карточек: {v0}; изображений: {v1}; аудиозаписей: {v2}. Голос {v3}.',{v0:0,v1:0,v2:0,v3:echoI18n.t('исключён')})")
   expect(q.locator('#echoBackupSummary')).to_have_text(expected);q.locator('#echoBackupCancel').click();expected=q.evaluate("echoI18n.t('Восстановление отменено. Данные не изменены.')");expect(q.locator('#echoBackupStatus')).to_have_text(expected)
 def test_fallback_and_placeholder_contract(self):
  self.assertEqual(self.q.evaluate("echoI18n.t('unknown-key')"),'unknown-key');self.assertIn('unknown-key',self.q.evaluate('[...echoI18n.missing]'))
  self.assertEqual(self.q.evaluate("echoI18n.t('Порядок изменён: {v0}',{v0:'<b>mine</b>'},'en')"),'Order changed: <b>mine</b>')

if __name__=='__main__':unittest.main(verbosity=2)
