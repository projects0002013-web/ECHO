"""Portable backup/restore including real IndexedDB transactions and startup recovery."""
import json
import unittest
from playwright.sync_api import sync_playwright, expect
from browser_smoke import tone

URL='http://127.0.0.1:8000'
class Backups(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.p=sync_playwright().start();cls.b=cls.p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.p.stop()
 def setUp(self):
  self.c=self.b.new_context(accept_downloads=True);self.q=self.c.new_page();self.errors=[]
  self.q.on('pageerror',lambda e:self.errors.append(str(e)));self.q.on('dialog',lambda d:d.accept())
  self.q.goto(URL);self.q.wait_for_selector("#echoDataPanel",state="attached");expect(self.q.locator('#echoDataPanel')).to_be_attached()
 def tearDown(self):self.c.close()
 def seed(self):
  self.q.evaluate('''async () => {
   localStorage.setItem('echoCustomPhrases',JSON.stringify([{id:1,name:'Первая',text:'Привет',emoji:'💧',imageId:'image-a'},{id:2,name:'Вторая',text:'Мир',emoji:'🌍'}]));
   localStorage.setItem('echoUserCategories',JSON.stringify([{id:'user-old',name:'Старые',icon:'📁'}]));
   localStorage.setItem('echoCardCategories',JSON.stringify({'1':'user-old'}));
   localStorage.setItem('echoFavorites','["custom:1"]');localStorage.setItem('echoPinnedPhrases','["custom:2"]');
   localStorage.setItem('echoStoreHistory','true');localStorage.setItem('echoPhraseHistory',JSON.stringify([{id:'h',text:'Привет',time:123}]));
   const c=document.createElement('canvas');c.width=30;c.height=30;const blob=await new Promise(r=>c.toBlob(r,'image/png'));
   await echoImageStore('getAll');const db=await new Promise(r=>{const q=indexedDB.open('echo-card-images',1);q.onsuccess=()=>r(q.result);});
   await new Promise((r,j)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put({id:'image-a',blob});t.oncomplete=r;t.onerror=j;});db.close();
  }''')
  # Store genuine WAV using the existing voice database; no synthesized placeholder is imported as HTML.
  wav=list(tone(1));self.q.evaluate('''async bytes=>{const q=indexedDB.open('echo-local-voice',1);const d=await new Promise(r=>q.onsuccess=()=>r(q.result));await new Promise((r,j)=>{const t=d.transaction('audio','readwrite');t.objectStore('audio').put({key:'phrase:ru:Привет',text:'Привет',language:'ru',duration:1,id:'audio-hash',blob:new Blob([new Uint8Array(bytes)],{type:'audio/wav'})});t.oncomplete=r;t.onerror=j;});d.close();}''',wav)
 def export(self,voices=True):
  return self.q.evaluate('async voices=>JSON.parse(await (await echoBackup.exportFile(voices)).text())',voices)
 def parse(self,file):
  return self.q.evaluate('async file=>{window.incoming=await echoBackup.parseFile(new Blob([JSON.stringify(file)]));return {cards:JSON.parse(incoming.local.echoCustomPhrases).length,images:incoming.images.images.length,audio:incoming.voice.audio.length}}',file)
 def test_full_roundtrip_order_categories_images_audio_offline(self):
  self.seed();file=self.export();self.assertEqual(self.parse(file),{'cards':2,'images':1,'audio':1})
  self.q.evaluate("localStorage.setItem('echoCustomPhrases','[]')")
  self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)")
  self.c.set_offline(True);self.q.reload();self.q.wait_for_selector("#echoDataPanel",state="attached");expect(self.q.locator('.custom-card')).to_have_count(2)
  expect(self.q.locator('.custom-card img')).to_be_visible();self.assertEqual(self.q.evaluate('getCustomPhrases().map(c=>c.id)'),[1,2])
  self.assertEqual(self.q.evaluate('favorites'),['custom:1']);self.assertEqual(self.q.evaluate('echoCardCategories[1]'),'user-old')
  self.q.locator('.settings-btn').click();expect(self.q.locator('#echoRecordingsList')).to_contain_text('Привет');self.assertEqual(self.errors,[])
 def test_exclude_voice_history_and_unknown_local_keys(self):
  self.seed();self.q.evaluate("localStorage.setItem('echoStoreHistory','false');localStorage.setItem('API_TOKEN','private');")
  file=self.export(False);self.assertEqual(file['payload']['audio'],[]);self.assertIsNone(file['payload']['local']['echoPhraseHistory']);self.assertNotIn('private',json.dumps(file))
 def test_merge_id_collisions_preserves_both_and_references(self):
  self.seed();file=self.export();self.q.evaluate("const c=getCustomPhrases();c[0].text='Другой текст';localStorage.setItem('echoCustomPhrases',JSON.stringify(c))")
  self.parse(file);self.q.evaluate("async()=>echoBackup.restore(incoming,'merge',false)");self.q.reload();self.q.wait_for_selector("#echoDataPanel",state="attached")
  cards=self.q.evaluate('getCustomPhrases()');self.assertEqual(len(cards),3);self.assertEqual(cards[0]['text'],'Другой текст');self.assertEqual(cards[2]['text'],'Привет')
  self.assertEqual(len(set(str(c['id']) for c in cards)),3);self.assertIn('custom:'+str(cards[2]['id']),self.q.evaluate('favorites'))
 def test_corruption_versions_duplicates_and_html_mime_rejected(self):
  self.seed();file=self.export();file['version']=99
  with self.assertRaises(Exception):self.parse(file)
  file['version']=1;file['payload']['local']['echoFavorites']='[]'
  with self.assertRaises(Exception):self.parse(file)
  file=self.export();file['payload']['local']['echoCustomPhrases']='[{"id":1,"name":"a","text":"a"},{"id":1,"name":"b","text":"b"}]'
  self.q.evaluate('async f=>{f.sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(f.payload)))),b=>b.toString(16).padStart(2,"0")).join("");window.bad=f;}',file)
  with self.assertRaises(Exception):self.q.evaluate('async()=>echoBackup.parseFile(new Blob([JSON.stringify(bad)]))')
  self.assertEqual(len(self.q.evaluate('getCustomPhrases()')),2)
 def test_partial_failure_rolls_back_local_and_binary_data(self):
  self.seed();file=self.export();self.parse(file)
  self.q.evaluate("localStorage.setItem('echoCustomPhrases',JSON.stringify([{id:'keep',name:'Оставить',text:'Прежнее',emoji:'💧'}]));")
  before=self.q.evaluate('localStorage.getItem("echoCustomPhrases")')
  self.q.evaluate('''()=>{const old=IDBObjectStore.prototype.put;let failed=false;IDBObjectStore.prototype.put=function(...args){if(this.name==='audio'&&!failed){failed=true;throw new DOMException('full','QuotaExceededError');}return old.apply(this,args);};}''')
  with self.assertRaises(Exception):self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)")
  self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),before)
  self.q.reload();self.q.wait_for_selector("#echoDataPanel",state="attached");expect(self.q.locator('.custom-card .phrase-name')).to_have_text('Оставить');self.assertEqual(self.errors,[])
 def test_quota_local_write_rolls_back_after_indexeddb_commit(self):
  self.seed();file=self.export();self.parse(file);self.q.evaluate("localStorage.setItem('echoCustomPhrases','[]')")
  self.q.evaluate('''()=>{const old=Storage.prototype.setItem;let fail=true;Storage.prototype.setItem=function(k,v){if(k==='echoFavorites'&&fail){fail=false;throw new DOMException('full','QuotaExceededError');}return old.call(this,k,v);};}''')
  with self.assertRaises(Exception):self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)")
  self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),'[]');self.q.reload();self.q.wait_for_selector("#echoDataPanel",state="attached");expect(self.q.locator('.custom-card')).to_have_count(0)
 def test_startup_recovers_journal_after_interrupted_restore(self):
  self.seed()
  self.q.evaluate('''async()=>{const r=indexedDB.open('echo-backup-journal',1),d=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
   const local={};for(const k of ['echoCustomPhrases','echoUserCategories','echoCardCategories','echoFavorites','echoPinnedPhrases','echoStoreHistory','echoPhraseHistory'])local[k]=localStorage.getItem(k);
   const read=async(name,stores)=>{const r=indexedDB.open(name,1),db=await new Promise(s=>r.onsuccess=()=>s(r.result));const result={};for(const n of stores)result[n]=await new Promise(s=>{const q=db.transaction(n).objectStore(n).getAll();q.onsuccess=()=>s(q.result);});db.close();return result;};
   const before={local,images:await read('echo-card-images',['images']),voice:await read('echo-local-voice',['audio','cache'])};
   await new Promise(s=>{const t=d.transaction('state','readwrite');t.objectStore('state').put({key:'restore',before});t.oncomplete=s;});d.close();localStorage.setItem('echoCustomPhrases','[]');}''')
  self.q.reload();self.q.wait_for_selector("#echoDataPanel",state="attached");expect(self.q.locator('.custom-card')).to_have_count(2);expect(self.q.locator('.custom-card img')).to_be_visible()
 def test_preview_cancel_and_download_ui(self):
  self.seed();file=self.export();self.q.locator('.settings-btn').click()
  self.q.locator('#echoBackupFile').set_input_files({'name':'copy.json','mimeType':'application/json','buffer':json.dumps(file).encode()})
  expect(self.q.locator('#echoBackupPreview')).to_be_visible();self.q.locator('#echoBackupCancel').click();expect(self.q.locator('#echoBackupPreview')).to_be_hidden()
  with self.q.expect_download() as download:self.q.locator('#echoBackupExport').click()
  self.assertTrue(download.value.suggested_filename.startswith('ECHO-backup-'))
 def test_journal_quota_prevents_any_changes(self):
  self.seed();file=self.export();self.parse(file);self.q.evaluate("localStorage.setItem('echoCustomPhrases','[]')")
  self.q.evaluate("""()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='state')throw new DOMException('full','QuotaExceededError');return old.apply(this,args);};}""")
  with self.assertRaises(Exception):self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)")
  self.assertEqual(self.q.evaluate('localStorage.getItem("echoCustomPhrases")'),'[]')
 def test_failed_rollback_retains_journal_and_recovers_on_restart(self):
  self.seed();self.parse(self.export());self.q.evaluate("localStorage.setItem('echoCustomPhrases',JSON.stringify([{id:'old',name:'Прежняя',text:'Не терять',emoji:'💧'}]))")
  self.q.evaluate("""()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='audio')throw new DOMException('full','QuotaExceededError');return old.apply(this,args);};}""")
  with self.assertRaises(Exception):self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)")
  expect(self.q.locator('#echoRecovery')).to_contain_text('Откат не завершён')
  self.q.reload();self.q.wait_for_selector('#echoDataPanel',state='attached');expect(self.q.locator('.custom-card .phrase-name')).to_have_text('Прежняя')
 def test_oversized_and_prototype_payload_rejected(self):
  with self.assertRaises(Exception):self.q.evaluate('async()=>echoBackup.parseFile({size:101*1024*1024})')
  with self.assertRaises(Exception):self.q.evaluate("async()=>echoBackup.parseFile(new Blob(['{\"format\":\"ECHO-backup\",\"version\":1,\"__proto__\":{}}']))")
 def test_replace_without_voice_retains_existing_recordings(self):
  self.seed();self.parse(self.export(False));self.q.evaluate("async()=>echoBackup.restore(incoming,'replace',false)");self.q.reload();self.q.wait_for_selector('#echoDataPanel',state='attached')
  self.q.locator('.settings-btn').click();expect(self.q.locator('#echoRecordingsList')).to_contain_text('Привет')
 def test_mobile_settings_have_no_horizontal_overflow(self):
  self.q.locator('.settings-btn').click()
  for width in [320,375,390,768,1280]:
   self.q.set_viewport_size({'width':width,'height':900});self.assertTrue(self.q.evaluate('document.documentElement.scrollWidth<=innerWidth'),width)
   self.assertGreaterEqual(self.q.locator('#echoBackupExport').bounding_box()['height'],44)
 def test_backup_preserves_unsaved_recording_and_rejects_concurrent_export(self):
  self.q.locator('.settings-btn').click()
  self.q.locator('#echoRecordTarget').select_option('phrase');self.q.locator('#echoRecordText').fill('Не терять')
  self.q.locator('#echoAudioImport').set_input_files({'name':'new.wav','mimeType':'audio/wav','buffer':tone(1)})
  expect(self.q.locator('#echoAudioDraft')).to_be_visible()
  with self.assertRaises(Exception):self.export()
  expect(self.q.locator('#echoAudioDraft')).to_be_visible()
  self.q.locator('#echoDraftDiscard').click()
  result=self.q.evaluate('async()=>{const results=await Promise.allSettled([echoBackup.exportFile(false),echoBackup.exportFile(false)]);return results.map(r=>r.status);}')
  self.assertEqual(sorted(result),['fulfilled','rejected'])
 def test_second_tab_cannot_write_in_parallel(self):
  second=self.c.new_page();second.goto(URL);expect(second.locator('#echoRecovery')).to_contain_text('другой вкладке');self.assertEqual(second.locator('#echoDataPanel').count(),0)

if __name__=='__main__':unittest.main(verbosity=2)
