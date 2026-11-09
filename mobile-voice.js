/* Shared, explicit mobile host handshake. On GitHub Pages no native bridge is exposed. */
(() => {
  "use strict";
  const android = window.EchoAndroid && typeof window.EchoAndroid.request === "function";
  const ios = window.webkit?.messageHandlers?.echoNative;
  if (!android && !ios) return;
  const pending = new Map();
  let sequence = 0;
  const nativeErrors={busy:'ИИ уже генерирует фразу. Остановите её или дождитесь окончания.',
        model_not_ready:'Модель ещё не готова. Дождитесь проверки файлов и загрузки движка.',
        reference:'Нужна слышимая запись: моно PCM WAV, 16 бит, 5–30 секунд.',
        cancelled:'Генерация отменена.', timeout:'Время генерации истекло. Попробуйте более короткий текст.',
        storage:'Недостаточно свободного места для офлайн-модели.',
        checksum:'Файлы модели повреждены. Переустановите тестовую сборку без удаления данных.',
        native_runtime:'Не удалось загрузить нативный AI-движок этой сборки.',
        memory:'Недостаточно памяти для AI-модели. Закройте другие приложения.',
        engine:'Не удалось выполнить AI-синтез. Проверьте модель и образец.'};
  // Called only by the native app shell. Never treat native status as proof of successful inference.
  window.echoNativeReply = (id, payload) => {
    const p = pending.get(String(id));
    if (!p) return;
    pending.delete(String(id));
    p.cleanup?.();
    if (payload && payload.error) {
      p.reject(new Error(nativeErrors[payload.error]||String(payload.error)));
    }
    else p.resolve(payload);
  };
  function request(type, data = {}, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const abort = () => {
        pending.delete(id); cleanup();
        try {
          if (android) window.EchoAndroid.request(JSON.stringify({ id, type: "cancel" }));
          else ios.postMessage({ id, type: "cancel" });
        } catch (_) {}
        reject(new DOMException("Cancelled", "AbortError"));
      };
      // Permission / SAF prompts remain user-controlled. Native inference is cooperative;
      // a timeout also sends cancellation, rather than only hiding the pending promise.
      const timer=setTimeout(abort,type==='synthesize'?245000:
        ['saveStart','microphonePermission'].includes(type)?600000:15000);
      const cleanup = () => {clearTimeout(timer);signal?.removeEventListener("abort", abort);};
      pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (android) window.EchoAndroid.request(JSON.stringify({ id, type, ...data }));
        else ios.postMessage({ id, type, ...data });
      } catch (error) {
        pending.delete(id); cleanup(); reject(error);
      }
    });
  }
  if(android){
    const utterances=new Map();let utteranceSequence=0,refreshAttempts=0;
    class AndroidSpeech extends EventTarget {
      constructor(){super();this.voices=[];}
      getVoices(){return this.voices;}
      async refresh(){try{const result=await request("ttsVoices");this.voices=(result.voices||[]).map(v=>({...v,localService:true,default:false}));this.dispatchEvent(new Event('voiceschanged'));if(result.loading && ++refreshAttempts<12)setTimeout(()=>this.refresh(),400);}catch{this.voices=[];}}
      speak(utterance){utterances.clear();const id='tts-'+(++utteranceSequence);utterances.set(id,utterance);request("ttsSpeak",{utteranceId:id,text:utterance.text,language:utterance.lang,voice:utterance.voice?.name||'',rate:utterance.rate,pitch:utterance.pitch,volume:utterance.volume}).catch(()=>{if(utterances.has(id)){utterances.delete(id);utterance.onerror?.({error:'synthesis-failed'});}});}
      cancel(){utterances.clear();request("ttsStop").catch(()=>{});}
    }
    window.echoAndroidSpeech=new AndroidSpeech();
    window.echoNativeTTSEvent=(id,state)=>{const u=utterances.get(String(id));if(!u)return;if(state==='start')u.onstart?.();else{utterances.delete(String(id));state==='end'?u.onend?.():u.onerror?.({error:'synthesis-failed'});}};
    window.addEventListener('focus',()=>window.echoAndroidSpeech.refresh());window.echoAndroidSpeech.refresh();
  }
  if(android)window.echoNativeFiles=Object.freeze({
    async saveBlob(blob,name){
      if(!(blob instanceof Blob) || blob.size>100*1024*1024)throw new Error("Резервная копия превышает 100 МБ.");
      const {session}=await request("saveStart",{name});
      try {
        for(let at=0;at<blob.size;at+=65536){
          const bytes=new Uint8Array(await blob.slice(at,at+65536).arrayBuffer());let binary="";
          for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
          await request("saveChunk",{session,base64:btoa(binary)});
        }
        const result=await request("saveFinish",{session});if(result.saved!==true)throw new Error("Файл не сохранён.");
      }catch(error){await request("saveAbort",{session}).catch(()=>{});throw error;}
    }
  });
  async function checkReferenceWav(blob,signal) {
    if(!android)throw new Error("Проверка WAV доступна в Android-приложении.");
    if(!(blob instanceof Blob) || !blob.size || blob.size>8*1024*1024)
      throw new Error("Нужен WAV-файл до 8 МБ.");
    const bytes=new Uint8Array(await blob.arrayBuffer());
    signal?.throwIfAborted();
    let binary='';
    for(let offset=0;offset<bytes.length;offset+=8192)
      binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    return request("aiReferenceCheck",{referenceWavBase64:btoa(binary)},signal);
  }
  window.echoNativeVoice = Object.freeze({
    apiVersion: 1,
    describeError: code => nativeErrors[code] || nativeErrors.engine,
    status: () => request("status"),
    prepare: () => request("prepare"),
    checkReferenceWav,
    requestMicrophonePermission: () => request("microphonePermission"),
    synthesize: ({ text, language, referenceWavBase64, consent, signal }) => {
      if (typeof text !== "string" || text.length === 0 || text.length > 300)
        return Promise.reject(new Error("Некорректный текст."));
      if (typeof referenceWavBase64 !== "string" || referenceWavBase64.length > 16 * 1024 * 1024)
        return Promise.reject(new Error("Слишком большой голосовой образец."));
      if(consent!==true)return Promise.reject(new Error("Требуется согласие владельца голоса."));
      return request("synthesize", { text, language, referenceWavBase64, consent:true }, signal);
    }
  });
})();
