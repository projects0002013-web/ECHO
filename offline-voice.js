/* Experimental native-host boundary. No network, model download, or fake synthesis. */
(() => {
  'use strict';
  const unavailable = reason => ({ ready:false, reason, languages:[] });
  const timeout = (promise, ms) => new Promise((resolve,reject)=>{
    const id=setTimeout(()=>reject(new Error('native_timeout')),ms);
    Promise.resolve(promise).then(resolve,reject).finally(()=>clearTimeout(id));
  });
  async function status() {
    const host=window.echoNativeOfflineVoice || (window.EchoAndroid ? window.echoNativeVoice : null);
    if(!host || host.apiVersion!==1 || typeof host.status!=='function' || typeof host.synthesize!=='function')return unavailable('native_missing');
    try {
      const s=await timeout(host.status(),3000);
      if(s?.engine!=='sherpa-onnx-pocket' || s.localOnly!==true || s.supportsReference!==true)return unavailable('runtime_invalid');
      if(s.modelReady!==true || s.licenseVerified!==true)return unavailable('model_missing');
      // This integration targets the documented English Pocket model only.
      if(!Array.isArray(s.languages) || !s.languages.includes('en'))return unavailable('language_unsupported');
      return {ready:true,reason:'experimental_native',languages:['en']};
    } catch {return unavailable('native_unavailable');}
  }
  function assertWav(bytes) {
    const header=new TextDecoder('ascii').decode(bytes.slice(0,12));
    if(bytes.length<=44 || !header.startsWith('RIFF') || header.slice(8)!=='WAVE')throw new Error('invalid_wav');
  }
  async function synthesize({text,language,reference,consent,signal}={}) {
    if(consent!==true)throw new Error('owner_consent_required');
    if(typeof text!=='string' || !text.trim() || [...text].length>300)throw new Error('invalid_text');
    if(language!=='en')throw new Error('language_unsupported');
    if(!(reference instanceof Blob) || reference.size>8*1024*1024)throw new Error('invalid_reference');
    signal?.throwIfAborted();
    const s=await status();if(!s.ready)throw new Error(s.reason);
    const bytes=new Uint8Array(await reference.arrayBuffer());assertWav(bytes);
    signal?.throwIfAborted();
    // A future native host must verify PCM/duration, ownership and file checksums again.
    const output=await timeout(window.echoNativeOfflineVoice.synthesize({apiVersion:1,text:text.trim(),language,referenceWav:bytes,consent:true}),120000);
    signal?.throwIfAborted();
    const wav=output instanceof Blob?new Uint8Array(await output.arrayBuffer()):output instanceof Uint8Array?output:output instanceof ArrayBuffer?new Uint8Array(output):null;
    if(!wav)throw new Error('invalid_wav');assertWav(wav);
    return new Blob([wav],{type:'audio/wav'});
  }
  window.echoOfflineVoice=Object.freeze({apiVersion:1,status,synthesize});
  const panel=document.createElement('section');panel.id='echoOfflineModelPanel';panel.setAttribute('aria-labelledby','echoOfflineModelTitle');
  panel.innerHTML=`<h4 id="echoOfflineModelTitle">Автономный голос на телефоне</h4><p>Экспериментальная мобильная интеграция. Автономная модель пока не входит в приложение. Записи и голос устройства доступны.</p><button type="button" id="echoOfflineCheck">Проверить офлайн-модель</button><p id="echoOfflineModelStatus" role="status" aria-live="polite"></p><p>Системный голос и сохранённые записи остаются доступны. Новые фразы Chatterbox требуют локального сервера на ПК.</p><div class="echo-local-actions"><button type="button" id="echoOfflineUseDevice">Голос устройства</button><button type="button" id="echoOfflineUseRecordings">Сохранённые записи</button></div>`;
  document.getElementById('echoLocalVoicePanel').querySelector('.echo-studio-compose').before(panel);
  if(typeof window.echoNativeVoice?.checkReferenceWav==='function' && window.EchoAndroid){
    // First native AI step: check a sample before connecting inference. No upload or storage.
    const sampleCheck=document.createElement('div');
    sampleCheck.className='echo-local-actions';
    const label=document.createElement('label');label.textContent='Проверить WAV для локального ИИ (5–30 сек, моно, 16 бит): ';
    const picker=document.createElement('input');
    picker.type='file';picker.accept='.wav,audio/wav';picker.setAttribute('aria-label','Выбрать голосовой WAV-образец для проверки');
    const result=document.createElement('p');result.setAttribute('role','status');result.setAttribute('aria-live','polite');
    label.append(picker);sampleCheck.append(label,result);panel.append(sampleCheck);
    let requestId=0;
    picker.addEventListener('change',async()=>{
      const file=picker.files?.[0];if(!file)return;
      const token=++requestId;picker.disabled=true;result.textContent='Проверка WAV на устройстве…';
      try{
        const info=await window.echoNativeVoice.checkReferenceWav(file);
        if(token!==requestId)return;
        result.textContent=info.valid===true
          ?'Образец проверен: '+info.durationSeconds.toFixed(1)+' сек, '+info.sampleRate+' Гц. Сама AI-модель пока не установлена.'
          :'Не удалось подтвердить голосовой образец.';
      }catch(error){if(token===requestId)result.textContent='Образец не подходит: '+error.message;}
      finally{if(token===requestId)picker.disabled=false;}
    });
  }
  const pcNote=document.createElement('p');pcNote.id='echoPCRequirement';pcNote.textContent='Синтез ниже использует Chatterbox на локальном сервере ПК. Это не автономный ИИ телефона.';
  const generate=document.getElementById('echoStudioGenerate');generate.parentElement.before(pcNote);generate.setAttribute('aria-describedby','echoPCRequirement');
  const pcLocal=['localhost','127.0.0.1'].includes(location.hostname);
  const androidNative=!!window.EchoAndroid && typeof window.echoNativeVoice?.synthesize==='function';
  const canSynthesizeLocally=pcLocal || androidNative;
  if(!canSynthesizeLocally){generate.disabled=true;generate.textContent='ИИ-синтез требует локального сервера ПК';}
  const unavailableObserver=new MutationObserver(()=>{
    if(!canSynthesizeLocally && !generate.disabled)generate.disabled=true;
  });
  unavailableObserver.observe(generate,{attributes:true,attributeFilter:['disabled']});
  if(androidNative) {
    generate.disabled=true;
    generate.textContent='Проверяю локальную AI-модель…';
    window.echoNativeVoice.status().then(s=>{
      if(s.ready===true && Array.isArray(s.languages) && s.languages.includes('en')){
        generate.disabled=false;generate.textContent='Синтезировать моим голосом';
        pcNote.textContent='Генерация новых фраз выполняется PocketTTS полностью на этом Android, без сервера. Только английский язык.';
      } else {
        generate.disabled=true;
        generate.textContent='Локальная AI-модель отсутствует';
        pcNote.textContent='Модель PocketTTS не найдена в этой сборке. Используйте голос устройства или записи.';
      }
    }).catch(()=>{
      generate.disabled=true;generate.textContent='Не удалось проверить AI-модель';
    });
  }
  let operation=0;
  async function check() {
    const token=++operation;const button=document.getElementById('echoOfflineCheck');button.disabled=true;
    const s=await status();if(token!==operation)return;
    document.getElementById('echoOfflineModelStatus').textContent=s.ready?'Офлайн-модель найдена. Поддерживается английский. Мобильный синтез ещё не включён в приложение.':s.reason==='model_missing'?'Нативный движок найден, но проверенная офлайн-модель не установлена. Используйте голос устройства или записи.':'Автономная модель телефона не подключена. Android и iPhone не проверены. Используйте голос устройства или записи.';
    button.disabled=false;
  }
  document.getElementById('echoOfflineCheck').onclick=check;
  document.getElementById('echoOfflineUseDevice').onclick=()=>document.getElementById('echoUseDevice').click();
  document.getElementById('echoOfflineUseRecordings').onclick=()=>document.getElementById('echoUseRecordings').click();
  window.addEventListener('echo-native-voice-ready',check);check();
})();
