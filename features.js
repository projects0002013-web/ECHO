/* Local communication, voice recording and personal speech. No remote API. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const normalized = text => text.trim().replace(/\s+/g, " ");
  const phraseKey = (text, language = echoCurrentLanguage) => `phrase:${language}:${normalized(text)}`;
  let dbPromise, sample = null, recorder = null, audio = null, audioURL = null;
  let speechJob = 0, controller = null, mode = "device", lastFocus;
  let audioEpoch = 0, draft = null, recordOperation = 0, preparedAudio = null;
  try { mode = localStorage.getItem("echoSpeechMode") || "device"; } catch (_) {}
  if (!["device", "recordings", "personal"].includes(mode)) mode = "device";

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("echo-local-voice", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("audio", { keyPath: "key" });
        request.result.createObjectStore("cache", { keyPath: "key" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
        resolve(request.result);
      };
      request.onerror = () => { dbPromise = null; reject(new Error("Не удалось открыть локальное хранилище.")); };
      request.onblocked = () => { dbPromise = null; reject(new Error("Закройте другие вкладки ECHO и повторите.")); };
    });
    return dbPromise;
  }
  async function db(store, action, value, current = () => true) {
    const connection = await database();
    if (!current()) throw new DOMException("Операция отменена", "AbortError");
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(store, action === "get" || action === "getAll" ? "readonly" : "readwrite");
      const request = tx.objectStore(store)[action](value);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error("Не удалось сохранить данные. Проверьте свободное место."));
    });
  }
  function message(text) { $("echoSpeechStatus").textContent = text; }
  window.echoSpeechNotice = message;
  function voiceMessage(text) { $("echoLocalVoiceStatus").textContent = text; }
  function errorText(error) {
    if (error.name === "NotAllowedError") return "Разрешите ECHO использовать микрофон в настройках Android или браузера.";
    if (error.name === "NotFoundError") return "Микрофон не найден. Можно загрузить аудиофайл.";
    return window.echoI18n.error(error);
  }
  function stop() {
    window.dispatchEvent(new CustomEvent('echo-voice-activity',{detail:{playing:false}}));
    speechJob++;
    preparedAudio = null;
    if ($("echoResumeAudio")) $("echoResumeAudio").hidden = true;
    controller?.abort(); controller = null;
    if (audio) { audio.pause(); audio.src = ""; audio = null; }
    if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
    echoPiperStop();
    echoBrowserStop();
  }
  window.echoStopSpeech = stop;
  async function play(blob, job) {
    if (job !== speechJob) return;
    audioURL = URL.createObjectURL(blob);
    audio = new Audio(audioURL);
    audio.volume = Math.max(0, Math.min(1, Number(echoSettings.volume) || 0));
    audio.playbackRate = Math.max(0.5, Math.min(2, Number(echoSettings.rate) || 1));
    audio.preservesPitch = true;
    const playing = audio;
    playing.onended = () => { if (playing === audio) { stop(); message("Готово"); } };
    playing.onerror = () => { if (playing === audio) { stop(); message("Не удалось воспроизвести запись."); } };
    try { await playing.play(); if(job===speechJob)window.dispatchEvent(new CustomEvent('echo-voice-activity',{detail:{playing:true}})); }
    catch (error) {
      if (job !== speechJob) return;
      if (playing === audio) { playing.pause(); playing.src = ""; audio = null; if (audioURL) URL.revokeObjectURL(audioURL); audioURL = null; }
      if (job === speechJob && error.name === "NotAllowedError") offerPreparedAudio(blob);
      throw new Error(error.name === "NotAllowedError" ? "Браузер заблокировал звук. Нажмите кнопку прослушивания ещё раз." : "Не удалось воспроизвести запись.");
    }
  }
  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let encoded = "";
    for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(encoded);
  }
  async function hash(blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }
  function languageNotSupported(status, language) {
    return !Array.isArray(status.languages) || !status.languages.includes(language);
  }
  function wavBlobFromBase64(value) {
    // A native bridge must return an actual WAV, not arbitrary file content or a URL.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 48 * 1024 * 1024)
      throw new Error("Некорректные данные от мобильного голосового движка.");
    const binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "audio/wav" });
  }
  async function personal(text, job, { autoplay = true, fresh = false } = {}) {
    if (!sample) throw new Error("Сначала запишите образец своего голоса в настройках.");
    const nativeVoice = window.echoNativeVoice;
    const nativeAvailable = nativeVoice && typeof nativeVoice.status === "function" && typeof nativeVoice.synthesize === "function";
    const nativeStatus = nativeAvailable ? await nativeVoice.status() : null;
    const nativeReady = nativeStatus && nativeStatus.ready === true && nativeStatus.platform && ["android", "ios"].includes(nativeStatus.platform);
    if (nativeAvailable && !nativeReady) throw new Error("Мобильная модель не готова. Установите совместимую модель в нативном приложении ECHO.");
    if (nativeReady ? languageNotSupported(nativeStatus, echoCurrentLanguage) : !["ru", "en"].includes(echoCurrentLanguage))
      throw new Error("Выбранный язык не поддерживается установленным голосовым движком. Используйте записи или голос устройства.");
    const reference = sample, language = echoCurrentLanguage, epoch = audioEpoch;
    const current = () => job === speechJob && epoch === audioEpoch;
    const key = `${reference.id}:${language}:${normalized(text)}`;
    const saved = await db("cache", "get", key);
    if (job !== speechJob) return;
    if (saved && !fresh) {
      message("Персональный голос · сохранённая фраза");
      if (autoplay) await play(saved.blob, job);
      return { blob: saved.blob, language, sampleId: reference.id };
    }
    if (!nativeReady && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      throw new Error("На этом сайте нет локального мобильного ИИ. Откройте ECHO в нативном приложении с установленной моделью; образец не будет отправлен на сайт.");
    }
    message("Создаю фразу вашим голосом на этом устройстве… Первый запуск может занять несколько минут.");
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => { if (job === speechJob) controller?.abort(); }, 240000);
    try {
      let blob;
      if (nativeReady) {
        // Native shell must enforce trusted local app origin, explicit consent, and never use network.
        const result = await nativeVoice.synthesize({
          text, language, referenceWavBase64: await base64(reference.blob), consent:true, signal
        });
        if (result instanceof Blob) blob = result;
        else if (result && typeof result.wavBase64 === "string") blob = wavBlobFromBase64(result.wavBase64);
        else throw new Error("Мобильный движок не вернул WAV.");
      } else {
        const response = await fetch("/api/voice/synthesize", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ text, language, reference: await base64(reference.blob) })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Локальный сервер недоступен. Запустите ECHO по инструкции.");
        }
        blob = await response.blob();
      }
      if (job !== speechJob) return;
      {
        const header = new TextDecoder('ascii').decode(await blob.slice(0, 12).arrayBuffer());
        if (blob.size <= 44 || !header.startsWith('RIFF') || header.slice(8) !== 'WAVE') throw new Error("Голосовой движок вернул некорректный WAV.");
      }
      // Keep at most 50 generated phrases on this device.
      const cached = (await db("cache", "getAll")).sort((a, b) => a.time - b.time);
      for (const item of cached.slice(0, Math.max(0, cached.length - 49))) await db("cache", "delete", item.key, current);
      let cacheWarning = false;
      try { await db("cache", "put", { key, blob, time: Date.now() }, current); }
      catch (_) { if (!current()) return; cacheWarning = true; }
      if (!current()) return;
      if (autoplay) await play(blob, job);
      if (job === speechJob) message((autoplay ? "Произношу персональным голосом" : "Новый WAV создан локальным ИИ. Нажмите «Прослушать результат».") + (cacheWarning ? " · не сохранено офлайн: проверьте свободное место" : ""));
      return { blob, language, sampleId: reference.id, cacheWarning };
    } finally { clearTimeout(timeout); }
  }
  window.echoLocalSpeech = text => {
    if (mode === "device") return false;
    stop();
    const job = speechJob;
    (async () => {
      if (mode === "personal") return personal(text, job);
      const recording = await db("audio", "get", phraseKey(text));
      if (job !== speechJob) return;
      if (recording) { message("Произношу сохранённой записью"); return play(recording.blob, job); }
      message("Для этой фразы нет записи · используется голос устройства");
      echoBrowserSpeak(text);
    })().catch(error => {
      if (job !== speechJob) return;
      message((error.name === "AbortError" ? "Время ожидания истекло. Повторите после загрузки модели." : errorText(error)) + " Выберите голос устройства или сохранённые записи.");
      offerFallback();
    });
    return true;
  };

  function offerPreparedAudio(blob) { preparedAudio = blob; $("echoResumeAudio").hidden = false; }
  window.echoOfferPreparedAudio = offerPreparedAudio;
  function offerFallback() { $("echoVoiceFallback").hidden = false; }
  window.echoOfferVoiceFallback = offerFallback;
  function setMode(next) {
    const previous = mode;
    stop();
    try { localStorage.setItem("echoSpeechMode", next); mode = next; }
    catch (_) { mode = previous; voiceMessage("Режим не сохранён: хранилище браузера недоступно."); message("Режим не сохранён: проверьте свободное место."); }
    $("echoSpeechMode").value = mode;
    return mode === next;
  }
  const controls = document.createElement("div");
  controls.className = "echo-speech-controls";
  controls.innerHTML = `<button type="button" id="echoStopSpeech">■ Остановить голос</button><button type="button" id="echoResumeAudio" hidden>▶ Воспроизвести подготовленную запись</button><span id="echoSpeechStatus" role="status" aria-live="polite">Готово</span>
    <div id="echoVoiceFallback" hidden><span>Можно выбрать другой источник и нажать фразу снова:</span>
    <button type="button" id="echoUseDevice">Голос устройства</button><button type="button" id="echoUseRecordings">Сохранённые записи</button></div>`;
  document.querySelector(".custom-section").appendChild(controls);
  $("echoResumeAudio").onclick = () => {
    const blob = preparedAudio; if (!blob) return;
    stop(); const job = speechJob;
    play(blob, job).then(() => { if (job === speechJob) message("Произношу подготовленную запись"); }).catch(error => { if (job === speechJob) message(errorText(error)); });
  };
  $("echoUseDevice").onclick = () => {
    if (setMode("device")) { echoPiperConfig.enabled = false; const saved = echoPiperSave(); $("echoPiperEnabled").checked = false; if (!saved) { message("Голос устройства выбран для этого сеанса; настройки Piper не сохранены."); return; } $("echoVoiceFallback").hidden = true; message("Выбран голос устройства. Нажмите фразу для воспроизведения."); }
  };
  $("echoUseRecordings").onclick = () => { if (setMode("recordings")) { $("echoVoiceFallback").hidden = true; message("Выбраны сохранённые записи. Нажмите фразу для воспроизведения."); } };
  $("echoStopSpeech").onclick = () => { stop(); message("Озвучка остановлена"); };
  $("echoSOSStop").addEventListener("click", () => { stop(); message("Озвучка остановлена"); });

  // Compose a message from large buttons; keep the existing card layout intact.
  const composer = document.createElement("section");
  composer.className = "echo-local-panel echo-composer";
  composer.innerHTML = `<h3>🧩 Собрать сообщение</h3>
    <p>Нажимайте на слова или добавляйте свои. Готовую фразу можно произнести и сохранить карточкой.</p>
    <div id="echoWordChoices" class="echo-word-choices" aria-label="Слова для сообщения"></div>
    <label for="echoSentence">Ваше сообщение</label><textarea id="echoSentence" rows="2" maxlength="300" placeholder="Я хочу…"></textarea>
    <div class="echo-local-actions"><button type="button" id="echoSentenceSpeak">🔊 Произнести</button><button type="button" id="echoSentenceUndo">⌫ Убрать слово</button><button type="button" id="echoSentenceClear">Очистить</button><button type="button" id="echoSentenceSave">＋ В карточки</button></div>`;
  document.querySelector(".custom-section").after(composer);
  const words = window.echoI18n.words;
  function renderWords() {
    $("echoWordChoices").replaceChildren();
    for (const word of words[echoCurrentLanguage] || words.ru) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = word;
      button.onclick = () => {
        const text = normalized($("echoSentence").value + " " + word);
        if (text.length <= 300) $("echoSentence").value = text;
        else message("Сообщение не должно превышать 300 символов.");
      };
      $("echoWordChoices").appendChild(button);
    }
  }
  $("echoSentenceSpeak").onclick = () => { const text = normalized($("echoSentence").value); if (text) speak(text); else $("echoSentence").focus(); };
  $("echoSentenceUndo").onclick = () => { $("echoSentence").value = normalized($("echoSentence").value).split(" ").slice(0, -1).join(" "); };
  $("echoSentenceClear").onclick = () => { $("echoSentence").value = ""; $("echoSentence").focus(); };
  $("echoSentenceSave").onclick = () => {
    const text = normalized($("echoSentence").value);
    if (!text) return $("echoSentence").focus();
    openAddModal(); $("newPhraseText").value = text; $("newPhraseName").value = text.slice(0, 40);
  };
  const oldLanguage = applyEchoLanguage;
  applyEchoLanguage = language => {
    if (recorder || draft) {
      recordOperation++; if (recorder) finishRecording(false); if (draft) discardDraft();
      voiceMessage("Запись отменена при смене языка. Начните новую запись на выбранном языке.");
    }
    if (typeof cancelStudio === "function") { cancelStudio(); clearStudioResult(); studioStatus("Сохраните образец, затем введите новый текст."); }
    stop(); message("Озвучка остановлена"); oldLanguage(language); renderWords(); updateTargets(); renderEchoHistory();
  };
  renderWords();
  const oldFavorites = updateFavorites;
  updateFavorites = (...args) => { oldFavorites(...args); updateEchoCategories(); };

  const panel = document.createElement("section");
  panel.id = "echoLocalVoicePanel"; panel.className = "echo-local-panel";
  panel.innerHTML = `<h3 id="echoStudioTitle" tabindex="-1">Мой голос</h3><button type="button" id="echoOpenStudio">Открыть студию голоса</button><button type="button" id="echoStudioBack" hidden>Назад к фразам</button>
    <p>Записи хранятся в этом браузере. Персональный голос создаёт новые фразы по вашему образцу на локальном компьютере — аудио не отправляется в облако.</p>
    <label for="echoSpeechMode">Как произносить сообщения</label><select id="echoSpeechMode"><option value="device">Голос устройства / Piper</option><option value="recordings">Записи фраз · иначе голос устройства</option><option value="personal">Мой персональный голос · локальный ИИ</option></select>
    <p>Источник «Голос устройства / Piper» использует Piper только при включённой настройке ниже. Новая генерация ИИ требует локального компьютера; на телефоне доступны записи и голоса устройства.</p>
    <label for="echoRecordTarget">Что записать</label><select id="echoRecordTarget"><option value="sample">Образец моего голоса · 6–30 секунд</option><option value="phrase">Озвучку одной фразы · до 30 секунд</option></select>
    <div id="echoPhraseRecordingFields" hidden><label for="echoRecordText">Текст записываемой фразы</label><input id="echoRecordText" list="echoRecordPhrases" maxlength="300" placeholder="Я хочу пить"><datalist id="echoRecordPhrases"></datalist></div>
    <p id="echoRecordHint">Спокойно прочитайте: «Привет! Это мой голос. Я хочу свободно общаться, говорить о своих желаниях, просить о помощи и благодарить близких. Сегодня хороший день».</p>
    <div class="echo-local-actions"><button type="button" id="echoRecordStart">● Записать голос</button><button type="button" id="echoRecordStop" disabled>■ Завершить</button><button type="button" id="echoSamplePlay" disabled>▶ Мой образец</button></div>
    <label for="echoAudioImport">Или загрузите запись с этого устройства</label><input id="echoAudioImport" type="file" accept="audio/*">
    <div id="echoAudioDraft" hidden><p>Прослушайте запись перед сохранением. Пока она находится только в памяти.</p>
    <label><input type="checkbox" id="echoVoiceConsent"> Это мой голос или у меня есть разрешение владельца на создание персонального голоса.</label>
    <div class="echo-local-actions"><button type="button" id="echoDraftPlay">▶ Прослушать перед сохранением</button><button type="button" id="echoDraftSave">Сохранить запись</button><button type="button" id="echoDraftDiscard">Не сохранять</button></div></div>
    <span id="echoRecordTimer" role="timer">00:00</span><p id="echoLocalVoiceStatus" role="status" aria-live="polite">Образец голоса пока не записан.</p>
    <div class="echo-local-actions"><button type="button" id="echoEngineCheck">Проверить локальный ИИ</button><button type="button" id="echoSampleDelete">Удалить образец и созданные фразы</button></div>
    <p class="echo-local-note">Образец позволяет приблизить тембр, но сходство не гарантируется. Создание новой фразы требует локальной модели; уже созданные фразы и записи работают офлайн. Русский и английский поддерживаются; казахский и белорусский используют голос устройства.</p>
    <section class="echo-studio-compose" aria-labelledby="echoStudioComposeTitle">
      <h4 id="echoStudioComposeTitle">Новая фраза моим голосом</h4>
      <label for="echoStudioText">Текст для ИИ-синтеза</label><textarea id="echoStudioText" rows="3" maxlength="300" placeholder="Введите новый текст"></textarea>
      <label class="echo-history-choice"><input type="checkbox" id="echoStudioConsent"> Я использую свой голос и разрешаю его локальный ИИ-синтез.</label>
      <div class="echo-local-actions"><button type="button" id="echoStudioGenerate">Синтезировать</button><button type="button" id="echoStudioStop">Остановить</button></div>
      <p id="echoStudioStatus" role="status" aria-live="polite">Сохраните образец, затем введите новый текст.</p>
      <div id="echoStudioResult" hidden><p id="echoStudioResultText" data-no-i18n></p><div class="echo-local-actions"><button type="button" id="echoStudioPlay">Прослушать результат</button><button type="button" id="echoStudioDelete">Удалить результат</button></div></div>
      <button type="button" id="echoStudioUse">Использовать для карточек</button>
      <details id="echoStudioSetup"><summary>Установка локального ИИ</summary><p>На своём компьютере выполните команды в папке ECHO. Установка скачивает модель; синтез работает локально. Откройте http://127.0.0.1:8000.</p><pre><code>bash scripts/setup.sh --voice
.voice-venv/bin/python echo_server.py</code></pre><p>Новые фразы ИИ доступны на русском и английском. Для других языков используйте записи или голос устройства.</p></details>
    </section>
    <h4>Записанные фразы</h4><div id="echoRecordingsList"></div>`;
  voicePanel.prepend(panel);
  const voiceEntry = document.createElement("button");
  voiceEntry.type = "button"; voiceEntry.id = "echoVoiceStudioNav"; voiceEntry.className = "echo-voice-entry"; voiceEntry.textContent = "Мой голос";
  document.querySelector(".header").insertBefore(voiceEntry, document.querySelector(".settings-btn"));
  voiceEntry.onclick = $("echoOpenStudio").onclick = () => { route("voice"); $("echoStudioTitle").focus(); };
  $("echoStudioBack").onclick = () => { route("phrases"); voiceEntry.focus(); };
  let studioResult = null, studioOperation = 0;
  const studioStatus = text => { $("echoStudioStatus").textContent = text; };
  function clearStudioResult() { studioResult = null; $("echoStudioResult").hidden = true; }
  function cancelStudio() { studioOperation++; stop(); $("echoStudioGenerate").disabled = false; $("echoStudioText").removeAttribute("aria-busy"); }
  $("echoStudioStop").onclick = () => { cancelStudio(); studioStatus("Синтез и воспроизведение остановлены."); };
  $("echoStudioGenerate").onclick = async () => {
    if (recorder || draft) { studioStatus("Сначала завершите и сохраните запись образца."); return; }
    const text = $("echoStudioText").value.trim();
    if (!text) { studioStatus("Введите текст для синтеза."); $("echoStudioText").focus(); return; }
    if (!$("echoStudioConsent").checked) { studioStatus("Подтвердите разрешение на использование своего голоса."); return; }
    cancelStudio(); clearStudioResult(); const operation = studioOperation, job = speechJob;
    $("echoStudioGenerate").disabled = true; $("echoStudioText").setAttribute("aria-busy", "true");
    studioStatus("Создаю новый WAV локальным ИИ…");
    try {
      const result = await personal(text, job, { autoplay: false, fresh: true });
      if (operation !== studioOperation || job !== speechJob || !result) return;
      studioResult = { ...result, text }; $("echoStudioResultText").textContent = text;
      $("echoStudioResult").hidden = false;
      studioStatus("Новый WAV создан локальным ИИ. Нажмите «Прослушать результат»." + (result.cacheWarning ? " · не сохранено офлайн: проверьте свободное место" : ""));
    } catch (error) {
      if (operation !== studioOperation || job !== speechJob) return;
      studioStatus(error.name === "AbortError" ? "Время ожидания истекло. Повторите после загрузки модели." : error instanceof TypeError ? "Не удалось связаться с локальным ИИ. Запустите сервер по инструкции ниже." : errorText(error));
      $("echoStudioSetup").open = true;
    } finally {
      if (operation === studioOperation) { $("echoStudioGenerate").disabled = false; $("echoStudioText").removeAttribute("aria-busy"); if (job !== speechJob) studioStatus("Синтез и воспроизведение остановлены."); }
    }
  };
  $("echoStudioPlay").onclick = async () => {
    if (!studioResult) return;
    stop(); const job = speechJob;
    try { await play(studioResult.blob, job); if (job === speechJob) studioStatus("Проигрываю результат ИИ-синтеза."); }
    catch (error) { if (job === speechJob) studioStatus(errorText(error)); }
  };
  $("echoStudioDelete").onclick = async () => {
    const result = studioResult; if (!result) return;
    cancelStudio();
    try { await db("cache", "delete", `${result.sampleId}:${result.language}:${normalized(result.text)}`); clearStudioResult(); studioStatus("Результат удалён. Образец голоса сохранён."); }
    catch (error) { studioStatus(errorText(error)); }
  };
  $("echoStudioUse").onclick = () => {
    if (!sample) { studioStatus("Сначала запишите образец своего голоса в настройках."); return; }
    if (setMode("personal")) { studioStatus("Персональный голос выбран для карточек."); message("Источник голоса изменён. Нажмите фразу для воспроизведения."); }
  };
  $("echoSpeechMode").value = mode;
  $("echoSpeechMode").onchange = () => {
    const next = $("echoSpeechMode").value;
    if (setMode(next)) { $("echoVoiceFallback").hidden = true; message("Источник голоса изменён. Нажмите фразу для воспроизведения."); if (mode === "personal") checkEngine(); }
  };
  function updateTargets() {
    $("echoRecordPhrases").replaceChildren();
    const texts = new Set([...document.querySelectorAll(".phrase-card")].map(c => c.dataset.text));
    for (const text of texts) { const option = document.createElement("option"); option.value = text; $("echoRecordPhrases").appendChild(option); }
  }
  $("echoRecordTarget").onchange = () => {
    $("echoPhraseRecordingFields").hidden = $("echoRecordTarget").value !== "phrase";
    $("echoRecordHint").hidden = $("echoRecordTarget").value !== "sample";
  };
  updateTargets();
  new MutationObserver(updateTargets).observe(phraseGrid, { childList: true });

  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
    const string = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    string(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); string(8, "WAVE"); string(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    string(36, "data"); view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, i) => { const s = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); });
    return new Blob([buffer], { type: "audio/wav" });
  }
  function recordingUI(busy) {
    for (const id of ["echoRecordStart", "echoRecordTarget", "echoRecordText", "echoAudioImport", "echoSampleDelete", "echoSpeechMode"]) $(id).disabled = busy;
    $("echoRecordStop").disabled = !busy;
    if (!busy) $("echoSampleDelete").disabled = !sample;
  }
  async function saveAudio(samples, rate, target, text, language, epoch, operation = recordOperation) {
    const duration = samples.length / rate;
    if (!Number.isFinite(duration) || !Number.isFinite(rate) || rate <= 0) throw new Error("Запись ещё не началась. Повторите запись после разрешения микрофона.");
    if (duration < (target === "sample" ? 6 : 0.3) || duration > 30.1) throw new Error(target === "sample" ? "Запишите от 6 до 30 секунд речи." : "Запись должна длиться от 0,3 до 30 секунд.");
    const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    if (rms < 0.002) throw new Error("Запись слишком тихая. Поднесите микрофон ближе и повторите.");
    const blob = encodeWav(samples, rate);
    const entry = { key: target === "sample" ? "sample" : phraseKey(text, language), blob, duration,
      text, language, id: await hash(blob), time: Date.now() };
    if (epoch !== audioEpoch || operation !== recordOperation) throw new Error("Сохранение отменено: голосовые данные были удалены.");
    stop(); draft = { entry, epoch };
    $("echoAudioDraft").hidden = false;
    $("echoVoiceConsent").checked = false;
    $("echoVoiceConsent").parentElement.hidden = target !== "sample";
    $("echoDraftSave").disabled = target === "sample";
    voiceMessage("Запись готова. Прослушайте и нажмите «Сохранить запись».");
  }
  function discardDraft() {
    stop(); draft = null; $("echoAudioDraft").hidden = true;
  }
  $("echoVoiceConsent").onchange = () => { $("echoDraftSave").disabled = !draft || (draft.entry.key === "sample" && !$("echoVoiceConsent").checked); };
  $("echoDraftPlay").onclick = () => { if (draft) { stop(); play(draft.entry.blob, speechJob).catch(e => voiceMessage(errorText(e))); } };
  $("echoDraftDiscard").onclick = () => { discardDraft(); voiceMessage("Запись не сохранена. Прежние записи остаются на устройстве."); };
  $("echoDraftSave").onclick = async () => {
    const pending = draft; if (!pending || (pending.entry.key === "sample" && !$("echoVoiceConsent").checked)) return;
    $("echoDraftSave").disabled = true;
    $("echoDraftDiscard").disabled = $("echoDraftPlay").disabled = true;
    recordingUI(true); $("echoRecordStop").disabled = true;
    let cacheCleanupFailed = false;
    const current = () => draft === pending && pending.epoch === audioEpoch;
    try {
      await db("audio", "put", pending.entry, current);
      if (!current()) return;
      // Cache keys include the sample hash, so replacing a sample never reuses its old voice.
      if (pending.entry.key === "sample") {
        sample = pending.entry; clearStudioResult();
        try { await db("cache", "clear", undefined, current); }
        catch (_) { cacheCleanupFailed = true; }
      }
      discardDraft(); await renderRecordings();
      voiceMessage((pending.entry.key === "sample" ? "Образец сохранён на этом устройстве. Выберите персональный голос и проверьте локальный ИИ." : "Запись фразы сохранена. Выберите режим «Записи фраз» для воспроизведения.") + (cacheCleanupFailed ? " Старый кэш не очищен, но не будет использован для нового образца." : ""));
      navigator.storage?.persist?.().catch(() => {});
    } catch (error) { voiceMessage(errorText(error)); }
    finally { recordingUI(false); $("echoDraftDiscard").disabled = $("echoDraftPlay").disabled = false; $("echoDraftSave").disabled = !draft || (draft.entry.key === "sample" && !$("echoVoiceConsent").checked); }
  };
  async function finishRecording(save = true) {
    const state = recorder; if (!state || state.finishing) return;
    state.finishing = true; recorder = null;
    clearInterval(state.timer);
    state.source?.disconnect(); state.node?.disconnect(); state.silent?.disconnect();
    state.stream?.getTracks().forEach(t => t.stop());
    const operation = recordOperation;
    if (!save) recordOperation++;
    const closingOperation = recordOperation;
    try { await state.context?.close(); } catch (_) { /* Tracks are already stopped. */ }
    if (!save) { if (closingOperation === recordOperation && !recorder) recordingUI(false); return; }
    if (operation !== recordOperation) return;
    recordingUI(false);
    if (!Number.isFinite(state.rate)) { voiceMessage("Запись ещё не началась. Повторите после разрешения микрофона."); return; }
    try {
      const count = state.chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(Math.min(count, Math.floor(state.rate * 30)));
      let offset = 0;
      for (const chunk of state.chunks) { const part = chunk.subarray(0, merged.length - offset); merged.set(part, offset); offset += part.length; }
      if (operation !== recordOperation) return;
      await saveAudio(merged, state.rate, state.target, state.text, state.language, state.epoch, operation);
    } catch (error) { voiceMessage(errorText(error)); }
  }
  $("echoRecordStart").onclick = async () => {
    const target = $("echoRecordTarget").value, text = normalized($("echoRecordText").value);
    if (target === "phrase" && !text) { voiceMessage("Сначала введите текст записываемой фразы."); return $("echoRecordText").focus(); }
    if (!navigator.mediaDevices?.getUserMedia) return voiceMessage("Запись доступна в приложении на localhost или по HTTPS. Можно загрузить аудиофайл.");
    discardDraft(); recordOperation++; recordingUI(true);
    const state = { target, text, chunks: [], frames: 0, finishing: false, language: echoCurrentLanguage, epoch: audioEpoch }; recorder = state;
    voiceMessage("Ожидаю разрешение на микрофон…");
    try {
      // Native Android asks for app permission before WebView requests microphone access.
      if (typeof window.echoNativeVoice?.requestMicrophonePermission === "function") {
        const permission = await window.echoNativeVoice.requestMicrophonePermission();
        if (!permission || permission.granted !== true) throw new Error("Не удалось получить разрешение на микрофон в Android.");
      }
      if (recorder !== state) return;
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (recorder !== state) { state.stream.getTracks().forEach(t => t.stop()); return; }
      state.context = new AudioContext();
      await state.context.resume();
      if (recorder !== state) return;
      state.rate = state.context.sampleRate;
      state.source = state.context.createMediaStreamSource(state.stream);
      state.silent = state.context.createGain(); state.silent.gain.value = 0;
      const collect = data => {
        if (state.finishing || recorder !== state) return;
        const remaining = Math.max(0, Math.floor(state.rate * 30) - state.frames);
        if (remaining <= 0) return;
        const chunk = data.subarray(0, remaining);
        if (chunk.length) { state.chunks.push(chunk); state.frames += chunk.length; }
        if (state.frames >= Math.floor(state.rate * 30)) finishRecording();
      };
      // Android System WebView versions differ: use AudioWorklet when available,
      // otherwise capture the same PCM samples via the older ScriptProcessor API.
      if (state.context.audioWorklet && typeof AudioWorkletNode === "function") {
        try {
          await state.context.audioWorklet.addModule("./recorder-worklet.js");
          if (recorder !== state) return;
          state.node = new AudioWorkletNode(state.context, "echo-recorder");
          state.node.port.onmessage = event => collect(event.data);
        } catch (error) {
          // The source stream remains private; fallback does not upload audio.
          console.warn("ECHO: AudioWorklet unavailable, using local PCM fallback", error.name);
        }
      }
      if (!state.node) {
        if (typeof state.context.createScriptProcessor !== "function")
          throw new Error("Эта версия Android WebView не поддерживает запись PCM. Обновите системный WebView.");
        state.node = state.context.createScriptProcessor(2048, 1, 1);
        state.node.onaudioprocess = event => {
          const input = event.inputBuffer.getChannelData(0);
          collect(new Float32Array(input));
          event.outputBuffer.getChannelData(0).fill(0);
        };
      }
      if (recorder !== state) return;
      state.source.connect(state.node).connect(state.silent).connect(state.context.destination);
      const started = Date.now(); $("echoRecordTimer").textContent = "00:00";
      voiceMessage("Запись идёт. Говорите спокойно и без фоновой музыки.");
      state.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        $("echoRecordTimer").textContent = `00:${String(seconds).padStart(2, "0")}`;
        if (seconds >= 30) finishRecording();
      }, 250);
    } catch (error) { if (recorder === state) { await finishRecording(false); voiceMessage(errorText(error)); } }
  };
  $("echoRecordStop").onclick = () => finishRecording();
  $("echoAudioImport").onchange = async () => {
    const file = $("echoAudioImport").files[0]; if (!file) return;
    const target = $("echoRecordTarget").value, text = normalized($("echoRecordText").value);
    const language = echoCurrentLanguage, epoch = audioEpoch, operation = ++recordOperation;
    discardDraft();
    if (target === "phrase" && !text) { voiceMessage("Сначала укажите текст фразы."); $("echoAudioImport").value = ""; return; }
    if (file.size > 12 * 1024 * 1024) { voiceMessage("Выберите аудиофайл размером до 12 МБ."); $("echoAudioImport").value = ""; return; }
    recordingUI(true); $("echoRecordStop").disabled = true;
    let context;
    try {
      context = new AudioContext(); const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > 30.1) throw new Error("Выберите запись продолжительностью до 30 секунд.");
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const values = decoded.getChannelData(channel);
        for (let i = 0; i < mono.length; i++) mono[i] += values[i] / decoded.numberOfChannels;
      }
      if (operation !== recordOperation) return;
      await saveAudio(mono, decoded.sampleRate, target, text, language, epoch, operation);
    } catch (error) { if (operation === recordOperation) voiceMessage(errorText(error)); }
    finally {
      try { await context?.close(); } catch (_) {}
      if (operation === recordOperation) { recordingUI(false); $("echoAudioImport").value = ""; }
    }
  };
  async function renderRecordings() {
    const entries = await db("audio", "getAll"); sample = entries.find(e => e.key === "sample") || null;
    $("echoSamplePlay").disabled = !sample; $("echoSampleDelete").disabled = !sample;
    $("echoRecordingsList").replaceChildren();
    for (const entry of entries.filter(e => e.key !== "sample")) {
      const row = document.createElement("div"); row.className = "echo-recording-row";
      const label = document.createElement("span");
      const personal = document.createElement("span"); personal.dataset.noI18n = ""; personal.textContent = `${entry.text} · ${entry.language} · `;
      const duration = document.createElement("span"); duration.textContent = `${Number(entry.duration || 0).toFixed(1)} с`;
      label.append(personal, duration);
      const preview = document.createElement("button"); preview.type = "button"; preview.textContent = "▶"; preview.setAttribute("aria-label", `Послушать: ${entry.text}`);
      preview.onclick = () => { stop(); play(entry.blob, speechJob).catch(e => voiceMessage(errorText(e))); };
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Удалить";
      remove.onclick = async () => { try { if (confirm("Удалить запись этой фразы?")) { stop(); await db("audio", "delete", entry.key); await renderRecordings(); } } catch (e) { voiceMessage(errorText(e)); } };
      row.append(label, preview, remove); $("echoRecordingsList").appendChild(row);
    }
    if (entries.length === (sample ? 1 : 0)) $("echoRecordingsList").textContent = "Записанных фраз пока нет.";
  }
  $("echoSamplePlay").onclick = () => { if (sample) { stop(); play(sample.blob, speechJob).catch(e => voiceMessage(errorText(e))); } };
  $("echoSampleDelete").onclick = async () => {
    if (!confirm("Удалить образец голоса и все созданные этим голосом фразы? Записи отдельных фраз сохранятся.")) return;
    try {
      cancelStudio(); clearStudioResult(); audioEpoch++; recordOperation++; discardDraft();
      stop(); await db("audio", "delete", "sample"); await db("cache", "clear"); sample = null;
      mode = "device"; $("echoSpeechMode").value = mode; localStorage.setItem("echoSpeechMode", mode);
      await renderRecordings(); voiceMessage("Образец и созданные фразы удалены с этого устройства.");
    } catch (error) { voiceMessage(errorText(error)); }
  };
  async function checkEngine() {
    if (window.echoNativeVoice && typeof window.echoNativeVoice.status === "function") {
      voiceMessage("Проверяю голосовую модель на телефоне…");
      try {
        const state = await window.echoNativeVoice.status();
        if (state && state.ready === true && ["android", "ios"].includes(state.platform))
          return voiceMessage("Нативная голосовая модель готова на этом устройстве. Поддерживаемые языки: " + (Array.isArray(state.languages) ? state.languages.join(", ") : "не указаны") + ".");
        return voiceMessage("Мобильная модель не установлена или не готова. Записи и голос устройства работают независимо.");
      } catch (error) { return voiceMessage("Нативный голосовой движок недоступен: " + errorText(error)); }
    }
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
      return voiceMessage("Локальный ИИ запускается на localhost на вашем компьютере. На этом сайте доступны записи и голос устройства; образец никуда не отправляется.");
    }
    voiceMessage("Проверяю локальный движок…");
    try {
      const response = await fetch("/api/voice/status", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Запустите локальный сервер ECHO по инструкции из README.");
      const status = await response.json();
      if (status.ready) voiceMessage("Локальная модель установлена. Выберите персональный голос; первый синтез загружает модель в память.");
      else voiceMessage(status.installed ? "Движок установлен, но нужны файлы модели. См. раздел «Персональный голос» в README." : "Для персонального голоса установите локальный движок и модель по README. Записи фраз уже работают без него.");
    } catch (error) { voiceMessage("Локальный ИИ недоступен. Выберите записи или голос устройства. " + errorText(error)); }
  }
  $("echoEngineCheck").onclick = checkEngine;
  renderRecordings().then(() => { if (sample) voiceMessage(`Образец сохранён · ${sample.duration.toFixed(1)} с. Данные остаются на этом устройстве.`); }).catch(e => voiceMessage(errorText(e)));

  const privacy = document.createElement("section");
  privacy.className = "echo-local-panel echo-privacy-panel";
  privacy.innerHTML = `<h3>🔒 Данные и офлайн-работа</h3>
    <p>Карточки, настройки и записи остаются в браузере на этом устройстве. Сервер обрабатывает образец в памяти и временном файле, затем удаляет файл. Удаление данных браузера удалит и записи.</p>
    <label class="echo-history-choice"><input type="checkbox" id="echoStoreHistory"> Сохранять историю сообщений на этом устройстве</label>
    <p id="echoOfflineStatus" role="status" aria-live="polite"></p>
    <button type="button" id="echoInstallApp" hidden>Установить ECHO</button>
    <p>На iPhone: «Поделиться» → «На экран Домой». Откройте приложение один раз с интернетом или работающим локальным сервером, чтобы сохранить его файлы.</p>
    <button type="button" id="echoDeleteAllAudio">Удалить все голосовые данные</button>`;
  vibrationPanel.after(privacy);
  let keepHistory = false, installPrompt = null;
  try { keepHistory = localStorage.getItem("echoStoreHistory") === "true"; } catch (_) {}
  $("echoStoreHistory").checked = keepHistory;
  const oldAddHistory = addEchoHistory;
  addEchoHistory = text => { if (keepHistory) oldAddHistory(text); };
  $("echoStoreHistory").onchange = () => {
    keepHistory = $("echoStoreHistory").checked;
    try { localStorage.setItem("echoStoreHistory", String(keepHistory)); }
    catch (_) { voiceMessage("Не удалось сохранить настройку истории."); }
  };
  $("echoDeleteAllAudio").onclick = async () => {
    if (!confirm("Удалить все записи, образец голоса и созданные фразы с этого устройства? Карточки и настройки сохранятся.")) return;
    try { cancelStudio(); clearStudioResult(); audioEpoch++; recordOperation++; discardDraft(); await finishRecording(false); stop(); await db("audio", "clear"); await db("cache", "clear"); sample = null; mode = "device";
      $("echoSpeechMode").value = mode; localStorage.setItem("echoSpeechMode", mode);
      await renderRecordings(); voiceMessage("Все голосовые данные удалены."); }
    catch (e) { voiceMessage(errorText(e)); }
  };
  function offlineStatus() {
    $("echoOfflineStatus").textContent = navigator.serviceWorker?.controller
      ? "Файлы приложения сохранены для офлайн-работы. Записи доступны без интернета; новые фразы персональным голосом требуют локального сервера и модели."
      : "Офлайн-файлы ещё не сохранены. Дождитесь первой загрузки на localhost или по HTTPS.";
  }
  navigator.serviceWorker?.addEventListener("controllerchange", offlineStatus); offlineStatus();
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; $("echoInstallApp").hidden = false; });
  $("echoInstallApp").onclick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); installPrompt = null; $("echoInstallApp").hidden = true;
  };

  // One final navigation pass avoids the conflicting listeners in earlier panels.
  let activeSection = "phrases";
  function updateNavigation(section) {
    const map = new Map([[ $("phrasesTab"), "phrases" ], [ $("favoritesTab"), "favorites" ], [ $("settingsTab"), "settings" ],
      [echoHistoryNav, "history"], [echoQuickNav, "quick"], [echoSOSNav, "sos"]]);
    for (const [button, value] of map) { button.classList.toggle("active", value === section); button.setAttribute("aria-current", value === section ? "page" : "false"); }
    document.querySelector(".add-button").classList.remove("active");
  }
  function route(section) {
    activeSection = section;
    document.body.dataset.echoSection = section;
    const voiceScreen = section === "settings" || section === "voice";
    if (!voiceScreen) cancelStudio();
    if (recorder && !voiceScreen) {
      finishRecording(false).then(() => voiceMessage("Запись отменена при выходе из настроек. Микрофон выключен."));
    }
    if (!voiceScreen) { recordOperation++; if (draft) discardDraft(); if (!recorder) recordingUI(false); }
    const settings = section === "settings", cards = section === "phrases" || section === "favorites";
    [sizePanel, themePanel, voicePanel, languagePanel, vibrationPanel].forEach(p => { p.hidden = !settings; });
    if (section === "voice") { document.querySelector("main").prepend(panel); panel.hidden = false; }
    else { voicePanel.prepend(panel); panel.hidden = false; }
    $("echoStudioBack").hidden = section !== "voice"; $("echoOpenStudio").hidden = section === "voice";
    voiceEntry.setAttribute("aria-current", section === "voice" ? "page" : "false");
    privacy.hidden = !settings;
    const dataPanel = document.getElementById("echoDataPanel"); if (dataPanel) dataPanel.hidden = !settings;
    phraseGrid.hidden = !cards; echoSearchPanel.hidden = !cards; echoCategoryPanel.hidden = !cards;
    echoHistoryPanel.hidden = section !== "history"; echoQuickPanel.hidden = section !== "quick"; echoSOSPanel.hidden = section !== "sos";
    document.querySelector(".welcome").hidden = !cards;
    document.querySelector(".custom-section").hidden = !cards;
    composer.hidden = !cards;
    document.querySelector(".echo-speech-controls") && (settings ? panel : document.querySelector(".custom-section")).append(controls);
    updateNavigation(section);
    window.scrollTo({top: 0, behavior: "instant"});
  }
  $("phrasesTab").addEventListener("click", () => route("phrases"));
  $("favoritesTab").addEventListener("click", () => route("favorites"));
  $("settingsTab").addEventListener("click", () => route("settings"));
  document.querySelector(".settings-btn").addEventListener("click", () => route("settings"));
  echoHistoryNav.addEventListener("click", () => route("history"));
  echoQuickNav.addEventListener("click", () => route("quick"));
  echoSOSNav.addEventListener("click", () => route("sos"));
  route("phrases");

  // Keyboard users can operate the existing dialog without losing their place.
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "Карточка фразы");
  new MutationObserver(() => {
    if (modal.classList.contains("open")) lastFocus = echoModalReturnFocus;
    else {
      updateNavigation(activeSection);
      const cardId = lastFocus?.closest(".custom-card")?.dataset.id;
      const target = lastFocus?.isConnected ? lastFocus : [...phraseGrid.querySelectorAll(".custom-card")]
        .find(card => card.dataset.id === cardId)?.querySelector(".edit-card");
      target?.focus();
    }
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  modal.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const items = [...modal.querySelectorAll("button, input, textarea, select, [tabindex='0']")].filter(e => !e.disabled && e.offsetParent !== null);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  // Stop microphone tracks and pending playback when the tab leaves the foreground.
  document.addEventListener("visibilitychange", () => { if (document.hidden) { stop(); if (recorder) finishRecording(false).then(() => voiceMessage("Запись отменена при выходе из приложения. Запишите заново.")); } });
  window.echoBackupQuiesce = async () => { recordOperation++; if (recorder) await finishRecording(false); discardDraft(); stop(); };
  window.addEventListener("pagehide", () => { stop(); recorder?.stream?.getTracks().forEach(t => t.stop()); });
})();
