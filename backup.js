/* Local portable backups. No network calls. Recovery runs before application code. */
(() => {
  'use strict';
  const KEYS = ['echoCustomPhrases','echoFavorites','echoPinnedPhrases','echoUserCategories','echoCardCategories','echoCategoryState','echoSettings','echoLanguage','echoCardSize','echoTheme','echoVibration','echoSpeechMode','echoStoreHistory','echoPhraseHistory','echoPiperConfig','echoSimpleMode'];
  const LIMIT = 100 * 1024 * 1024;
  const specs = {'echo-card-images':{images:'id'},'echo-local-voice':{audio:'key',cache:'key'},'echo-backup-journal':{state:'key'}};
  let busy=false, permitted=false, supported=false, claimed=false, halted=false;
  const set=Storage.prototype.setItem, remove=Storage.prototype.removeItem, transaction=IDBDatabase.prototype.transaction;
  const allow = fn => { permitted=true; try { return fn(); } finally { permitted=false; } };
  Storage.prototype.setItem=function(k,v){if(busy&&!permitted)throw new Error('Идёт восстановление данных');return set.call(this,k,v);};
  Storage.prototype.removeItem=function(k){if(busy&&!permitted)throw new Error('Идёт восстановление данных');return remove.call(this,k);};
  IDBDatabase.prototype.transaction=function(stores,mode,...args){
    if(busy&&!permitted&&mode==='readwrite'&&specs[this.name])throw new Error('Данные временно заблокированы');
    return transaction.call(this,stores,mode,...args);
  };
  const fail = message => {throw new Error(message);};
  function open(name){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);
    r.onupgradeneeded=()=>{for(const [store,keyPath] of Object.entries(specs[name]))if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store,{keyPath});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Закройте другие вкладки ECHO.'));});}
  async function stores(name,write){const db=await open(name);return new Promise((resolve,reject)=>{
    const names=Object.keys(specs[name]),tx=allow(()=>db.transaction(names,write?'readwrite':'readonly',write?{durability:'strict'}:undefined)),result={};
    try {for(const store of names){const s=tx.objectStore(store);if(write){s.clear();for(const item of write[store]||[])s.put(item);}else{const q=s.getAll();q.onsuccess=()=>result[store]=q.result;}}}
    catch(e){tx.abort();db.close();reject(e);return;}
    tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Запись прервана'));};});}
  // The journal is committed before any user data is replaced, and cleared last.
  async function journal(value){const db=await open('echo-backup-journal');return new Promise((resolve,reject)=>{
    const tx=allow(()=>db.transaction('state',value===undefined?'readonly':'readwrite',value===undefined?undefined:{durability:'strict'})),s=tx.objectStore('state');
    let q;try{q=value===undefined?s.get('restore'):value===null?s.delete('restore'):s.put({key:'restore',before:value});}catch(e){tx.abort();db.close();reject(e);return;}
    tx.oncomplete=()=>{db.close();resolve(q.result?.before);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Журнал недоступен'));};});}
  async function snapshot(){const local={};for(const key of KEYS)local[key]=localStorage.getItem(key);
    return {local,images:await stores('echo-card-images'),voice:await stores('echo-local-voice')};}
  async function apply(state){await stores('echo-card-images',state.images);await stores('echo-local-voice',state.voice);
    allow(()=>{for(const key of KEYS){const value=state.local[key];if(value===null||value===undefined)localStorage.removeItem(key);else localStorage.setItem(key,value);}});}
  function block(value){busy=value;document.querySelector('.app').inert=value;let status=document.getElementById('echoDataBusy');if(!status){status=document.createElement('p');status.id='echoDataBusy';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.prepend(status);}status.hidden=!value;status.textContent=value?'Обработка данных. Дождитесь завершения операции.':'';}
  function fatal(text){let box=document.getElementById('echoRecovery');if(!box){box=document.createElement('section');box.id='echoRecovery';box.className='echo-local-panel';box.setAttribute('role','alert');document.body.prepend(box);}
    box.replaceChildren();const p=document.createElement('p');p.textContent=text;const b=document.createElement('button');b.textContent='Повторить запуск';b.onclick=()=>location.reload();box.append(p,b);}
  async function quiesce(){if(document.getElementById('echoAudioDraft')&&!document.getElementById('echoAudioDraft').hidden)fail('Сначала сохраните или отмените подготовленную запись.');if(document.getElementById('echoRecordStop')&&!document.getElementById('echoRecordStop').disabled)fail('Сначала остановите запись микрофона.');if(typeof echoCardSaving!=='undefined'&&echoCardSaving)fail('Дождитесь сохранения карточки.');await window.echoBackupQuiesce?.();if(typeof pendingDelete!=='undefined'&&pendingDelete)finishDelete();}
  async function freeze(fn){if(!supported)fail('Резервные операции требуют браузер с Web Locks и localhost/HTTPS.');if(claimed||busy)fail('Дождитесь текущей операции.');
    claimed=true;try{await quiesce();block(true);return await fn();}finally{try{if(!halted&&!await journal())block(false);}catch(e){halted=true;fatal('Проверка журнала недоступна. Сохранённые данные не удалены. Повторите запуск.');throw e;}finally{claimed=false;}}}
  const json = (local,key,fallback) => local[key]===null||local[key]===undefined?fallback:JSON.parse(local[key]);
  const text=(v,max=300)=>typeof v==='string'&&v.length<=max;
  const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
  function safe(value,depth=0){if(depth>20)fail('Слишком сложный файл.');if(value&&typeof value==='object'){for(const [k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))fail('Недопустимое поле.');safe(v,depth+1);}}}
  // Fixed allowlist: no arbitrary localStorage keys or runtime credentials.
  function validateLocal(local){if(!record(local)||Object.keys(local).some(k=>!KEYS.includes(k)))fail('Неизвестные данные приложения.');
    for(const value of Object.values(local))if(value!==null&&!text(value,2*1024*1024))fail('Некорректное значение настройки.');
    const cards=json(local,'echoCustomPhrases',[]),ids=new Set();if(!Array.isArray(cards)||cards.length>5000)fail('Слишком много карточек.');
    for(const c of cards){if(!record(c)||!['string','number'].includes(typeof c.id)||!text(String(c.id),200)||['__proto__','constructor','prototype'].includes(String(c.id))||ids.has(String(c.id))||!text(c.name,40)||!text(c.text)||!text(c.emoji||'',40)||(c.imageId!==undefined&&c.imageId!==null&&!text(c.imageId,200)))fail('Повреждённые или повторяющиеся карточки.');ids.add(String(c.id));}
    for(const key of ['echoFavorites','echoPinnedPhrases']){const a=json(local,key,[]);if(!Array.isArray(a)||a.length>10000||a.some(v=>!text(v,400)))fail('Некорректный список фраз.');}
    const state=json(local,'echoCategoryState',null)||{categories:json(local,'echoUserCategories',[]),cards:json(local,'echoCardCategories',{})};
    if(!record(state)||!Array.isArray(state.categories)||state.categories.length>1000||!record(state.cards))fail('Некорректные категории.');const categories=new Set();
    for(const c of state.categories){if(!record(c)||!text(c.id,200)||['__proto__','constructor','prototype'].includes(c.id)||categories.has(c.id)||!text(c.name,35)||!text(c.icon,40))fail('Некорректная категория.');categories.add(c.id);}
    if(Object.values(state.cards).some(v=>!text(v,200)))fail('Некорректные связи категорий.');
    const settings=json(local,'echoSettings',{});if(!record(settings)||Object.keys(settings).some(k=>!['language','rate','pitch','volume','voiceName','voiceNames'].includes(k)))fail('Неизвестные настройки.');
    for(const k of ['rate','pitch','volume'])if(settings[k]!==undefined&&(!Number.isFinite(settings[k])||settings[k]<0||settings[k]>2))fail('Некорректные параметры голоса.');
    if(settings.language!==undefined&&!['ru-RU','kk-KZ','en-US','be-BY'].includes(settings.language))fail('Неизвестный язык.');
    if(settings.voiceName!==undefined&&!text(settings.voiceName,500))fail('Некорректный голос.');
    if(settings.voiceNames!==undefined&&(!record(settings.voiceNames)||Object.entries(settings.voiceNames).some(([k,v])=>!['ru','kk','en','be'].includes(k)||!text(v,500))))fail('Некорректные предпочтения.');
    for(const [k,values]of Object.entries({echoLanguage:['ru','kk','en','be'],echoTheme:['light','dark','system','contrast'],echoCardSize:['small','medium','large'],echoSimpleMode:['true','false'],echoVibration:['true','false'],echoSpeechMode:['device','recordings','personal'],echoStoreHistory:['true','false']}))if(local[k]!=null&&!values.includes(local[k]))fail('Неизвестное значение настройки.');
    const history=json(local,'echoPhraseHistory',[]);if(!Array.isArray(history)||history.length>100||history.some(h=>!record(h)||!text(h.text)||!Number.isFinite(h.time)))fail('Повреждённая история.');
    const piper=json(local,'echoPiperConfig',{});if(!record(piper)||Object.keys(piper).some(k=>!['enabled','url','voice'].includes(k)))fail('Некорректный Piper.');
    if(piper.url){const u=new URL(piper.url);if(!['localhost','127.0.0.1'].includes(u.hostname)||!['http:','https:'].includes(u.protocol)||u.username||u.password)fail('Piper должен быть локальным.');}
    if(piper.voice!==undefined&&!text(piper.voice,500))fail('Некорректный Piper.');if(piper.enabled!==undefined&&typeof piper.enabled!=='boolean')fail('Некорректный Piper.');
    safe({local:Object.fromEntries(Object.entries(local).map(([k,v])=>[k,(()=>{try{return JSON.parse(v);}catch{return v;}})()]))});return {cards,state};}
  async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
  async function encode(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
  async function pack(records,voice){const result=[];for(const r of records){const item=voice?{key:r.key,id:r.id,text:r.text,language:r.language,duration:r.duration}:{id:r.id};result.push({...item,mime:r.blob.type,data:await encode(r.blob)});}return result;}
  async function unpack(records,voice){if(!Array.isArray(records)||records.length>5000)fail('Некорректный список файлов.');const ids=new Set(),result=[];let total=0;
    for(const r of records){if(!record(r)||!text(r.data,17*1024*1024)||!text(voice?r.key:r.id,600)||ids.has(voice?r.key:r.id))fail('Повреждённые или повторяющиеся файлы.');ids.add(voice?r.key:r.id);
      const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));total+=bytes.length;if(total>64*1024*1024||bytes.length>(voice?12:1)*1024*1024)fail('Файлы превышают лимит.');
      if(voice){if(r.mime!=='audio/wav'||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WAVE'||!text(r.id,200)||!text(r.text||'',300)||!['ru','kk','en','be'].includes(r.language)||!Number.isFinite(r.duration)||r.duration<=0||r.duration>30.1||!(r.key==='sample'||r.key===`phrase:${r.language}:${r.text.trim().replace(/\s+/g,' ')}`))fail('Некорректная аудиозапись.');
        const wav=new DataView(bytes.buffer);if(bytes.length<44||wav.getUint16(20,true)!==1||wav.getUint16(22,true)!==1||wav.getUint16(34,true)!==16||wav.getUint32(24,true)<8000||wav.getUint32(24,true)>96000||wav.getUint32(40,true)!==bytes.length-44||Math.abs((bytes.length-44)/2/wav.getUint32(24,true)-r.duration)>.02)fail('Повреждённый PCM WAV.');result.push({key:r.key,id:r.id,text:r.text||'',language:r.language,duration:r.duration,blob:new Blob([bytes],{type:r.mime})});
      }else{if(!['image/png','image/jpeg','image/webp'].includes(r.mime))fail('Некорректное изображение.');const signature=r.mime==='image/png'?bytes[0]===137&&bytes[1]===80:r.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!signature)fail('Формат изображения не соответствует содержимому.');const blob=new Blob([bytes],{type:r.mime}),bitmap=await createImageBitmap(blob);if(bitmap.width*bitmap.height>20000000){bitmap.close();fail('Слишком большое изображение.');}bitmap.close();result.push({id:r.id,blob});}}
    return result;}
  async function exportFile(voices=false){return freeze(async()=>{const current=await snapshot(),local={...current.local};
    if(local.echoStoreHistory!=='true')local.echoPhraseHistory=null;validateLocal(local);
    const used=new Set(json(local,'echoCustomPhrases',[]).map(c=>c.imageId).filter(Boolean));
    const payload={local,voices,images:await pack(current.images.images.filter(i=>used.has(i.id)),false),audio:voices?await pack(current.voice.audio,true):[]};
    // Validate our own output as well: damaged local records must not create unusable backups.
    const file={format:'ECHO-backup',version:1,createdAt:new Date().toISOString(),payload,sha256:await digest(payload)};
    const blob=new Blob([JSON.stringify(file)],{type:'application/json'});if(blob.size>LIMIT)fail('Копия больше 100 МБ. Исключите голосовые данные.');await parseFile(blob);return blob;});}
  async function parseFile(file){if(file.size>LIMIT||!file.size)fail('Допустимый размер файла: до 100 МБ.');const root=JSON.parse(await file.text());safe(root);
    if(root.format!=='ECHO-backup'||root.version!==1||!text(root.createdAt,40)||!Number.isFinite(Date.parse(root.createdAt)))fail('Неизвестный формат или версия копии.');if(!record(root.payload)||typeof root.payload.voices!=='boolean'||await digest(root.payload)!==root.sha256)fail('Нарушена целостность копии.');
    const payload=root.payload;if(!payload.voices&&payload.audio?.length)fail('Неожиданные голосовые данные.');const {cards}=validateLocal(payload.local);
    const images=await unpack(payload.images,false),audio=await unpack(payload.audio,true),ids=new Set(images.map(i=>i.id));if(cards.some(c=>c.imageId&&!ids.has(c.imageId)))fail('В копии отсутствует изображение карточки.');
    if(payload.local.echoStoreHistory!=='true'&&json(payload.local,'echoPhraseHistory',[]).length)fail('История не разрешена для экспорта.');
    return {local:payload.local,images:{images},voice:{audio,cache:[]},voices:payload.voices};}
  async function merge(before,incoming){const next=structuredClone(before),old=validateLocal(before.local),data=validateLocal(incoming.local),categoryMap=new Map(),cardMap=new Map(),imageMap=new Map();
    for(const image of incoming.images.images){const id=crypto.randomUUID();imageMap.set(image.id,id);next.images.images.push({...image,id});}
    const categories=[...old.state.categories],links={...old.state.cards};for(const c of data.state.categories){const existing=categories.find(x=>x.id===c.id);const id=existing&&JSON.stringify(existing)!==JSON.stringify(c)?'user-'+crypto.randomUUID():c.id;categoryMap.set(c.id,id);if(!categories.some(x=>x.id===id))categories.push({...c,id});}
    const cards=[...old.cards];for(const c of data.cards){const existing=cards.find(x=>String(x.id)===String(c.id));if(existing&&JSON.stringify(existing)===JSON.stringify(c)&&(!c.imageId||await encode(before.images.images.find(i=>i.id===c.imageId)?.blob||new Blob())===await encode(incoming.images.images.find(i=>i.id===c.imageId)?.blob||new Blob()))){cardMap.set(String(c.id),String(existing.id));continue;}const id=existing?crypto.randomUUID():c.id;cardMap.set(String(c.id),String(id));cards.push({...c,id,...(c.imageId?{imageId:imageMap.get(c.imageId)}:{})});const category=data.state.cards[c.id];if(category)links[id]=categoryMap.get(category)||category;}
    next.local.echoCustomPhrases=JSON.stringify(cards);next.local.echoCategoryState=JSON.stringify({categories,cards:links});
    for(const key of ['echoFavorites','echoPinnedPhrases']){const imported=json(incoming.local,key,[]).map(id=>id.startsWith('custom:')?'custom:'+(cardMap.get(id.slice(7))||id.slice(7)):id);next.local[key]=JSON.stringify([...new Set([...json(before.local,key,[]),...imported])]);}
    if(before.local.echoStoreHistory==='true'){const h=[...json(before.local,'echoPhraseHistory',[]),...json(incoming.local,'echoPhraseHistory',[])];next.local.echoPhraseHistory=JSON.stringify([...new Map(h.map(x=>[x.id||`${x.time}:${x.text}`,x])).values()].sort((a,b)=>b.time-a.time).slice(0,100));}
    if(incoming.voices)for(const a of incoming.voice.audio)if(!next.voice.audio.some(x=>x.key===a.key))next.voice.audio.push(a);
    // Existing preferences and conflicting audio win in merge mode.
    return next;}
  // All application writers are paused; failure retains the journal until rollback succeeds.
  async function restore(incoming,mode,reload=true){if(!['replace','merge'].includes(mode))fail('Выберите способ восстановления.');return freeze(async()=>{
    const before=await snapshot();const next=mode==='merge'?await merge(before,incoming):{local:incoming.local,images:incoming.images,voice:incoming.voices?incoming.voice:before.voice};
    const used=new Set(json(next.local,'echoCustomPhrases',[]).map(c=>c.imageId).filter(Boolean));next.images.images=next.images.images.filter(x=>used.has(x.id));
    await journal(before);try{await apply(next);await journal(null);}catch(error){halted=true;try{await apply(before);await journal(null);}catch{fatal('Откат не завершён. Прежние данные сохранены в журнале. Освободите место и повторите запуск.');throw error;}fatal('Восстановление отменено из-за ошибки. Прежнее состояние восстановлено. Перезапустите ECHO.');throw error;}
    halted=true;if(reload)location.reload();else block(true);
  });}
  function ui(){const panel=document.createElement('section');panel.id='echoDataPanel';panel.className='echo-local-panel';panel.hidden=true;
    panel.innerHTML=`<h3>Мои данные</h3><p>Копия хранится только у вас. Файл не зашифрован: фотографии, история и голос доступны любому, кто получит его. Не передавайте файл посторонним.</p><label class="echo-history-choice"><input type="checkbox" id="echoBackupVoices"> Включить личные голосовые записи и образец</label><button type="button" id="echoBackupExport">Создать резервную копию</button><p id="echoBackupLast"></p><label for="echoBackupFile">Восстановить из файла (ECHO JSON, до 100 МБ)</label><input id="echoBackupFile" type="file" accept="application/json,.json"><div id="echoBackupPreview" hidden><p id="echoBackupSummary"></p><label for="echoBackupMode">Способ восстановления</label><select id="echoBackupMode"><option value="merge">Объединить — сохранить текущие настройки и конфликтующие записи</option><option value="replace">Заменить — текущие карточки и настройки будут заменены</option></select><p>Перед восстановлением закройте другие, в том числе старые, вкладки ECHO. Перед заменой создайте копию текущих данных. При исключённом голосе существующие аудиозаписи сохраняются.</p><button type="button" id="echoBackupApply">Подтвердить восстановление</button><button type="button" id="echoBackupCancel">Отмена</button></div><p id="echoBackupStatus" role="status" aria-live="polite"></p>`;
    document.querySelector('.vibration-settings-panel').after(panel);const $=id=>document.getElementById(id);let incoming=null,selection=0;
    const status=text=>{$('echoBackupStatus').textContent=text;};const progress=async fn=>{panel.setAttribute('aria-busy','true');status('Обрабатываю данные…');try{await fn();}catch(e){status('Ошибка: '+window.echoI18n.error(e));}finally{panel.setAttribute('aria-busy','false');}};
    $('echoBackupLast').textContent=localStorage.getItem('echoBackupLastExport')?'Последний экспорт: '+localStorage.getItem('echoBackupLastExport'):'Экспорт ещё не выполнялся.';
    $('echoBackupExport').onclick=()=>progress(async()=>{const blob=await exportFile($('echoBackupVoices').checked),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ECHO-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);const date=new Date().toISOString();try{localStorage.setItem('echoBackupLastExport',date);$('echoBackupLast').textContent='Последняя подготовка экспорта: '+date;}catch{}status('Файл подготовлен. Проверьте его сохранение в загрузках браузера.');});
    $('echoBackupFile').onchange=()=>{const operation=++selection;return progress(async()=>{incoming=null;$('echoBackupPreview').hidden=true;const file=$('echoBackupFile').files[0];if(!file)return;const parsed=await parseFile(file);if(operation!==selection)return;incoming=parsed;$('echoBackupSummary').textContent=`Карточек: ${json(incoming.local,'echoCustomPhrases',[]).length}; изображений: ${incoming.images.images.length}; аудиозаписей: ${incoming.voice.audio.length}. Голос ${incoming.voices?'включён':'исключён'}.`;$('echoBackupPreview').hidden=false;status('Проверка целостности завершена. Данные ещё не изменены.');});};
    $('echoBackupCancel').onclick=()=>{selection++;incoming=null;$('echoBackupFile').value='';$('echoBackupPreview').hidden=true;status('Восстановление отменено. Данные не изменены.');};
    $('echoBackupApply').onclick=()=>{if(incoming&&confirm('Восстановить данные выбранным способом? Текущие данные могут быть заменены.'))progress(()=>restore(incoming,$('echoBackupMode').value));};
  }
  async function start(){try{localStorage.getItem('echoSettings');const test='__echo_backup_test__';localStorage.setItem(test,'1');localStorage.removeItem(test);const before=await journal();if(before){block(true);await apply(before);await journal(null);block(false);}
    for(const file of ['script.js','features.js','accessibility.js','executive.js','offline-voice.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=file;s.onload=resolve;s.onerror=()=>reject(new Error('Не удалось загрузить '+file));document.body.append(s);});ui();document.querySelector('.app').inert=false;}
    catch(e){block(true);fatal('ECHO не запущено: '+e.message+' Сохранённые данные и журнал не удалены.');}}
  window.echoBackup={exportFile,parseFile,restore};
  document.querySelector('.app').inert=true;
  if(navigator.locks){navigator.locks.request('echo-data-owner',{ifAvailable:true},async lock=>{if(!lock){block(true);fatal('ECHO открыто в другой вкладке. Закройте её и повторите запуск для безопасной работы с данными.');return;}supported=true;await start();await new Promise(()=>{});});}
  else start();
})();
