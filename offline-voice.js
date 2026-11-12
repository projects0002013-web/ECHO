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
      if(s.modelReady!==true || s.licenseVerified!==true)return {...unavailable('model_missing'),phase:s.phase,errorCode:s.errorCode};
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
    let output;
    if(window.EchoAndroid && window.echoNativeVoice?.synthesize){
      let binary='';for(let i=0;i<bytes.length;i+=8192)
        binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      output=await timeout(window.echoNativeVoice.synthesize({
        text:text.trim(),language,referenceWavBase64:btoa(binary),consent:true,signal
      }),240000);
    }else{
      output=await timeout(window.echoNativeOfflineVoice.synthesize({
        apiVersion:1,text:text.trim(),language,referenceWav:bytes,consent:true
      }),120000);
    }
    signal?.throwIfAborted();
    const wav=typeof output?.wavBase64==='string'
      ?Uint8Array.from(atob(output.wavBase64),c=>c.charCodeAt(0))
      :output instanceof Blob?new Uint8Array(await output.arrayBuffer())
      :output instanceof Uint8Array?output
      :output instanceof ArrayBuffer?new Uint8Array(output):null;
    if(!wav)throw new Error('invalid_wav');assertWav(wav);
    return new Blob([wav],{type:'audio/wav'});
  }
  window.echoOfflineVoice=Object.freeze({apiVersion:1,status,synthesize});
  const panel=document.createElement('section');panel.id='echoOfflineModelPanel';panel.setAttribute('aria-labelledby','echoOfflineModelTitle');
  panel.innerHTML=`<h4 id="echoOfflineModelTitle">Автономный голос на телефоне</h4><p>Экспериментальная мобильная интеграция. Автономная модель пока не входит в приложение. Записи и голос устройства доступны.</p><button type="button" id="echoOfflineCheck">Проверить офлайн-модель</button><p id="echoOfflineModelStatus" role="status" aria-live="polite"></p><p>Системный голос и сохранённые записи остаются доступны. Новые фразы Chatterbox требуют локального сервера на ПК.</p><div class="echo-local-actions"><button type="button" id="echoOfflineUseDevice">Голос устройства</button><button type="button" id="echoOfflineUseRecordings">Сохранённые записи</button></div>`;
  document.getElementById('echoLocalVoicePanel').querySelector('.echo-studio-compose').before(panel);
  const pcNote=document.createElement('p');pcNote.id='echoPCRequirement';pcNote.setAttribute('role','status');pcNote.setAttribute('aria-live','polite');pcNote.textContent='Синтез ниже использует Chatterbox на локальном сервере ПК. Это не автономный ИИ телефона.';
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
    const studio=document.getElementById('echoLocalVoicePanel');
    studio.querySelector('.echo-local-note').textContent='Образец используется только локально. PocketTTS поддерживает английский; RU, KK и BE используют голос устройства или записи. Сходство голоса требует проверки владельцем.';
    document.getElementById('echoStudioSetup').innerHTML='<summary>О локальной модели</summary><p>Модель: PocketTTS English int8, sherpa-onnx 2.0.1. Веса: Kyutai, конвертация k2-fsa/sherpa-onnx, CC BY 4.0; веса не изменены ECHO. Полная лицензия включена в APK. При ошибке подготовки освободите место и повторите проверку модели.</p>';

    document.getElementById('echoStudioPrivacyNote').textContent='Персональный голос создаёт новые английские фразы на этом Android по вашему образцу. Записи хранятся приватно на устройстве и не отправляются в облако.';
    document.getElementById('echoStudioSourceNote').textContent='Голос устройства использует установленные офлайн-голоса Android. PocketTTS создаёт новые фразы только на английском; для других языков доступны голос устройства и записи.';
    panel.querySelector('p').textContent='Английская модель PocketTTS включена в тестовую Android-сборку. При подготовке проверяются файлы модели и загружается движок. Может потребоваться дополнительное свободное место. Генерация не скачивает модель.';
    const paragraphs=panel.querySelectorAll(':scope > p');if(paragraphs[2])paragraphs[2].textContent='Создание новых фраз выполняется без облака. Русский, казахский и белорусский остаются доступны через системный голос или сохранённые записи.';
    // Plain-language readiness checklist: avoids a mysterious disabled synthesis button.
    const guide=document.createElement('section');
    guide.className='echo-ai-readiness';
    guide.setAttribute('aria-labelledby','echoAiReadinessTitle');
    const heading=document.createElement('h4');
    heading.id='echoAiReadinessTitle';heading.textContent='Что нужно для ИИ-синтеза';
    const checklist=document.createElement('ol');
    checklist.className='echo-ai-readiness-list';
    const checkpoints=[
      ['model','Модель PocketTTS готова'],
      ['language','Выбран английский язык'],
      ['sample','Сохранён голосовой образец'],
      ['consent','Подтверждено согласие'],
      ['text','Введён текст новой фразы']
    ];
    const rows=new Map();
    for(const [key,label] of checkpoints){
      const item=document.createElement('li');
      item.dataset.check=key;
      item.textContent=label;
      item.setAttribute('data-state','waiting');
      rows.set(key,item);checklist.append(item);
    }
    const hint=document.createElement('p');
    hint.className='echo-ai-readiness-hint';
    hint.textContent='Сначала проверьте модель, затем выполните остальные шаги.';
    guide.append(heading,checklist,hint);
    const compose=document.querySelector('.echo-studio-compose');
    if(compose)compose.prepend(guide);
    let nativeState=null;
    const phases={installing:'Проверка и установка файлов модели…',loading:'Загрузка локального AI-движка…',
      not_installed:'Модель не установлена.',error:'Не удалось подготовить модель. Используйте голос устройства или записи.'};
    const updateGate=()=>{
      const state=window.echoVoiceStudioState?.();
      const checks={
        model:nativeState?.ready===true && nativeState?.phase==='ready',
        language:document.documentElement.lang==='en',
        sample:!!state?.sampleReady,
        consent:document.getElementById('echoStudioConsent').checked,
        text:!!document.getElementById('echoStudioText').value.trim()
      };
      for(const [key,done] of Object.entries(checks)){
        const row=rows.get(key);
        if(row)row.setAttribute('data-state',done?'ready':'waiting');
      }
      const next=checks.model?'Модель готова. ':'Дождитесь загрузки модели. ';
      const pending=Object.keys(checks).filter(key=>!checks[key]);
      const descriptions={language:'переключите язык на English',sample:'сохраните образец WAV',consent:'поставьте отметку согласия',text:'введите новый текст'};
      const nextStep=pending.map(key=>descriptions[key]).find(Boolean);
      const guideMessage=next+(nextStep?'Следующий шаг: '+nextStep+'.':'Можно нажать «Синтезировать моим голосом».');
      if(hint.textContent!==guideMessage)hint.textContent=guideMessage;
      const enabled=nativeState?.ready===true && nativeState?.phase==='ready' &&
        state?.sampleReady && !state.busy && document.getElementById('echoStudioConsent').checked &&
        document.documentElement.lang==='en' && !!document.getElementById('echoStudioText').value.trim();
      if(generate.disabled===enabled)generate.disabled=!enabled;
    };
    const refresh=async()=>{
      try{
        nativeState=await window.echoNativeVoice.status();
        const note=nativeState.ready?'Модель готова к генерации. Нужны сохранённый образец, согласие, текст и английский язык интерфейса.':
          nativeState.phase==='error' && nativeState.errorCode?window.echoNativeVoice.describeError(nativeState.errorCode):phases[nativeState.phase]||phases.error;
        // Compare in the active language: otherwise the poll overwrites translated
        // live-region text every three seconds and repeatedly interrupts screen readers.
        const displayedNote=window.echoI18n?.translate(note)||note;
        if(pcNote.textContent!==displayedNote)pcNote.textContent=displayedNote;
        const title=nativeState.ready?'Синтезировать моим голосом':'Проверяю локальную AI-модель…';
        const displayedTitle=window.echoI18n?.translate(title)||title;
        if(generate.textContent!==displayedTitle)generate.textContent=displayedTitle;
      }catch{nativeState=null;pcNote.textContent=phases.error;}
      updateGate();
      // Installation / JNI loading can take minutes; keep status current without blocking UI.
      setTimeout(refresh,nativeState?.ready?3000:1000);
    };
    window.addEventListener('echo-sample-validated',updateGate);
    studio.addEventListener('input',updateGate);studio.addEventListener('change',updateGate);
    new MutationObserver(updateGate).observe(studio,{subtree:true,attributes:true,attributeFilter:['disabled','aria-busy']});
    new MutationObserver(updateGate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    refresh();
  }
  let operation=0;
  async function check() {
    const token=++operation;const button=document.getElementById('echoOfflineCheck');button.disabled=true;
    const s=await status();if(token!==operation)return;
    document.getElementById('echoOfflineModelStatus').textContent=s.ready?'Офлайн-модель PocketTTS найдена. Можно запустить английский AI-синтез с собственным WAV-образцом. Работа на устройстве ещё требует проверки.':s.reason==='model_missing'?'Нативный движок найден, но проверенная офлайн-модель не установлена. Используйте голос устройства или записи.':'Автономная модель телефона не подключена. Android и iPhone не проверены. Используйте голос устройства или записи.';
    button.disabled=false;
  }
  document.getElementById('echoOfflineCheck').onclick=async()=>{await window.echoNativeVoice?.prepare?.();check();};
  document.getElementById('echoOfflineUseDevice').onclick=()=>document.getElementById('echoUseDevice').click();
  document.getElementById('echoOfflineUseRecordings').onclick=()=>document.getElementById('echoUseRecordings').click();
  window.addEventListener('echo-native-voice-ready',check);check();
})();
