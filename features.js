/* Local communication, voice recording and personal speech. No remote API. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const normalized = text => text.trim().replace(/\s+/g, " ");
  const phraseKey = (text, language = echoCurrentLanguage) => `phrase:${language}:${normalized(text)}`;
  let dbPromise, sample = null, recorder = null, audio = null, audioURL = null;
  let speechJob = 0, controller = null, mode = "device", lastFocus;
  let audioEpoch = 0;
  try { mode = localStorage.getItem("echoSpeechMode") || "device"; } catch (_) {}
  if (!["device", "recordings", "personal"].includes(mode)) mode = "device";

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("echo-local-voice", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("audio", { keyPath: "key" });
        request.result.createObjectStore("cache", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Не удалось открыть локальное хранилище."));
      request.onblocked = () => reject(new Error("Закройте другие вкладки ECHO и повторите."));
    });
    return dbPromise;
  }
  async function db(store, action, value) {
    const connection = await database();
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
    if (error.name === "NotAllowedError") return "Разрешите доступ к микрофону в настройках браузера.";
    if (error.name === "NotFoundError") return "Микрофон не найден. Можно загрузить аудиофайл.";
    return error.message || "Не удалось выполнить действие.";
  }
  function stop() {
    speechJob++;
    controller?.abort(); controller = null;
    if (audio) { audio.pause(); audio.src = ""; audio = null; }
    if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
    echoPiperStop();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
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
    await playing.play();
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
  async function personal(text, job) {
    if (!sample) throw new Error("Сначала запишите образец своего голоса в настройках.");
    if (!["ru", "en"].includes(echoCurrentLanguage)) throw new Error("Персональный голос доступен для русского и английского. Для этого языка выберите голос устройства.");
    const key = `${sample.id}:${echoCurrentLanguage}:${normalized(text)}`;
    const saved = await db("cache", "get", key);
    if (job !== speechJob) return;
    if (saved) { message("Персональный голос · сохранённая фраза"); return play(saved.blob, job); }
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
      throw new Error("Откройте ECHO на localhost на своём компьютере для локального ИИ. Образец не будет отправлен на сайт.");
    }
    message("Создаю фразу вашим голосом на этом устройстве… Первый запуск может занять несколько минут.");
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => { if (job === speechJob) controller?.abort(); }, 240000);
    try {
      const response = await fetch("/api/voice/synthesize", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ text, language: echoCurrentLanguage, reference: await base64(sample.blob) })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Локальный сервер недоступен. Запустите ECHO по инструкции.");
      }
      const blob = await response.blob();
      if (job !== speechJob) return;
      // Keep at most 50 generated phrases on this device.
      const cached = (await db("cache", "getAll")).sort((a, b) => a.time - b.time);
      for (const item of cached.slice(0, Math.max(0, cached.length - 49))) await db("cache", "delete", item.key);
      try { await db("cache", "put", { key, blob, time: Date.now() }); }
      catch (_) { message("Фраза готова, но для офлайн-сохранения не хватает места."); }
      await play(blob, job);
      if (job === speechJob) message("Произношу персональным голосом");
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
      message(error.name === "AbortError" ? "Время ожидания истекло. Повторите после загрузки модели." : errorText(error));
    });
    return true;
  };

  const controls = document.createElement("div");
  controls.className = "echo-speech-controls";
  controls.innerHTML = `<button type="button" id="echoStopSpeech">■ Остановить голос</button><span id="echoSpeechStatus" role="status" aria-live="polite">Готово</span>`;
  document.querySelector(".custom-section").appendChild(controls);
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
  const words = {
    ru: ["Я", "хочу", "мне нужно", "пить", "есть", "домой", "отдохнуть", "помощь", "пожалуйста", "спасибо", "да", "нет"],
    en: ["I", "want", "I need", "water", "food", "to go home", "to rest", "help", "please", "thank you", "yes", "no"],
    kk: ["Мен", "маған", "керек", "су", "тамақ", "үйге", "демалу", "көмек", "өтінемін", "рақмет", "иә", "жоқ"],
    be: ["Я", "хачу", "мне трэба", "піць", "есці", "дадому", "адпачыць", "дапамога", "калі ласка", "дзякуй", "так", "не"]
  };
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
  applyEchoLanguage = language => { oldLanguage(language); renderWords(); updateTargets(); };
  renderWords();
  const oldFavorites = updateFavorites;
  updateFavorites = (...args) => { oldFavorites(...args); updateEchoCategories(); };

  const panel = document.createElement("section");
  panel.id = "echoLocalVoicePanel"; panel.className = "echo-local-panel";
  panel.innerHTML = `<h3>🎙️ Мой голос и записи близких</h3>
    <p>Записи хранятся в этом браузере. Персональный голос создаёт новые фразы по вашему образцу на локальном компьютере — аудио не отправляется в облако.</p>
    <label for="echoSpeechMode">Как произносить сообщения</label><select id="echoSpeechMode"><option value="device">Голос устройства / Piper</option><option value="recordings">Записи фраз · иначе голос устройства</option><option value="personal">Мой персональный голос · локальный ИИ</option></select>
    <label for="echoRecordTarget">Что записать</label><select id="echoRecordTarget"><option value="sample">Образец моего голоса · 6–30 секунд</option><option value="phrase">Озвучку одной фразы · до 30 секунд</option></select>
    <div id="echoPhraseRecordingFields" hidden><label for="echoRecordText">Текст записываемой фразы</label><input id="echoRecordText" list="echoRecordPhrases" maxlength="300" placeholder="Я хочу пить"><datalist id="echoRecordPhrases"></datalist></div>
    <p id="echoRecordHint">Спокойно прочитайте: «Привет! Это мой голос. Я хочу свободно общаться, говорить о своих желаниях, просить о помощи и благодарить близких. Сегодня хороший день».</p>
    <div class="echo-local-actions"><button type="button" id="echoRecordStart">● Записать голос</button><button type="button" id="echoRecordStop" disabled>■ Завершить</button><button type="button" id="echoSamplePlay" disabled>▶ Мой образец</button></div>
    <label for="echoAudioImport">Или загрузите запись с этого устройства</label><input id="echoAudioImport" type="file" accept="audio/*">
    <span id="echoRecordTimer" role="timer">00:00</span><p id="echoLocalVoiceStatus" role="status" aria-live="polite">Образец голоса пока не записан.</p>
    <div class="echo-local-actions"><button type="button" id="echoEngineCheck">Проверить локальный ИИ</button><button type="button" id="echoSampleDelete">Удалить образец и созданные фразы</button></div>
    <p class="echo-local-note">Образец позволяет приблизить тембр, но сходство не гарантируется. Создание новой фразы требует локальной модели; уже созданные фразы и записи работают офлайн. Русский и английский поддерживаются; казахский и белорусский используют голос устройства.</p>
    <h4>Записанные фразы</h4><div id="echoRecordingsList"></div>`;
  voicePanel.prepend(panel);
  $("echoSpeechMode").value = mode;
  $("echoSpeechMode").onchange = () => {
    stop(); mode = $("echoSpeechMode").value;
    try { localStorage.setItem("echoSpeechMode", mode); } catch (_) { voiceMessage("Режим не сохранён: хранилище браузера недоступно."); }
    if (mode === "personal") checkEngine();
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
  }
  async function saveAudio(samples, rate, target, text, language, epoch) {
    const duration = samples.length / rate;
    if (duration < (target === "sample" ? 6 : 0.3) || duration > 30.1) throw new Error(target === "sample" ? "Запишите от 6 до 30 секунд речи." : "Запись должна длиться от 0,3 до 30 секунд.");
    const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    if (rms < 0.002) throw new Error("Запись слишком тихая. Поднесите микрофон ближе и повторите.");
    const blob = encodeWav(samples, rate);
    const entry = { key: target === "sample" ? "sample" : phraseKey(text, language), blob, duration,
      text, language, id: await hash(blob), time: Date.now() };
    if (epoch !== audioEpoch) throw new Error("Сохранение отменено: голосовые данные были удалены.");
    await db("audio", "put", entry);
    if (target === "sample") { sample = entry; await db("cache", "clear"); }
    voiceMessage(target === "sample" ? "Образец сохранён на этом устройстве. Выберите персональный голос и проверьте локальный ИИ." : "Запись фразы сохранена. Выберите режим «Записи фраз» для воспроизведения.");
    await renderRecordings();
    navigator.storage?.persist?.().catch(() => {});
  }
  async function finishRecording(save = true) {
    const state = recorder; if (!state || state.finishing) return;
    state.finishing = true; recorder = null;
    clearInterval(state.timer);
    state.source?.disconnect(); state.node?.disconnect(); state.silent?.disconnect();
    state.stream?.getTracks().forEach(t => t.stop());
    await state.context?.close();
    recordingUI(false);
    if (!save) return;
    try {
      const count = state.chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(Math.min(count, Math.floor(state.rate * 30)));
      let offset = 0;
      for (const chunk of state.chunks) { const part = chunk.subarray(0, merged.length - offset); merged.set(part, offset); offset += part.length; }
      await saveAudio(merged, state.rate, state.target, state.text, state.language, state.epoch);
    } catch (error) { voiceMessage(errorText(error)); }
  }
  $("echoRecordStart").onclick = async () => {
    const target = $("echoRecordTarget").value, text = normalized($("echoRecordText").value);
    if (target === "phrase" && !text) { voiceMessage("Сначала введите текст записываемой фразы."); return $("echoRecordText").focus(); }
    if (!navigator.mediaDevices?.getUserMedia) return voiceMessage("Запись доступна в приложении на localhost или по HTTPS. Можно загрузить аудиофайл.");
    stop(); recordingUI(true);
    const state = { target, text, chunks: [], finishing: false, language: echoCurrentLanguage, epoch: audioEpoch }; recorder = state;
    voiceMessage("Ожидаю разрешение на микрофон…");
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (recorder !== state) { state.stream.getTracks().forEach(t => t.stop()); return; }
      state.context = new AudioContext();
      await state.context.audioWorklet.addModule("./recorder-worklet.js");
      await state.context.resume();
      state.rate = state.context.sampleRate;
      state.source = state.context.createMediaStreamSource(state.stream);
      state.node = new AudioWorkletNode(state.context, "echo-recorder");
      state.silent = state.context.createGain(); state.silent.gain.value = 0;
      state.node.port.onmessage = event => { if (!state.finishing) state.chunks.push(event.data); };
      state.source.connect(state.node).connect(state.silent).connect(state.context.destination);
      const started = Date.now(); $("echoRecordTimer").textContent = "00:00";
      voiceMessage("Запись идёт. Говорите спокойно и без фоновой музыки.");
      state.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        $("echoRecordTimer").textContent = `00:${String(seconds).padStart(2, "0")}`;
        if (seconds >= 30) finishRecording();
      }, 250);
    } catch (error) { await finishRecording(false); voiceMessage(errorText(error)); }
  };
  $("echoRecordStop").onclick = () => finishRecording();
  $("echoAudioImport").onchange = async () => {
    const file = $("echoAudioImport").files[0]; if (!file) return;
    const target = $("echoRecordTarget").value, text = normalized($("echoRecordText").value);
    const language = echoCurrentLanguage, epoch = audioEpoch;
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
      await saveAudio(mono, decoded.sampleRate, target, text, language, epoch);
    } catch (error) { voiceMessage(errorText(error)); }
    finally { await context?.close(); recordingUI(false); $("echoAudioImport").value = ""; }
  };
  async function renderRecordings() {
    const entries = await db("audio", "getAll"); sample = entries.find(e => e.key === "sample") || null;
    $("echoSamplePlay").disabled = !sample; $("echoSampleDelete").disabled = !sample;
    $("echoRecordingsList").replaceChildren();
    for (const entry of entries.filter(e => e.key !== "sample")) {
      const row = document.createElement("div"); row.className = "echo-recording-row";
      const label = document.createElement("span"); label.textContent = `${entry.text} · ${entry.language} · ${entry.duration.toFixed(1)} с`;
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
      audioEpoch++;
      stop(); await db("audio", "delete", "sample"); await db("cache", "clear"); sample = null;
      mode = "device"; $("echoSpeechMode").value = mode; localStorage.setItem("echoSpeechMode", mode);
      await renderRecordings(); voiceMessage("Образец и созданные фразы удалены с этого устройства.");
    } catch (error) { voiceMessage(errorText(error)); }
  };
  async function checkEngine() {
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
    } catch (error) { voiceMessage(errorText(error)); }
  }
  $("echoEngineCheck").onclick = checkEngine;
  renderRecordings().then(() => { if (sample) voiceMessage(`Образец сохранён · ${sample.duration.toFixed(1)} с. Данные остаются на этом устройстве.`); }).catch(e => voiceMessage(errorText(e)));

  const privacy = document.createElement("section");
  privacy.className = "echo-local-panel";
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
    try { audioEpoch++; await finishRecording(false); stop(); await db("audio", "clear"); await db("cache", "clear"); sample = null; mode = "device";
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
  function route(section) {
    if (recorder && section !== "settings") {
      finishRecording(false).then(() => voiceMessage("Запись отменена при выходе из настроек. Микрофон выключен."));
    }
    const settings = section === "settings", cards = section === "phrases" || section === "favorites";
    [sizePanel, themePanel, voicePanel, languagePanel, vibrationPanel].forEach(p => { p.hidden = !settings; });
    privacy.hidden = !settings;
    phraseGrid.hidden = !cards; echoSearchPanel.hidden = !cards; echoCategoryPanel.hidden = !cards;
    echoHistoryPanel.hidden = section !== "history"; echoQuickPanel.hidden = section !== "quick"; echoSOSPanel.hidden = section !== "sos";
    document.querySelector(".welcome").hidden = !cards;
    document.querySelector(".custom-section").hidden = !cards;
    composer.hidden = !cards;
    const map = new Map([[ $("phrasesTab"), "phrases" ], [ $("favoritesTab"), "favorites" ], [ $("settingsTab"), "settings" ],
      [echoHistoryNav, "history"], [echoQuickNav, "quick"], [echoSOSNav, "sos"]]);
    for (const [button, value] of map) { button.classList.toggle("active", value === section); button.setAttribute("aria-current", value === section ? "page" : "false"); }
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
    if (modal.classList.contains("open")) lastFocus = document.activeElement;
    else lastFocus?.focus();
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
  window.addEventListener("pagehide", () => { stop(); recorder?.stream?.getTracks().forEach(t => t.stop()); });
})();
