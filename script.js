
// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 1
// ==========================================

// ==========================================
// 1. НАСТРОЙКИ ECHO
// ==========================================

const defaultEchoSettings = {
  language: "ru-RU",
  rate: 0.9,
  pitch: 1,
  volume: 1,
  voiceName: ""
};

let echoSettings = { ...defaultEchoSettings };

try {
  const savedSettings = localStorage.getItem("echoSettings");

  if (savedSettings) {
    const parsed = JSON.parse(savedSettings);

    if (parsed && typeof parsed === "object") {
      echoSettings = {
        ...defaultEchoSettings,
        ...parsed
      };
    }
  }
} catch (error) {
  console.warn("ECHO: ошибка загрузки настроек", error);
}

function saveSettings() {
  try {
    localStorage.setItem(
      "echoSettings",
      JSON.stringify(echoSettings)
    );
    return true;
  } catch (error) {
    console.warn("ECHO: настройки не сохранены", error);
    window.echoSpeechNotice?.("Настройки голоса не сохранены: проверьте свободное место.");
    return false;
  }
}

// Ignore damaged numeric settings instead of breaking speech controls.
for (const [key, min, max] of [["rate", 0.5, 2], ["pitch", 0.5, 2], ["volume", 0, 1]]) {
  const value = Number(echoSettings[key]);
  echoSettings[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaultEchoSettings[key];
}

// ==========================================
// 2. ЯЗЫКИ
// ==========================================

const echoLanguages = {
  ru: {
    label: "Русский",
    speech: "ru-RU"
  },
  kk: {
    label: "Қазақша",
    speech: "kk-KZ"
  },
  en: {
    label: "English",
    speech: "en-US"
  },
  be: { label: "Беларуская", speech: "be-BY" }
};

const echoLanguageKey = "echoLanguage";

let echoCurrentLanguage = "ru";

try {
  const savedLanguage = localStorage.getItem(echoLanguageKey);

  if (echoLanguages[savedLanguage]) {
    echoCurrentLanguage = savedLanguage;
  } else {
    const code = String(echoSettings.language || "ru")
      .slice(0, 2)
      .toLowerCase();

    if (echoLanguages[code]) {
      echoCurrentLanguage = code;
    }
  }
} catch (error) {
  console.warn("ECHO: язык не загружен", error);
}

echoSettings.language =
  echoLanguages[echoCurrentLanguage].speech;
if (!echoSettings.voiceNames || typeof echoSettings.voiceNames !== "object" || Array.isArray(echoSettings.voiceNames)) echoSettings.voiceNames = {};
if (!Object.hasOwn(echoSettings.voiceNames, echoCurrentLanguage)) echoSettings.voiceNames[echoCurrentLanguage] = String(echoSettings.voiceName || "");


// ==========================================
// 3. ЗАГРУЗКА ГОЛОСОВ
// ==========================================

// Browser voices remain local: no text is sent to a remote speech provider.
let currentVoice = null;
let echoBrowserJob = 0, echoBrowserUtterance = null, echoBrowserTimer = null;
function echoDeviceVoices() {
  if (!("speechSynthesis" in window)) return [];
  const code = String(echoSettings.language || "ru-RU").toLowerCase().split("-")[0];
  return speechSynthesis.getVoices().filter(voice => voice.localService &&
    String(voice.lang).toLowerCase().split("-")[0] === code);
}
function loadVoices() {
  const voices = echoDeviceVoices();
  currentVoice = voices.find(voice => voice.name === echoSettings.voiceName) ||
    voices.find(voice => voice.lang.toLowerCase() === echoSettings.language.toLowerCase()) || voices[0] || null;
}
function echoBrowserStop() {
  ++echoBrowserJob;
  clearTimeout(echoBrowserTimer); echoBrowserTimer = null;
  if (echoBrowserUtterance) {
    echoBrowserUtterance.onstart = echoBrowserUtterance.onend = echoBrowserUtterance.onerror = null;
    echoBrowserUtterance = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
loadVoices();
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", loadVoices);
function applyVoiceSettings(message) {
  message.lang = echoSettings.language;
  message.rate = Number(echoSettings.rate ?? 0.9);
  message.pitch = Number(echoSettings.pitch ?? 1);
  message.volume = Number(echoSettings.volume ?? 1);
  loadVoices();
  if (currentVoice) message.voice = currentVoice;
}

// ==========================================
// 5. ПРОИЗНЕСЕНИЕ ТЕКСТА
// ==========================================

// Piper TTS: neural voices via optional local bridge. Browser voice remains fallback.
const echoPiperConfigKey = "echoPiperConfig";
let echoPiperConfig = { enabled: false, url: "http://127.0.0.1:8765", voice: "" };
try { Object.assign(echoPiperConfig, JSON.parse(localStorage.getItem(echoPiperConfigKey) || "{}")); } catch (_) {}
let echoPiperAudio = null, echoPiperURLObject = null;
let echoPiperController = null;
let echoPiperRequest = 0;
function echoPiperSave() {
  try { localStorage.setItem(echoPiperConfigKey, JSON.stringify(echoPiperConfig)); return true; }
  catch (_) { window.echoSpeechNotice?.("Не удалось сохранить настройки Piper."); return false; }
}
function echoPiperURL() {
  const url = new URL(echoPiperConfig.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Piper должен работать на этом устройстве: localhost или 127.0.0.1");
  }
  return url.origin;
}
function echoPiperStop() {
  ++echoPiperRequest;
  echoPiperController?.abort(); echoPiperController = null;
  if (echoPiperAudio) { echoPiperAudio.pause(); echoPiperAudio.src = ""; echoPiperAudio = null; }
  if (echoPiperURLObject) { URL.revokeObjectURL(echoPiperURLObject); echoPiperURLObject = null; }
}
async function echoPiperSpeak(text) {
  echoPiperStop();
  const requestId = echoPiperRequest, controller = new AbortController();
  echoPiperController = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  let prepared = null;
  window.echoSpeechNotice?.("Ожидаю локальный Piper…");
  try {
    const response = await fetch(echoPiperURL() + "/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: echoPiperConfig.voice, language: echoCurrentLanguage }), signal: controller.signal
    });
    if (!response.ok) throw new Error("Piper HTTP " + response.status);
    if (!response.headers.get("Content-Type")?.startsWith("audio/")) throw new Error("Piper вернул не аудиозапись");
    const blob = await response.blob();
    if (requestId !== echoPiperRequest) return;
    prepared = blob;
    echoPiperURLObject = URL.createObjectURL(blob);
    const audio = new Audio(echoPiperURLObject); echoPiperAudio = audio;
    audio.volume = Number(echoSettings.volume ?? 1);
    audio.playbackRate = Number(echoSettings.rate ?? 1);
    const complete = message => {
      if (requestId !== echoPiperRequest) return;
      echoPiperStop(); window.echoSpeechNotice?.(message);
    };
    audio.onended = () => complete("Готово");
    audio.onerror = () => complete("Не удалось воспроизвести Piper. Выберите голос устройства или запись.");
    await audio.play();
    if (requestId === echoPiperRequest) window.echoSpeechNotice?.("Произношу · Piper");
  } catch (error) {
    if (requestId === echoPiperRequest) {
      echoPiperStop();
      if (error.name === "NotAllowedError" && prepared) window.echoOfferPreparedAudio?.(prepared);
      window.echoSpeechNotice?.(error.name === "NotAllowedError"
        ? "Браузер заблокировал звук. Нажмите карточку ещё раз или выберите голос устройства."
        : "Piper недоступен или время ожидания истекло. Выберите голос устройства или сохранённые записи.");
      window.echoOfferVoiceFallback?.();
    }
  } finally { clearTimeout(timeout); }
}
function speak(text) {
  if (typeof text !== "string" || !text.trim()) return;
  window.echoStopSpeech?.();
  if (window.echoLocalSpeech?.(text.trim())) return;
  echoPiperStop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (echoPiperConfig.enabled && echoPiperConfig.voice) {
    echoPiperSpeak(text.trim());
  } else {
    echoBrowserSpeak(text.trim());
  }
}
function echoBrowserSpeak(text) {
  if (typeof text !== "string" || !text.trim()) return;
  echoBrowserStop();
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    window.echoSpeechNotice?.("На этом устройстве системная озвучка недоступна. Выберите сохранённые записи.");
    window.echoOfferVoiceFallback?.(); return;
  }
  const message = new SpeechSynthesisUtterance(text.trim());
  applyVoiceSettings(message);
  if (!currentVoice) {
    window.echoSpeechNotice?.("Нет локального голоса этого языка. Дождитесь загрузки голосов и нажмите снова либо выберите сохранённую запись.");
    window.echoOfferVoiceFallback?.(); return;
  }
  const job = echoBrowserJob;
  echoBrowserUtterance = message; // Retain until completion (also required by some mobile engines).
  const finish = status => {
    if (job !== echoBrowserJob) return;
    clearTimeout(echoBrowserTimer); echoBrowserTimer = null; echoBrowserUtterance = null;
    ++echoBrowserJob; message.onstart = message.onend = message.onerror = null;
    window.echoSpeechNotice?.(status);
  };
  const watchdog = () => {
    if (job !== echoBrowserJob) return;
    echoBrowserStop(); window.echoSpeechNotice?.("Голос не ответил. Нажмите фразу ещё раз или выберите сохранённую запись.");
    window.echoOfferVoiceFallback?.();
  };
  message.onstart = () => {
    if (job !== echoBrowserJob) return;
    clearTimeout(echoBrowserTimer);
    echoBrowserTimer = setTimeout(watchdog, 120000);
    window.echoSpeechNotice?.("Произношу · голос устройства");
  };
  message.onend = () => finish("Готово");
  message.onerror = event => {
    if (job !== echoBrowserJob) return;
    const status = event.error === "not-allowed" ? "Браузер заблокировал звук. Нажмите карточку ещё раз."
      : event.error === "canceled" || event.error === "interrupted" ? "Озвучка остановлена"
      : "Не удалось произнести фразу голосом устройства. Выберите другой голос или сохранённую запись.";
    finish(status); window.echoOfferVoiceFallback?.();
  };
  window.echoSpeechNotice?.("Запускаю голос устройства…");
  echoBrowserTimer = setTimeout(watchdog, 15000);
  try { speechSynthesis.speak(message); }
  catch (_) { finish("Не удалось запустить голос. Нажмите фразу ещё раз или выберите запись."); window.echoOfferVoiceFallback?.(); }
}

// ==========================================
// 6. ОЗВУЧИВАНИЕ КАРТОЧЕК
// ==========================================

function speakPhrase(button) {
  if (!button) return;

  const text = button.dataset.text;

  if (!text) return;

  button.classList.add("speaking");

  setTimeout(() => {
    button.classList.remove("speaking");
  }, 400);

  speak(text);
}

// ==========================================
// 7. СВОЯ ФРАЗА
// ==========================================

function speakCustomPhrase() {
  const input = document.getElementById("customPhrase");

  if (!input) return;

  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  speak(text);
}

// Enter запускает озвучивание
const customInput = document.getElementById("customPhrase");

if (customInput) {
  customInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      speakCustomPhrase();
    }
  });
}

// ==========================================
// 8. НАВИГАЦИЯ
// ==========================================

const navButtons = document.querySelectorAll(".nav-item");

navButtons.forEach(button => {
  button.addEventListener("click", function () {
    navButtons.forEach(item => {
      item.classList.remove("active");
    });

    this.classList.add("active");
  });
});

// ==========================================
// 9. ПРОВЕРКА ХРАНИЛИЩА
// ==========================================

function checkStorage() {
  try {
    const testKey = "__echo_test__";

    localStorage.setItem(testKey, "ok");
    localStorage.removeItem(testKey);

    return true;
  } catch (error) {
    console.warn("ECHO: localStorage недоступен");
    return false;
  }
}

checkStorage();

// ==========================================
// КОНЕЦ ЧАСТИ 1
// ==========================================


// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 2: СВОИ КАРТОЧКИ
// ==========================================

// ЭЛЕМЕНТЫ ОКНА

const addButton = document.querySelector(".add-button");
const modal = document.getElementById("addPhraseModal");
const closeModalButton = document.getElementById("closeModal");
const savePhraseButton = document.getElementById("savePhrase");
const nameInput = document.getElementById("newPhraseName");
const phraseInput = document.getElementById("newPhraseText");
const phraseGrid = document.querySelector(".phrase-grid");
const emojiButtons = document.querySelectorAll(".emoji-option");

let editingPhraseId = null;
let selectedEmoji = "💧";
let pendingDelete = null;
let echoImageId = null, echoImageBlob = null, echoImageURL = null, echoImageEpoch = 0;
let echoImageDB;
let echoCardSaving = false;
let echoModalReturnFocus = null;

// ==========================================
// СОХРАНЕНИЕ И ЗАГРУЗКА
// ==========================================

function getCustomPhrases() {
  try {
    return echoReadCardsStrict();
  } catch (error) {
    queueMicrotask(() => { const status = document.getElementById("echoCardStatus"); if (status) status.textContent = "Не удалось прочитать сохранённые карточки. Данные не изменены."; });
    console.warn("ECHO: ошибка загрузки карточек", error);
    return [];
  }
}

function saveCustomPhrases(phrases) {
  try {
    echoReadCardsStrict();
    localStorage.setItem(
      "echoCustomPhrases",
      JSON.stringify(phrases)
    );
    return true;
  } catch (error) {
    console.warn("ECHO: ошибка сохранения карточек", error);
    return false;
  }
}

// Surface save errors in the editor, rather than hiding them in the console.
const echoSaveError = document.createElement("p");
echoSaveError.id = "echoSaveError";
echoSaveError.setAttribute("role", "alert");
echoSaveError.hidden = true;
savePhraseButton?.before(echoSaveError);

function echoShowSaveError(message) {
  echoSaveError.textContent = message || "Не удалось сохранить карточку. Проверьте свободное место и настройки браузера. Окно осталось открытым, чтобы вы не потеряли текст.";
  echoSaveError.hidden = false;
}
function echoClearSaveError() {
  echoSaveError.hidden = true;
  echoSaveError.textContent = "";
}

// Защита текста при вставке в HTML

function escapeHTML(text) {
  const element = document.createElement("div");
  element.textContent = String(text ?? "");
  return element.innerHTML;
}

// ==========================================
// ВЫБОР ЭМОДЗИ
// ==========================================

function selectEmoji(emoji) {
  selectedEmoji = emoji;

  emojiButtons.forEach(button => {
    button.classList.toggle(
      "selected",
      button.textContent.trim() === emoji
    );
  });
}

emojiButtons.forEach(button => {
  button.addEventListener("click", () => {
    selectEmoji(button.textContent.trim());
  });
});

// ==========================================
// ОЧИСТКА ФОРМЫ
// ==========================================

function resetAddForm() {
  echoResetImage();
  echoClearSaveError();
  if (nameInput) nameInput.value = "";
  if (phraseInput) phraseInput.value = "";

  selectEmoji("💧");

  if (
    ![...emojiButtons].some(
      button => button.classList.contains("selected")
    ) &&
    emojiButtons[0]
  ) {
    emojiButtons[0].classList.add("selected");
    selectedEmoji = emojiButtons[0].textContent.trim();
  }
}

// ==========================================
// ОТКРЫТИЕ И ЗАКРЫТИЕ ОКНА
// ==========================================

function openAddModal() {
  if (!modal || savePhraseButton.disabled) return;

  echoModalReturnFocus = document.activeElement;
  editingPhraseId = null;
  resetAddForm();

  if (savePhraseButton) {
    savePhraseButton.textContent = "Добавить карточку";
  }

  modal.classList.add("open");

  nameInput?.focus();
}

function closeAddModal() {
  if (savePhraseButton.disabled) return;
  modal?.classList.remove("open");
}

addButton?.addEventListener("click", openAddModal);

closeModalButton?.addEventListener(
  "click",
  closeAddModal
);

modal?.addEventListener("click", event => {
  if (event.target === modal) {
    closeAddModal();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeAddModal();
  }
});

// ==========================================
// СОЗДАНИЕ КАРТОЧКИ НА ЭКРАНЕ
// ==========================================

function createPhraseCard(phrase) {
  if (!phraseGrid) return;

  const button = document.createElement("div");
  button.className = "phrase-card custom-card";
  button.dataset.text = phrase.text;
  button.dataset.id = String(phrase.id);

  button.innerHTML = `
    <button type="button" class="card-speak">
    <span class="phrase-icon">
      ${escapeHTML(phrase.emoji)}
    </span>

    <span class="phrase-name">
      ${escapeHTML(phrase.name)}
    </span>

    <span class="phrase-text">
      ${escapeHTML(phrase.text)}
    </span>

    <span class="sound-icon">🔊</span></button>

    <span
      class="edit-card"
      role="button"
      tabindex="0"
      title="Редактировать"
      aria-label="Редактировать карточку"
    >✎</span>

    <span
      class="delete-card"
      role="button"
      tabindex="0"
      title="Удалить"
      aria-label="Удалить карточку"
    >×</span>
  `;

  button.querySelector(".card-speak").setAttribute("aria-label", phrase.text);

  // Озвучивание карточки

  button.addEventListener("click", event => {
    if (
      event.target.closest(
        ".edit-card, .delete-card, .favorite-star"
      )
    ) {
      return;
    }

    speakPhrase(button);
  });

  // Редактирование

  const editButton = button.querySelector(".edit-card");

  editButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openEditPhrase(phrase);
  });

  // Удаление

  const deleteButton = button.querySelector(".delete-card");

  deleteButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    requestDeletePhrase(phrase, button);
  });

  // Поддержка клавиатуры

  [editButton, deleteButton].forEach(control => {
    control.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        control.click();
      }
    });
  });

  echoEnhanceCard(button, phrase);
  phraseGrid.appendChild(button);

  return button;
}

// ==========================================
// РЕДАКТИРОВАНИЕ
// ==========================================

function openEditPhrase(phrase) {
  if (!modal || savePhraseButton.disabled) return;

  echoModalReturnFocus = document.activeElement;
  echoResetImage(phrase.imageId);
  echoClearSaveError();
  editingPhraseId = phrase.id;

  if (nameInput) nameInput.value = phrase.name;
  if (phraseInput) phraseInput.value = phrase.text;

  selectEmoji(phrase.emoji);

  if (savePhraseButton) {
    savePhraseButton.textContent = "Сохранить изменения";
  }

  modal.classList.add("open");

  nameInput?.focus();
}

// ==========================================
// ОБНОВЛЕНИЕ КАРТОЧЕК
// ==========================================

function loadCustomPhrases() {
  const phrases = getCustomPhrases();

  phrases.forEach(phrase => {
    if (String(pendingDelete?.phrase.id) !== String(phrase.id)) createPhraseCard(phrase);
  });
}

function refreshCustomCards() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".custom-card")
    .forEach(card => card.remove());

  loadCustomPhrases();

  // Обновление избранного из следующей части
  if (typeof addFavoriteStars === "function") {
    addFavoriteStars();
  }
}

// Загружаем сохранённые карточки

echoInitImages();
loadCustomPhrases();

// ==========================================
// ДОБАВЛЕНИЕ И СОХРАНЕНИЕ ИЗМЕНЕНИЙ
// ==========================================

savePhraseButton?.addEventListener("click", async () => {
  if (!nameInput || !phraseInput) return;
  echoClearSaveError();

  const name = nameInput.value.trim();
  const text = phraseInput.value.trim();

  if (!name) {
    nameInput.focus();
    return;
  }

  if (!text) {
    phraseInput.focus();
    return;
  }

  if (savePhraseButton.disabled) return;
  if (pendingDelete) finishDelete();
  let phrases;
  try { phrases = echoReadCardsStrict(); } catch (error) { echoShowSaveError(); return; }
  const previous = phrases.find(p => String(p.id) === String(editingPhraseId));
  if (editingPhraseId !== null && !previous) { echoShowSaveError(); return; }
  let imageId = echoImageId;
  echoCardSaving = true;
  savePhraseButton.disabled = true;
  try {
    if (echoImageBlob) {
      imageId = crypto.randomUUID();
      await echoImageStore("put", {id: imageId, blob: echoImageBlob});
    }
  } catch (error) {
    echoCardSaving = false;
    savePhraseButton.disabled = false;
    echoShowSaveError(); return;
  }
  echoCardSaving = false;
  savePhraseButton.disabled = false;
  const rollbackImage = () => { if (imageId && imageId !== echoImageId) echoImageStore("delete", imageId).catch(() => {}); };
  // IndexedDB yields to other tabs. Re-read metadata before committing to avoid
  // overwriting cards created or edited while the image was being written.
  try {
    phrases = echoReadCardsStrict();
    if (editingPhraseId !== null && JSON.stringify(phrases.find(p => String(p.id) === String(editingPhraseId))) !== JSON.stringify(previous)) {
      throw new Error("Карточка изменена в другой вкладке. Закройте окно и откройте карточку заново; введённый текст сохранён в форме.");
    }
  } catch (error) { rollbackImage(); echoShowSaveError(error.message); return; }


  if (editingPhraseId !== null) {
    const index = phrases.findIndex(
      phrase =>
        String(phrase.id) === String(editingPhraseId)
    );

    if (index !== -1) {
      phrases[index] = {
        ...phrases[index],
        emoji: selectedEmoji,
        imageId,
        name,
        text
      };

      if (!saveCustomPhrases(phrases)) {
        rollbackImage(); echoShowSaveError();
        return;
      }
      refreshCustomCards();
    }
  } else {
    const newPhrase = {
      id:
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : String(Date.now()) + "-" +
            Math.random().toString(36).slice(2),
      emoji: selectedEmoji,
      imageId,
      name,
      text
    };

    phrases.push(newPhrase);
    if (!saveCustomPhrases(phrases)) {
      rollbackImage(); echoShowSaveError();
      return;
    }
    createPhraseCard(newPhrase);
  }

  if (previous?.imageId && previous.imageId !== imageId) echoImageStore("delete", previous.imageId).catch(() => {});
  editingPhraseId = null;

  if (savePhraseButton) {
    savePhraseButton.textContent = "Добавить карточку";
  }

  resetAddForm();
  closeAddModal();
});

// ==========================================
// УДАЛЕНИЕ С ОТМЕНОЙ — 5 СЕКУНД
// ==========================================

function requestDeletePhrase(phrase, card) {
  if (!card || !phraseGrid) return;

  // Завершаем предыдущее удаление
  if (pendingDelete) {
    finishDelete();
  }

  const nextCard = card.nextElementSibling;

  card.remove();

  const undoBox = document.createElement("div");
  undoBox.className = "delete-undo";

  undoBox.innerHTML = `
    <span class="delete-message">
      Карточка удалена
    </span>

    <button
      type="button"
      class="undo-delete"
    >
      Отменить
    </button>

    <span class="delete-countdown">5</span>
  `;

  document.body.appendChild(undoBox);

  pendingDelete = {
    phrase,
    card,
    nextCard,
    undoBox,
    seconds: 5,
    interval: null,
    timeout: null
  };

  const deletion = pendingDelete;

  const countdown = undoBox.querySelector(
    ".delete-countdown"
  );

  const undoButton = undoBox.querySelector(
    ".undo-delete"
  );

  deletion.interval = setInterval(() => {
    if (pendingDelete !== deletion) return;

    deletion.seconds--;

    if (countdown && deletion.seconds > 0) {
      countdown.textContent = deletion.seconds;
    }
  }, 1000);

  deletion.timeout = setTimeout(() => {
    if (pendingDelete === deletion) {
      finishDelete();
    }
  }, 5000);

  undoButton?.addEventListener("click", undoDelete);
}

// ==========================================
// ОТМЕНА УДАЛЕНИЯ
// ==========================================

function undoDelete() {
  if (!pendingDelete) return;

  const deletion = pendingDelete;

  clearInterval(deletion.interval);
  clearTimeout(deletion.timeout);

  if (
    deletion.nextCard &&
    deletion.nextCard.parentNode === phraseGrid
  ) {
    phraseGrid.insertBefore(
      deletion.card,
      deletion.nextCard
    );
  } else {
    phraseGrid?.appendChild(deletion.card);
  }

  deletion.undoBox.remove();
  pendingDelete = null;
}

// ==========================================
// ОКОНЧАТЕЛЬНОЕ УДАЛЕНИЕ
// ==========================================

function finishDelete() {
  if (!pendingDelete) return;

  const deletion = pendingDelete;

  clearInterval(deletion.interval);
  clearTimeout(deletion.timeout);

  const id = String(deletion.phrase.id);

  const phrases = getCustomPhrases().filter(
    phrase => String(phrase.id) !== id
  );

  if (!saveCustomPhrases(phrases)) {
    // Restore the card instead of silently losing an unsaved deletion.
    if (deletion.nextCard?.parentNode === phraseGrid) {
      phraseGrid.insertBefore(deletion.card, deletion.nextCard);
    } else {
      phraseGrid?.appendChild(deletion.card);
    }
    alert("Не удалось сохранить удаление карточки. Карточка восстановлена.");
  } else if (deletion.phrase.imageId) {
    echoImageStore("delete", deletion.phrase.imageId).catch(() => {});
  }

  deletion.undoBox.remove();
  pendingDelete = null;
}

// ==========================================
// КОНЕЦ ЧАСТИ 2
// ==========================================


// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 3: ИЗБРАННОЕ И РАЗМЕР КАРТОЧЕК
// ==========================================

// ==========================================
// 1. ИЗБРАННОЕ
// ==========================================

const favoritesKey = "echoFavorites";
let favorites = [];

try {
  const saved = JSON.parse(
    localStorage.getItem(favoritesKey) || "[]"
  );

  if (Array.isArray(saved)) {
    favorites = saved.map(String);
  }
} catch (error) {
  console.warn("ECHO: ошибка загрузки избранного");
}

let favoritesMode = false;

// Стабильный ID для стандартных карточек.
// Он не меняется при переводе текста.

document.querySelectorAll("button.phrase-card").forEach(speech => {
  const group = document.createElement("div");
  group.className = speech.className;
  Object.assign(group.dataset, speech.dataset);
  speech.replaceWith(group);
  speech.className = "card-speak";
  speech.removeAttribute("onclick");
  speech.setAttribute("aria-label", group.dataset.text);
  speech.onclick = () => speakPhrase(group);
  group.append(speech);
  group.onclick = event => { if (event.target === group) speakPhrase(group); };
});

const defaultFavoriteCards = [
  ...document.querySelectorAll(
    ".phrase-card:not(.custom-card)"
  )
];

defaultFavoriteCards.forEach((card, index) => {
  if (!card.dataset.favoriteId) {
    card.dataset.favoriteId = String(index);
  }
});

// Перенос старых избранных карточек
// с текстовых ID на постоянные.

let favoritesMigrated = false;

defaultFavoriteCards.forEach(card => {
  const oldId = "default:" + (card.dataset.text || "");
  const newId = "default-id:" + card.dataset.favoriteId;

  if (favorites.includes(oldId)) {
    favorites = favorites.filter(id => id !== oldId);

    if (!favorites.includes(newId)) {
      favorites.push(newId);
    }

    favoritesMigrated = true;
  }
});

if (favoritesMigrated) {
  saveFavorites();
}

// Определяем ID карточки

function getFavoriteId(card) {
  if (card.dataset.id) {
    return "custom:" + card.dataset.id;
  }

  return "default-id:" + card.dataset.favoriteId;
}

function saveFavorites() {
  try {
    localStorage.setItem(
      favoritesKey,
      JSON.stringify(favorites)
    );
    return true;
  } catch (error) {
    alert("Не удалось сохранить избранное. Проверьте свободное место.");
    return false;
  }
}

// Добавляем звёздочки

function addFavoriteStars() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".phrase-card")
    .forEach(card => {
      if (card.querySelector(".favorite-star")) {
        return;
      }

      const star = document.createElement("button");
      star.type = "button";

      star.className = "favorite-star";
      star.setAttribute("role", "button");
      star.setAttribute("tabindex", "0");
      star.setAttribute(
        "aria-label",
        "Добавить в избранное"
      );

      card.appendChild(star);
    });

  updateFavorites();
}

// Обновляем звёздочки и видимость карточек

function updateFavorites() {
  if (!phraseGrid) return;

  const cards = phraseGrid.querySelectorAll(
    ".phrase-card"
  );

  let visibleCount = 0;

  cards.forEach(card => {
    const id = getFavoriteId(card);
    const isFavorite = favorites.includes(id);
    const star = card.querySelector(".favorite-star");

    if (star) {
      star.textContent = isFavorite ? "★" : "☆";

      star.classList.toggle(
        "is-favorite",
        isFavorite
      );

      star.setAttribute(
        "aria-label",
        isFavorite
          ? "Убрать из избранного"
          : "Добавить в избранное"
      );
    }

    const show = !favoritesMode || isFavorite;

    card.classList.toggle(
      "favorite-hidden",
      !show
    );

    if (show) visibleCount++;
  });

  let empty = document.getElementById(
    "favoriteEmpty"
  );

  if (favoritesMode && visibleCount === 0) {
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "favoriteEmpty";
      empty.className = "favorite-empty";
      phraseGrid.appendChild(empty);
    }

    empty.textContent = "⭐ Пока нет избранных фраз";
  } else {
    empty?.remove();
  }
}

// Переключаем избранное

function toggleFavorite(card) {
  const before = [...favorites];
  const id = getFavoriteId(card);

  if (favorites.includes(id)) {
    favorites = favorites.filter(item => item !== id);
  } else {
    favorites.push(id);
  }

  if (!saveFavorites()) favorites = before;
  updateFavorites();
}

// Обработка звёздочек раньше озвучивания

if (phraseGrid) {
  phraseGrid.addEventListener(
    "click",
    event => {
      const star = event.target.closest(
        ".favorite-star"
      );

      if (!star) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const card = star.closest(".phrase-card");

      if (card) {
        toggleFavorite(card);
      }
    },
    true
  );

  // Поддержка клавиатуры

  phraseGrid.addEventListener(
    "keydown",
    event => {
      const star = event.target.closest(
        ".favorite-star"
      );

      if (!star) return;

      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        event.stopPropagation();
        star.click();
      }
    }
  );
}

// ==========================================
// 2. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// ==========================================

const favoritesNav =
  document.getElementById("favoritesTab") ||
  [...document.querySelectorAll(".nav-item")]
    .find(button =>
      button.textContent.includes("Избранное")
    );

const phrasesNav =
  document.getElementById("phrasesTab") ||
  [...document.querySelectorAll(".nav-item")]
    .find(button =>
      button.textContent.includes("Фразы")
    );

favoritesNav?.addEventListener("click", () => {
  favoritesMode = true;
  updateFavorites();
});

phrasesNav?.addEventListener("click", () => {
  favoritesMode = false;
  updateFavorites();
});

// Автоматически добавляем звёздочки
// новым карточкам

if (phraseGrid) {
  const favoriteObserver = new MutationObserver(
    mutations => {
      const cardsAdded = mutations.some(mutation =>
        [...mutation.addedNodes].some(node =>
          node.nodeType === 1 &&
          (
            node.matches?.(".phrase-card") ||
            node.querySelector?.(".phrase-card")
          )
        )
      );

      if (cardsAdded) {
        addFavoriteStars();
      }
    }
  );

  favoriteObserver.observe(phraseGrid, {
    childList: true
  });

  addFavoriteStars();
}

// ==========================================
// 3. РАЗМЕР КАРТОЧЕК
// ==========================================

const cardSizeKey = "echoCardSize";

const allowedCardSizes = [
  "small",
  "medium",
  "large"
];

function applyCardSize(size) {
  if (!allowedCardSizes.includes(size)) {
    size = "medium";
  }

  document.body.classList.remove(
    "cards-small",
    "cards-medium",
    "cards-large"
  );

  document.body.classList.add(
    "cards-" + size
  );

  try {
    localStorage.setItem(cardSizeKey, size);
  } catch (error) {
    console.warn("ECHO: размер не сохранён");
  }

  document.querySelectorAll(".card-size-option")
    .forEach(button => {
      const active = button.dataset.size === size;

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
}

// Восстанавливаем сохранённый размер

applyCardSize(
  localStorage.getItem(cardSizeKey) || "medium"
);

// ==========================================
// 4. ПАНЕЛЬ РАЗМЕРОВ
// ==========================================

const sizePanel = document.createElement("section");

sizePanel.className = "card-size-panel";
sizePanel.hidden = true;

sizePanel.innerHTML = `
  <h3>🔠 Размер карточек</h3>

  <div class="card-size-options">
    <button
      type="button"
      class="card-size-option"
      data-size="small"
    >
      Маленькие
    </button>

    <button
      type="button"
      class="card-size-option"
      data-size="medium"
    >
      Средние
    </button>

    <button
      type="button"
      class="card-size-option"
      data-size="large"
    >
      Большие
    </button>
  </div>
`;

document.querySelector("main")?.prepend(sizePanel);

// ==========================================
// 5. ОТКРЫТИЕ НАСТРОЕК
// ==========================================

const sizeSettingsTab =
  document.getElementById("settingsTab");

const sizePhrasesTab =
  document.getElementById("phrasesTab");

const sizeFavoritesTab =
  document.getElementById("favoritesTab");

const sizeTopSettings =
  document.querySelector(".settings-btn");

function openCardSizeSettings() {
  sizePanel.hidden = false;

  applyCardSize(
    localStorage.getItem(cardSizeKey) || "medium"
  );
}

function closeCardSizeSettings() {
  sizePanel.hidden = true;
}

sizeSettingsTab?.addEventListener(
  "click",
  openCardSizeSettings
);

sizeTopSettings?.addEventListener(
  "click",
  openCardSizeSettings
);

sizePhrasesTab?.addEventListener(
  "click",
  closeCardSizeSettings
);

sizeFavoritesTab?.addEventListener(
  "click",
  closeCardSizeSettings
);

// Нажатие на размер

sizePanel.addEventListener("click", event => {
  const button = event.target.closest(
    ".card-size-option"
  );

  if (!button) return;

  applyCardSize(button.dataset.size);
});

// ==========================================
// КОНЕЦ ЧАСТИ 3
// ==========================================


// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 4: ТЕМА И НАСТРОЙКИ ГОЛОСА
// ==========================================

// ==========================================
// 1. ТЁМНАЯ ТЕМА
// ==========================================

const echoThemeKey = "echoTheme";

const themePanel = document.createElement("section");

themePanel.className = "theme-settings-panel";
themePanel.hidden = true;

themePanel.innerHTML = `
  <h3>🌙 Тема оформления</h3>

  <div class="theme-options">
    <button
      type="button"
      class="theme-option"
      data-theme="light"
    >
      ☀️ Светлая
    </button>

    <button
      type="button"
      class="theme-option"
      data-theme="dark"
    >
      🌙 Тёмная
    </button>
  </div>
`;

// Размещаем после панели размеров

if (sizePanel.isConnected) {
  sizePanel.insertAdjacentElement(
    "afterend",
    themePanel
  );
} else {
  document.querySelector("main")?.prepend(themePanel);
}

// ==========================================
// 2. ПРИМЕНЕНИЕ ТЕМЫ
// ==========================================

function applyEchoTheme(theme) {
  const selected = ["light", "dark", "contrast"].includes(theme) ? theme : "light";
  document.body.classList.toggle("contrast-theme", selected === "contrast");

  document.body.classList.toggle(
    "dark-theme",
    selected === "dark"
  );

  try {
    localStorage.setItem(echoThemeKey, selected);
  } catch (error) {
    console.warn("ECHO: тема не сохранена");
  }

  document.querySelectorAll(".theme-option")
    .forEach(button => {
      const active =
        button.dataset.theme === selected;

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });

  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      selected === "dark"
        ? "#101714"
        : "#f7f8f5"
    );
}

// Восстанавливаем тему

applyEchoTheme(
  localStorage.getItem(echoThemeKey) || "light"
);

// Выбор темы

themePanel.addEventListener("click", event => {
  const button = event.target.closest(".theme-option");

  if (!button) return;

  applyEchoTheme(button.dataset.theme);
});

function openThemeSettings() {
  themePanel.hidden = false;
}

function closeThemeSettings() {
  themePanel.hidden = true;
}

sizeSettingsTab?.addEventListener(
  "click",
  openThemeSettings
);

sizeTopSettings?.addEventListener(
  "click",
  openThemeSettings
);

sizePhrasesTab?.addEventListener(
  "click",
  closeThemeSettings
);

sizeFavoritesTab?.addEventListener(
  "click",
  closeThemeSettings
);

// ==========================================
// 3. ПАНЕЛЬ НАСТРОЕК ГОЛОСА
// ==========================================

const voicePanel = document.createElement("section");

voicePanel.className = "voice-settings-panel";
voicePanel.hidden = true;

voicePanel.innerHTML = `
  <h3>🗣️ Настройка голоса</h3>

  <div class="voice-field">
    <label for="echoVoiceSelect">Голос</label>

    <select
      id="echoVoiceSelect"
      class="voice-select"
    >
      <option value="">
        Голос по умолчанию
      </option>
    </select>
  </div>

  <div class="voice-field">
    <label for="echoVoiceRate">
      Скорость
      <span class="voice-value" id="echoRateValue">
        0.9×
      </span>
    </label>

    <input
      id="echoVoiceRate"
      class="voice-range"
      type="range"
      min="0.5"
      max="2"
      step="0.1"
      value="0.9"
    >
  </div>

  <div class="voice-field">
    <label for="echoVoicePitch">
      Высота
      <span class="voice-value" id="echoPitchValue">
        1.0
      </span>
    </label>

    <input
      id="echoVoicePitch"
      class="voice-range"
      type="range"
      min="0.5"
      max="2"
      step="0.1"
      value="1"
    >
  </div>

  <div class="voice-field">
    <label for="echoVoiceVolume">
      Громкость
      <span class="voice-value" id="echoVolumeValue">
        100%
      </span>
    </label>

    <input
      id="echoVoiceVolume"
      class="voice-range"
      type="range"
      min="0"
      max="1"
      step="0.1"
      value="1"
    >
  </div>

  <button
    type="button"
    class="voice-test-button"
    id="echoTestVoice"
  >
    ▶ Проверить голос
  </button>

  <p id="echoVoiceAvailability" role="status" aria-live="polite"></p>
  <p class="voice-note">
    Системный TTS работает офлайн только при установленном локальном голосе выбранного языка. Доступные голоса зависят от браузера
    и операционной системы.
  </p>
`;

// Размещаем после панели темы

themePanel.insertAdjacentElement(
  "afterend",
  voicePanel
);

// ==========================================
// 4. ЭЛЕМЕНТЫ НАСТРОЕК ГОЛОСА
// ==========================================

const echoVoiceSelect =
  document.getElementById("echoVoiceSelect");

const echoVoiceRate =
  document.getElementById("echoVoiceRate");

const echoVoicePitch =
  document.getElementById("echoVoicePitch");

const echoVoiceVolume =
  document.getElementById("echoVoiceVolume");

// Проверяем сохранённые значения

echoSettings.rate = Number(
  echoSettings.rate ?? 0.9
);

echoSettings.pitch = Number(
  echoSettings.pitch ?? 1
);

echoSettings.volume = Number(
  echoSettings.volume ?? 1
);

echoSettings.voiceName =
  echoSettings.voiceName || "";

// ==========================================
// 5. ОБНОВЛЕНИЕ ПОДПИСЕЙ
// ==========================================

function updateVoiceLabels() {
  document.getElementById("echoRateValue")
    .textContent =
      echoSettings.rate.toFixed(1) + "×";

  document.getElementById("echoPitchValue")
    .textContent =
      echoSettings.pitch.toFixed(1);

  document.getElementById("echoVolumeValue")
    .textContent =
      Math.round(echoSettings.volume * 100) + "%";
}

// ==========================================
// 6. СПИСОК ГОЛОСОВ ПО ЯЗЫКУ
// ==========================================

function populateEchoVoices() {
  echoVoiceSelect.replaceChildren();
  const fallback = new Option("Автоматический локальный голос", "");
  echoVoiceSelect.append(fallback);
  const voices = echoDeviceVoices().sort((a,b) => a.name.localeCompare(b.name));
  for (const voice of voices) echoVoiceSelect.add(new Option(`${voice.name} (${voice.lang}) — локальный`, voice.name));
  const missing = echoSettings.voiceName && !voices.some(v => v.name === echoSettings.voiceName);
  if (missing) echoVoiceSelect.add(new Option(`${echoSettings.voiceName} — сейчас недоступен`, echoSettings.voiceName));
  echoVoiceSelect.value = echoSettings.voiceName || "";
  echoVoiceSelect.disabled = !("speechSynthesis" in window);
  document.getElementById("echoVoiceAvailability").textContent = !voices.length
    ? "Нет локальных голосов этого языка. Установите голос в настройках устройства или выберите сохранённые записи. Список обновится автоматически; повторите нажатие после загрузки."
    : missing ? "Выбранный голос сейчас недоступен; используется другой локальный голос того же языка. Ваш выбор сохранён."
    : "Доступны локальные голоса выбранного языка. Текст не отправляется сетевому провайдеру.";
  loadVoices();
}

// ==========================================
// 7. ЗАГРУЗКА НАСТРОЕК
// ==========================================

echoVoiceRate.value = echoSettings.rate;
echoVoicePitch.value = echoSettings.pitch;
echoVoiceVolume.value = echoSettings.volume;

updateVoiceLabels();
populateEchoVoices();

// Голоса могут загрузиться позже

if ("speechSynthesis" in window) {
  speechSynthesis.addEventListener(
    "voiceschanged",
    populateEchoVoices
  );
}

// ==========================================
// 8. СОХРАНЕНИЕ НАСТРОЕК ГОЛОСА
// ==========================================

// Выбор голоса

echoVoiceSelect.addEventListener("change", () => {
  window.echoStopSpeech?.();
  const previous = echoSettings.voiceName;
  echoSettings.voiceName = echoVoiceSelect.value;
  echoSettings.voiceNames[echoCurrentLanguage] = echoSettings.voiceName;
  if (!saveSettings()) {
    echoSettings.voiceName = previous; echoSettings.voiceNames[echoCurrentLanguage] = previous;
  }
  populateEchoVoices();
  loadVoices();
});

// Скорость

echoVoiceRate.addEventListener("input", () => {
  echoSettings.rate = Number(echoVoiceRate.value);

  updateVoiceLabels();
  saveSettings();
});

// Высота

echoVoicePitch.addEventListener("input", () => {
  echoSettings.pitch = Number(echoVoicePitch.value);

  updateVoiceLabels();
  saveSettings();
});

// Громкость

echoVoiceVolume.addEventListener("input", () => {
  echoSettings.volume = Number(echoVoiceVolume.value);

  updateVoiceLabels();
  saveSettings();
});

// ==========================================
// 9. ПРОВЕРКА ГОЛОСА
// ==========================================

const echoVoiceTestPhrases = Object.fromEntries(["ru","kk","en","be"].map(lang => [lang, echoI18n.t("Привет! Я ECHO. Это мой голос.", {}, lang)]));

document.getElementById("echoTestVoice")
  ?.addEventListener("click", () => {
    const testText =
      echoVoiceTestPhrases[echoCurrentLanguage] ||
      echoVoiceTestPhrases.ru;

    speak(testText);
  });

// ==========================================
// 10. ОТКРЫТИЕ НАСТРОЕК ГОЛОСА
// ==========================================

function showVoiceSettings() {
  voicePanel.hidden = false;
  populateEchoVoices();
}

function hideVoiceSettings() {
  voicePanel.hidden = true;
}

sizeSettingsTab?.addEventListener(
  "click",
  showVoiceSettings
);

sizeTopSettings?.addEventListener(
  "click",
  showVoiceSettings
);

sizePhrasesTab?.addEventListener(
  "click",
  hideVoiceSettings
);

sizeFavoritesTab?.addEventListener(
  "click",
  hideVoiceSettings
);

// ==========================================
// КОНЕЦ ЧАСТИ 4
// ==========================================

 // ==========================================
 // ECHO — SCRIPT.JS
 // ЧАСТЬ 5: МУЛЬТИЯЗЫЧНОСТЬ
 // ==========================================

 // ==========================================
 // 1. ПЕРЕВОДЫ СТАНДАРТНЫХ ФРАЗ
 // ==========================================

 const echoPhraseTranslations = window.echoI18n.presets;

 // Сохраняем исходные стандартные карточки.
 // Пользовательские карточки не изменяем.

 const echoDefaultCards = [
   ...document.querySelectorAll(
     ".phrase-card:not(.custom-card)"
   )
 ];

 const echoOriginalTexts = echoDefaultCards.map(
   card => card.dataset.text || ""
 );

 // ==========================================
 // 2. ПАНЕЛЬ ВЫБОРА ЯЗЫКА
 // ==========================================

 const languagePanel = document.createElement("section");

 languagePanel.className = "language-panel";
 languagePanel.hidden = true;

 languagePanel.innerHTML = `
   <h3>🌍 Язык приложения</h3>

   <div class="language-options">
     <button
       type="button"
       class="language-option"
       data-language="ru"
     >
       🇷🇺 Русский
     </button>

     <button
       type="button"
       class="language-option"
       data-language="kk"
     >
       🇰🇿 Қазақша
     </button>

     <button
       type="button"
       class="language-option"
       data-language="en"
     >
       🇬🇧 English
     </button>
   </div>
 `;

 // Ставим панель после настроек голоса

 voicePanel.insertAdjacentElement(
   "afterend",
   languagePanel
 );

 // ==========================================
 // 3. ПЕРЕВОД ОДНОЙ КАРТОЧКИ
 // ==========================================

 function echoTranslateCard(card, text) {
   card.dataset.text = text;
   card.querySelector(".card-speak")?.setAttribute("aria-label", text);

   const phraseName = card.querySelector(".phrase-name");
   const phraseText = card.querySelector(".phrase-text");
   const cardText = card.querySelector(".card-text");

   if (phraseName) {
     phraseName.textContent = text;
   }

   if (phraseText) {
     phraseText.textContent = text;
   }

   if (cardText) {
     cardText.textContent = text;
   }

   // Если у стандартной карточки другая структура,
   // меняем последний подходящий текстовый узел.

   if (!phraseName && !phraseText && !cardText) {
     const walker = document.createTreeWalker(
       card,
       NodeFilter.SHOW_TEXT
     );

     const nodes = [];

     while (walker.nextNode()) {
       const node = walker.currentNode;
       const parent = node.parentElement;

       if (
         parent &&
         !parent.closest(
           ".favorite-star, .edit-card, .delete-card, .sound-icon, .phrase-icon"
         ) &&
         node.textContent.trim()
       ) {
         nodes.push(node);
       }
     }

     if (nodes.length) {
       nodes[nodes.length - 1].textContent = text;
     }
   }
 }

 // ==========================================
 // 4. ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА
 // ==========================================

 function applyEchoLanguage(language) {
   if (!echoLanguages[language]) {
     language = "ru";
   }

   echoCurrentLanguage = language;

   try {
     localStorage.setItem(
       echoLanguageKey,
       language
     );
   } catch (error) {
     console.warn("ECHO: язык не сохранён");
   }

   // Переводим стандартные карточки

   const translations = echoPhraseTranslations[language] || echoPhraseTranslations.ru;

   echoDefaultCards.forEach((card, index) => {
     const text = translations[index] ||
       echoOriginalTexts[index];

     if (text) {
       echoTranslateCard(card, text);
     }
   });

   // Отмечаем выбранный язык

   document.querySelectorAll(".language-option")
     .forEach(button => {
       const active =
         button.dataset.language === language;

       button.classList.toggle("active", active);

       button.setAttribute(
         "aria-pressed",
         String(active)
       );
     });

   // Переключаем язык озвучивания

   echoSettings.language =
     echoLanguages[language].speech;

   // Сбрасываем голос прошлого языка

   window.echoStopSpeech?.();
   echoSettings.voiceName = String(echoSettings.voiceNames[language] || "");

   saveSettings();

   // Перезагружаем список голосов

   loadVoices();
   populateEchoVoices();

   // Обновляем избранное

   updateFavorites();

   // Обновляем язык документа

   document.documentElement.lang = language;
 }

 // ==========================================
 // 5. НАЖАТИЕ НА КНОПКУ ЯЗЫКА
 // ==========================================

 languagePanel.addEventListener("click", event => {
   const button = event.target.closest(
     ".language-option"
   );

   if (!button) return;

   applyEchoLanguage(button.dataset.language);
 });

 // ==========================================
 // 6. ОТКРЫТИЕ И ЗАКРЫТИЕ ПАНЕЛИ
 // ==========================================

 function showEchoLanguages() {
   languagePanel.hidden = false;
 }

 function hideEchoLanguages() {
   languagePanel.hidden = true;
 }

 sizeSettingsTab?.addEventListener(
   "click",
   showEchoLanguages
 );

 sizeTopSettings?.addEventListener(
   "click",
   showEchoLanguages
 );

 sizePhrasesTab?.addEventListener(
   "click",
   hideEchoLanguages
 );

 sizeFavoritesTab?.addEventListener(
   "click",
   hideEchoLanguages
 );

 // ==========================================
 // 7. ВОССТАНОВЛЕНИЕ ЯЗЫКА
 // ==========================================

 applyEchoLanguage(echoCurrentLanguage);

 // ==========================================
 // ECHO — КОНЕЦ ЧАСТИ 5
 // ==========================================

 console.log("ECHO: пять частей загружены 🧬");

// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 6: ВИБРАЦИЯ
// ==========================================

// ==========================================
// 1. СОХРАНЕНИЕ НАСТРОЙКИ
// ==========================================

const echoVibrationKey = "echoVibration";

let echoVibrationEnabled = false;

try {
  echoVibrationEnabled =
    localStorage.getItem(echoVibrationKey) === "true";
} catch (error) {
  console.warn("ECHO: настройка вибрации недоступна");
}

// ==========================================
// 2. ФУНКЦИЯ ВИБРАЦИИ
// ==========================================

function echoVibrate(duration = 40) {
  if (!echoVibrationEnabled) return;

  if (typeof navigator.vibrate !== "function") {
    return;
  }

  try {
    navigator.vibrate(duration);
  } catch (error) {
    console.warn("ECHO: вибрация недоступна");
  }
}

// ==========================================
// 3. ПАНЕЛЬ НАСТРОЕК
// ==========================================

const vibrationPanel = document.createElement("section");

vibrationPanel.className = "vibration-settings-panel";
vibrationPanel.hidden = true;

vibrationPanel.innerHTML = `
  <h3>📳 Вибрация</h3>

  <div class="vibration-options">
    <button
      type="button"
      class="vibration-option"
      data-vibration="on"
    >
      📳 Включить
    </button>

    <button
      type="button"
      class="vibration-option"
      data-vibration="off"
    >
      🔕 Выключить
    </button>
  </div>

  <p class="voice-note">
    Короткая вибрация при нажатии на карточку.
    Работает только на поддерживаемых устройствах.
  </p>
`;

// Размещаем после выбора языка

languagePanel.insertAdjacentElement(
  "afterend",
  vibrationPanel
);

// ==========================================
// 4. ОБНОВЛЕНИЕ КНОПОК
// ==========================================

function updateVibrationButtons() {
  vibrationPanel.querySelectorAll(".vibration-option")
    .forEach(button => {
      const enabled = button.dataset.vibration === "on";

      const active =
        enabled === echoVibrationEnabled;

      button.classList.toggle("active", active);

      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
}

function setEchoVibration(enabled) {
  echoVibrationEnabled = Boolean(enabled);

  try {
    localStorage.setItem(
      echoVibrationKey,
      String(echoVibrationEnabled)
    );
  } catch (error) {
    console.warn("ECHO: вибрация не сохранена");
  }

  updateVibrationButtons();

  if (echoVibrationEnabled) {
    echoVibrate(60);
  }
}

vibrationPanel.addEventListener("click", event => {
  const button = event.target.closest(
    ".vibration-option"
  );

  if (!button) return;

  setEchoVibration(
    button.dataset.vibration === "on"
  );
});

updateVibrationButtons();


// ==========================================
// 5. ВИБРАЦИЯ ПРИ НАЖАТИИ НА КАРТОЧКУ
// ==========================================

// Вибрация при касании карточки.
// Работает и для новых пользовательских карточек.

if (phraseGrid) {
  phraseGrid.addEventListener("pointerdown", event => {
    if (!event.isPrimary) return;

    const card = event.target.closest(".phrase-card");

    if (!card || !phraseGrid.contains(card)) {
      return;
    }

    // Не вибрируем при нажатии на кнопки управления.

    if (
      event.target.closest(
        ".edit-card, .delete-card, .favorite-star"
      )
    ) {
      return;
    }

    echoVibrate(60);
  });
}

// ==========================================
// 6. ПРОВЕРКА ПОДДЕРЖКИ ВИБРАЦИИ
// ==========================================

function checkEchoVibrationSupport() {
  const supported =
    typeof navigator.vibrate === "function";

  const note = vibrationPanel.querySelector(".voice-note");

  if (!supported && note) {
    note.textContent =
      "⚠️ Вибрация не поддерживается этим браузером. " +
      "Попробуйте открыть ECHO на Android в Chrome.";
  }

  return supported;
}

checkEchoVibrationSupport();

// ==========================================
// 7. ОТКРЫТИЕ НАСТРОЕК
// ==========================================

function showVibrationSettings() {
  vibrationPanel.hidden = false;
  updateVibrationButtons();
  checkEchoVibrationSupport();
}

function hideVibrationSettings() {
  vibrationPanel.hidden = true;
}

sizeSettingsTab?.addEventListener(
  "click",
  showVibrationSettings
);

sizeTopSettings?.addEventListener(
  "click",
  showVibrationSettings
);

sizePhrasesTab?.addEventListener(
  "click",
  hideVibrationSettings
);

sizeFavoritesTab?.addEventListener(
  "click",
  hideVibrationSettings
);

// ==========================================
// КОНЕЦ ЧАСТИ 6
// ==========================================

console.log("ECHO: вибрация подключена 📳");

// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 7: ПОИСК ФРАЗ
// ==========================================

// ==========================================
// 1. СОЗДАНИЕ ПОИСКОВОЙ СТРОКИ
// ==========================================

const echoSearchPanel = document.createElement("div");

echoSearchPanel.className = "echo-search-panel";

echoSearchPanel.innerHTML = `
  <div class="echo-search-box">
    <span class="echo-search-icon" aria-hidden="true">
      🔎
    </span>

    <input
      type="search"
      id="echoSearchInput"
      placeholder="Найти фразу..."
      aria-label="Поиск фраз"
      autocomplete="off"
    >

    <button
      type="button"
      id="echoClearSearch"
      class="echo-clear-search"
      aria-label="Очистить поиск"
      hidden
    >
      ✕
    </button>
  </div>

  <p id="echoSearchStatus"
     class="echo-search-status"
     role="status"
     aria-live="polite"></p>
`;

// Размещаем над карточками

if (phraseGrid) {
  phraseGrid.insertAdjacentElement(
    "beforebegin",
    echoSearchPanel
  );
}

// ==========================================
// 2. ЭЛЕМЕНТЫ ПОИСКА
// ==========================================

const echoSearchInput =
  document.getElementById("echoSearchInput");

const echoClearSearch =
  document.getElementById("echoClearSearch");

const echoSearchStatus =
  document.getElementById("echoSearchStatus");

// ==========================================
// 3. ПОЛУЧЕНИЕ ТЕКСТА КАРТОЧКИ
// ==========================================

function getEchoSearchText(card) {
  const name =
    card.querySelector(".phrase-name")?.textContent || "";

  const text = card.dataset.text || "";

  return (name + " " + text)
    .toLocaleLowerCase()
    .normalize("NFKC");
}

// ==========================================
// 4. ПОИСК
// ==========================================

function updateEchoSearch() {
  if (!phraseGrid || !echoSearchInput) return;

  const query = echoSearchInput.value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC");

  const cards = phraseGrid.querySelectorAll(
    ".phrase-card"
  );

  let found = 0;

  cards.forEach(card => {
    const matches = getEchoSearchText(card)
      .includes(query);

    // Учитываем режим избранного

    const allowedByFavorites =
      !favoritesMode ||
      favorites.includes(getFavoriteId(card));

    const visible = matches && allowedByFavorites;

    card.classList.toggle(
      "echo-search-hidden",
      !visible
    );

    if (visible) found++;
  });

  echoClearSearch.hidden = query.length === 0;

  if (query && found === 0) {
    echoSearchStatus.textContent =
      "😕 Ничего не найдено";
  } else if (query) {
    echoSearchStatus.textContent =
      "Найдено фраз: " + found;
  } else {
    echoSearchStatus.textContent = "";
  }
}

// ==========================================
// 5. ВВОД ТЕКСТА
// ==========================================

echoSearchInput?.addEventListener(
  "input",
  updateEchoSearch
);

// Очистка

echoClearSearch?.addEventListener(
  "click",
  () => {
    echoSearchInput.value = "";
    updateEchoSearch();
    echoSearchInput.focus();
  }
);

// ==========================================
// 6. СОВМЕСТИМОСТЬ С ИЗБРАННЫМ
// ==========================================

// После обновления избранного повторяем поиск.

if (typeof updateFavorites === "function") {
  const originalUpdateFavorites = updateFavorites;

  updateFavorites = function (...args) {
    const result = originalUpdateFavorites(...args);
    updateEchoSearch();
    return result;
  };
}

// ==========================================
// 7. АВТООБНОВЛЕНИЕ ПОИСКА
// ==========================================

if (phraseGrid) {
  const echoSearchObserver = new MutationObserver(
    mutations => {
      const cardsChanged = mutations.some(mutation =>
        [...mutation.addedNodes, ...mutation.removedNodes]
          .some(node =>
            node.nodeType === 1 &&
            (
              node.matches?.(".phrase-card") ||
              node.querySelector?.(".phrase-card")
            )
          )
      );

      if (cardsChanged) {
        updateEchoSearch();
      }
    }
  );

  echoSearchObserver.observe(phraseGrid, {
    childList: true
  });
}

// ==========================================
// 8. ПЕРВОНАЧАЛЬНОЕ ОБНОВЛЕНИЕ
// ==========================================

updateEchoSearch();

console.log("ECHO: поиск фраз подключён 🔎");

// ==========================================
// КОНЕЦ ЧАСТИ 7
// ==========================================

// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 8: КАТЕГОРИИ ФРАЗ
// ==========================================

// ==========================================
// 1. СПИСОК КАТЕГОРИЙ
// ==========================================

const echoCategories = [
  { id: "all", icon: "🏠", name: "Все" },
  { id: "food", icon: "🍎", name: "Еда и вода" },
  { id: "help", icon: "🆘", name: "Помощь" },
  { id: "health", icon: "❤️", name: "Здоровье" },
  { id: "communication", icon: "💬", name: "Общение" },
  { id: "custom", icon: "✨", name: "Мои фразы" }
];

let echoActiveCategory = "all";

// ==========================================
// 2. СОЗДАНИЕ ПАНЕЛИ
// ==========================================

const echoCategoryPanel = document.createElement("div");

echoCategoryPanel.className = "echo-category-panel";

const echoCategoryList = document.createElement("div");
echoCategoryList.className = "echo-category-list";
echoCategoryList.setAttribute(
  "aria-label",
  "Категории фраз"
);

echoCategoryPanel.appendChild(echoCategoryList);

// Размещаем после поиска

if (echoSearchPanel.isConnected) {
  echoSearchPanel.insertAdjacentElement(
    "afterend",
    echoCategoryPanel
  );
} else if (phraseGrid) {
  phraseGrid.insertAdjacentElement(
    "beforebegin",
    echoCategoryPanel
  );
}

// ==========================================
// 3. КНОПКИ КАТЕГОРИЙ
// ==========================================

echoCategories.forEach(category => {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "echo-category-button";
  button.dataset.category = category.id;

  const icon = document.createElement("span");
  icon.textContent = category.icon;

  const name = document.createElement("span");
  name.textContent = category.name;

  button.append(icon, name);

  echoCategoryList.appendChild(button);
});



// ==========================================
// 4. КАТЕГОРИИ СТАНДАРТНЫХ КАРТОЧЕК
// ==========================================

// Категории для стандартных фраз ECHO

const echoDefaultCategories = [
  "food",          // 💧 Я хочу пить
  "food",          // 🍎 Я хочу есть
  "help",          // 🆘 Мне нужна помощь
  "communication", // 🏠 Я хочу домой
  "communication", // 👍 Да
  "communication"  // 👎 Нет
];

function assignEchoCategories() {
  if (!phraseGrid) return;

  // 1. Стандартные карточки

  const defaultCards = [
    ...phraseGrid.querySelectorAll(
      ".phrase-card:not(.custom-card)"
    )
  ];

  defaultCards.forEach((card, index) => {
    // Если категория задана в HTML,
    // используем её. Иначе — из массива.

    if (!card.dataset.category) {
      card.dataset.category =
        echoDefaultCategories[index] || "communication";
    }
  });

  // 2. Пользовательские карточки

  phraseGrid.querySelectorAll(".custom-card")
    .forEach(card => {
      // Не сбрасываем собственные категории.
      // Часть 8.1 восстановит их из localStorage.

      if (!card.dataset.category) {
        card.dataset.category = "custom";
      }
    });
}


// ==========================================
// 5. ПЕРЕКЛЮЧЕНИЕ КАТЕГОРИИ
// ==========================================

function selectEchoCategory(categoryId) {
  const exists = echoCategories.some(
    category => category.id === categoryId
  );

  echoActiveCategory = exists ? categoryId : "all";

  echoCategoryList.querySelectorAll(
    ".echo-category-button"
  ).forEach(button => {
    const active =
      button.dataset.category === echoActiveCategory;

    button.classList.toggle("active", active);

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });

  updateEchoCategories();
}

echoCategoryList.addEventListener("click", event => {
  const button = event.target.closest(
    ".echo-category-button"
  );

  if (!button) return;

  selectEchoCategory(button.dataset.category);
});

// ==========================================
// 6. СОВМЕСТНАЯ ФИЛЬТРАЦИЯ
// ==========================================

// Эта функция одновременно учитывает:
// категорию, поиск и избранное.

function updateEchoCategories() {
  if (!phraseGrid) return;

  assignEchoCategories();

  const query = echoSearchInput
    ? echoSearchInput.value.trim()
        .toLocaleLowerCase()
        .normalize("NFKC")
    : "";

  let visibleCount = 0;

  phraseGrid.querySelectorAll(".phrase-card")
    .forEach(card => {
      const matchesCategory =
        echoActiveCategory === "all" ||
        card.dataset.category === echoActiveCategory;

      const matchesSearch =
        getEchoSearchText(card).includes(query);

      const matchesFavorites =
        !favoritesMode ||
        favorites.includes(getFavoriteId(card));

      const visible =
        matchesCategory &&
        matchesSearch &&
        matchesFavorites;

      card.classList.toggle(
        "echo-category-hidden",
        !visible
      );

      // Убираем старые фильтры:
      // теперь все условия проверяются вместе.

      card.classList.remove(
        "echo-search-hidden",
        "favorite-hidden"
      );

      if (visible) visibleCount++;
    });

  if (echoClearSearch) {
    echoClearSearch.hidden = query.length === 0;
  }

  if (echoSearchStatus) {
    if (visibleCount === 0) {
      echoSearchStatus.textContent =
        "😕 В этой категории ничего не найдено";
    } else if (query || echoActiveCategory !== "all") {
      echoSearchStatus.textContent =
        "Найдено фраз: " + visibleCount;
    } else {
      echoSearchStatus.textContent = "";
    }
  }

  // Убираем старое сообщение об отсутствии избранного.
  // Количество теперь отображается под поиском.

  document.getElementById("favoriteEmpty")?.remove();
}

// ==========================================
// 7. СОВМЕСТИМОСТЬ С ПОИСКОМ
// ==========================================

// Убираем старый обработчик поиска,
// заменяя его общей фильтрацией.

echoSearchInput?.removeEventListener(
  "input",
  updateEchoSearch
);

echoSearchInput?.addEventListener(
  "input",
  updateEchoCategories
);

// Кнопка очистки поиска из части 7
// остаётся рабочей благодаря дополнительному
// обработчику.

echoClearSearch?.addEventListener("click", () => {
  if (!echoSearchInput) return;

  echoSearchInput.value = "";
  updateEchoCategories();
});

// ==========================================
// 8. СОВМЕСТИМОСТЬ С ИЗБРАННЫМ
// ==========================================

// После переключения вкладок
// повторно применяем фильтр категорий.

favoritesNav?.addEventListener(
  "click",
  updateEchoCategories
);

phrasesNav?.addEventListener(
  "click",
  updateEchoCategories
);

// Обновление после нажатия на звёздочку

phraseGrid?.addEventListener("click", event => {
  if (event.target.closest(".favorite-star")) {
    queueMicrotask(updateEchoCategories);
  }
});

// ==========================================
// 9. НОВЫЕ ПОЛЬЗОВАТЕЛЬСКИЕ КАРТОЧКИ
// ==========================================

if (phraseGrid) {
  const echoCategoryObserver = new MutationObserver(
    mutations => {
      const cardsChanged = mutations.some(mutation =>
        [...mutation.addedNodes, ...mutation.removedNodes]
          .some(node =>
            node.nodeType === 1 &&
            (
              node.matches?.(".phrase-card") ||
              node.querySelector?.(".phrase-card")
            )
          )
      );

      if (cardsChanged) {
        updateEchoCategories();
      }
    }
  );

  echoCategoryObserver.observe(phraseGrid, {
    childList: true
  });
}

// ==========================================
// 10. ПЕРВЫЙ ЗАПУСК
// ==========================================

assignEchoCategories();
selectEchoCategory("all");

console.log("ECHO: категории подключены 🗂️");

// ==========================================
// КОНЕЦ ЧАСТИ 8
// ==========================================


// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 8.1: СОБСТВЕННЫЕ КАТЕГОРИИ
// ==========================================

const echoUserCategoriesKey = "echoUserCategories";
const echoCardCategoriesKey = "echoCardCategories";

function echoReadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

let echoUserCategories = [], echoCardCategories = {};
let echoCategoryDataInvalid = false;
try {
  const raw = localStorage.getItem("echoCategoryState");
  const state = raw !== null ? JSON.parse(raw) : {
    categories: JSON.parse(localStorage.getItem(echoUserCategoriesKey) || "[]"),
    cards: JSON.parse(localStorage.getItem(echoCardCategoriesKey) || "{}")
  };
  const ids = new Set();
  if (!state || !Array.isArray(state.categories) || !state.cards || typeof state.cards !== "object" || Array.isArray(state.cards)) throw new Error("Некорректные категории");
  for (const category of state.categories) {
    if (!category || typeof category.id !== "string" || typeof category.name !== "string" ||
        typeof category.icon !== "string" || ids.has(category.id)) throw new Error("Некорректная категория");
    ids.add(category.id);
  }
  if (Object.values(state.cards).some(id => typeof id !== "string")) throw new Error("Некорректные связи категорий");
  echoUserCategories = state.categories; echoCardCategories = state.cards;
} catch (error) {
  echoCategoryDataInvalid = true;
  queueMicrotask(() => {
    document.getElementById("echoCardStatus").textContent = "Не удалось прочитать категории. Сохранённые данные не изменены; карточки доступны в общем списке.";
  });
}
let echoCategorySaved = JSON.stringify({categories: echoUserCategories, cards: echoCardCategories});
function echoSaveUserCategories() {
  try {
    if (echoCategoryDataInvalid) throw new Error("Повреждённые категории нельзя перезаписывать");
    const next = JSON.stringify({categories: echoUserCategories, cards: echoCardCategories});
    localStorage.setItem("echoCategoryState", next);
    echoCategorySaved = next;
    return true;
  } catch (error) {
    const previous = JSON.parse(echoCategorySaved);
    echoUserCategories = previous.categories; echoCardCategories = previous.cards;
    alert(echoCategoryDataInvalid ? "Сохранённые категории повреждены. Данные не перезаписаны." : "Не удалось сохранить категории. Изменения отменены.");
    return false;
  }
}

// ==========================================
// 1. КНОПКА СОЗДАНИЯ КАТЕГОРИИ
// ==========================================

const echoAddCategoryButton =
  document.createElement("button");

echoAddCategoryButton.type = "button";
echoAddCategoryButton.className =
  "echo-category-button echo-add-category";

echoAddCategoryButton.textContent = "＋ Категория";

echoCategoryList.appendChild(echoAddCategoryButton);

// ==========================================
// 2. ОКНО УПРАВЛЕНИЯ КАТЕГОРИЕЙ
// ==========================================

const echoCategoryModal = document.createElement("div");

echoCategoryModal.className = "echo-category-modal";
echoCategoryModal.hidden = true;

echoCategoryModal.innerHTML = `
  <div class="echo-category-dialog" role="dialog" aria-modal="true"
       aria-labelledby="echoCategoryDialogTitle">
    <div class="echo-category-dialog-header">
      <div>
        <p class="small-title">МОИ КАТЕГОРИИ</p>
        <h2 id="echoCategoryDialogTitle">Новая категория</h2>
      </div>
      <button type="button" class="echo-category-close" id="echoCancelCategory"
              aria-label="Закрыть окно">✕</button>
    </div>

    <label class="field-label">Выберите иконку</label>
    <div class="echo-category-emoji-list" role="group" aria-label="Иконка категории">
      ${["📁", "🏫", "🏠", "❤️", "💊", "🍎", "🎮", "🚗", "👨‍👩‍👧", "⭐", "🐱", "💬"]
        .map(icon => `<button type="button" class="echo-category-emoji-option"
          data-emoji="${icon}" aria-label="${icon}">${icon}</button>`).join("")}
    </div>

    <label class="field-label" for="echoNewCategoryEmoji">Или своя иконка</label>
    <input id="echoNewCategoryEmoji" maxlength="8" value="📁" placeholder="📁">

    <label class="field-label" for="echoNewCategoryName">Название категории</label>
    <input id="echoNewCategoryName" maxlength="35" placeholder="Например: Школа">

    <p id="echoCategoryError" class="echo-category-error" role="alert"></p>
    <button type="button" id="echoSaveCategory" class="echo-category-save">
      Создать категорию
    </button>
  </div>
`;

document.body.appendChild(echoCategoryModal);

const echoNewCategoryEmoji =
  document.getElementById("echoNewCategoryEmoji");

const echoNewCategoryName =
  document.getElementById("echoNewCategoryName");

const echoCategoryError =
  document.getElementById("echoCategoryError");

let echoEditingCategoryId = null;
let echoPreviousFocus = null;

function echoOpenCategoryModal(category = null) {
  echoPreviousFocus = document.activeElement;
  echoEditingCategoryId = category?.id ?? null;

  document.getElementById(
    "echoCategoryDialogTitle"
  ).textContent = category
    ? "✏️ Изменить категорию"
    : "✨ Новая категория";

  echoNewCategoryEmoji.value = category?.icon || "📁";
  echoNewCategoryName.value = category?.name || "";
  echoCategoryError.textContent = "";

  echoCategoryModal.hidden = false;
  document.body.classList.add("echo-category-modal-open");
  echoUpdateCategoryEmojiSelection();
  document.getElementById("echoSaveCategory").textContent =
    category ? "Сохранить изменения" : "Создать категорию";
  echoNewCategoryName.focus();
}

function echoCloseCategoryModal() {
  echoCategoryModal.hidden = true;
  document.body.classList.remove("echo-category-modal-open");
  echoEditingCategoryId = null;
  echoPreviousFocus?.focus?.();
}

function echoUpdateCategoryEmojiSelection() {
  const current = echoNewCategoryEmoji.value.trim();
  echoCategoryModal.querySelectorAll(".echo-category-emoji-option")
    .forEach(button => {
      const selected = button.dataset.emoji === current;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
}

echoCategoryModal.addEventListener("click", event => {
  const option = event.target.closest(".echo-category-emoji-option");
  if (!option) return;
  echoNewCategoryEmoji.value = option.dataset.emoji;
  echoUpdateCategoryEmojiSelection();
});
echoNewCategoryEmoji.addEventListener("input", echoUpdateCategoryEmojiSelection);

echoAddCategoryButton.addEventListener("click", () => {
  echoOpenCategoryModal();
});

document.getElementById("echoCancelCategory")
  .addEventListener("click", echoCloseCategoryModal);

echoCategoryModal.addEventListener("click", event => {
  if (event.target === echoCategoryModal) {
    echoCloseCategoryModal();
  }
});

document.addEventListener("keydown", event => {
  if (echoCategoryModal.hidden) return;

  if (event.key === "Escape") {
    echoCloseCategoryModal();
  }

  if (
    event.key === "Enter" &&
    event.target === echoNewCategoryName
  ) {
    event.preventDefault();
    echoSaveCategoryFromModal();
  }
});

// ==========================================
// 3. СОЗДАНИЕ И РЕДАКТИРОВАНИЕ
// ==========================================

function echoSaveCategoryFromModal() {
  const name = echoNewCategoryName.value.trim();
  const icon = echoNewCategoryEmoji.value.trim() || "📁";

  if (!name) {
    echoCategoryError.textContent =
      "Введите название категории";
    echoNewCategoryName.focus();
    return;
  }

  const duplicate = [
    ...echoCategories,
    ...echoUserCategories
  ].some(category =>
    category.name.toLocaleLowerCase() ===
      name.toLocaleLowerCase() &&
    category.id !== echoEditingCategoryId
  );

  if (duplicate) {
    echoCategoryError.textContent =
      "Категория с таким названием уже существует";
    return;
  }

  if (echoEditingCategoryId) {
    const category = echoUserCategories.find(
      item => item.id === echoEditingCategoryId
    );

    if (category) {
      category.name = name;
      category.icon = icon;
    }
  } else {
    const id = "user-" +
      (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Date.now() + "-" +
            Math.random().toString(36).slice(2)
      );

    echoUserCategories.push({
      id,
      name,
      icon
    });
  }

  if (!echoSaveUserCategories()) return;
  echoRenderUserCategories();
  echoCloseCategoryModal();
}

document.getElementById("echoSaveCategory")
  .addEventListener("click", echoSaveCategoryFromModal);

// ==========================================
// 4. ПОКАЗ ПОЛЬЗОВАТЕЛЬСКИХ КАТЕГОРИЙ
// ==========================================

function echoRenderUserCategories() {
  echoCategoryList.querySelectorAll(
    ".echo-user-category"
  ).forEach(button => button.remove());

  echoUserCategories.forEach(category => {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      "echo-category-button echo-user-category";

    button.dataset.category = category.id;

    const icon = document.createElement("span");
    icon.textContent = category.icon;

    const name = document.createElement("span");
    name.textContent = category.name;

    button.append(icon, name);

    echoCategoryList.insertBefore(
      button,
      echoAddCategoryButton
    );
  });

  echoRefreshCategorySelection();
}

function echoRefreshCategorySelection() {
  echoCategoryList.querySelectorAll(
    "[data-category]"
  ).forEach(button => {
    const active =
      button.dataset.category === echoActiveCategory;

    button.classList.toggle("active", active);
    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });
}

// ==========================================
// 5. ПРИВЯЗКА КАРТОЧЕК К КАТЕГОРИЯМ
// ==========================================

function echoAssignUserCardCategories() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".custom-card")
    .forEach(card => {
      const id = String(card.dataset.id);

      const savedCategory = echoCardCategories[id];

      const exists = echoUserCategories.some(
        category => category.id === savedCategory
      );

      card.dataset.category = exists
        ? savedCategory
        : "custom";
    });
}

// ==========================================
// 6. КНОПКА ПЕРЕМЕЩЕНИЯ КАРТОЧКИ
// ==========================================

function echoAddMoveButtons() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".custom-card")
    .forEach(card => {
      if (card.querySelector(".echo-move-card")) return;

      const move = document.createElement("button");
      move.type = "button";

      move.className = "echo-move-card";
      move.textContent = "📂";
      move.title = "Переместить в категорию";
      move.setAttribute("role", "button");
      move.setAttribute("tabindex", "0");
      move.setAttribute(
        "aria-label",
        "Переместить карточку в категорию"
      );

      card.appendChild(move);
    });
}

// Выбираем категорию для карточки

function echoMoveCard(card) {
  const options = [
    { id: "custom", name: "Мои фразы" },
    ...echoUserCategories
  ];

  const current = card.dataset.category || "custom";

  const message = options.map((category, index) =>
    `${index + 1}. ${category.name}` +
    (category.id === current ? " ✓" : "")
  ).join("\n");

  const answer = prompt(
    "В какую категорию переместить карточку?\n\n" +
    message +
    "\n\nВведите номер:",
    "1"
  );

  if (answer === null) return;

  const number = Number(answer);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > options.length
  ) {
    alert("Выберите правильный номер категории");
    return;
  }

  const categoryId = options[number - 1].id;
  const cardId = String(card.dataset.id);

  if (categoryId === "custom") {
    delete echoCardCategories[cardId];
  } else {
    echoCardCategories[cardId] = categoryId;
  }

  if (!echoSaveUserCategories()) return;
  echoAssignUserCardCategories();
  updateEchoCategories();
}

// Перехватываем нажатие до озвучивания карточки

phraseGrid?.addEventListener(
  "click",
  event => {
    const move = event.target.closest(".echo-move-card");

    if (!move) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const card = move.closest(".custom-card");

    if (card) echoMoveCard(card);
  },
  true
);

phraseGrid?.addEventListener("keydown", event => {
  const move = event.target.closest(".echo-move-card");

  if (
    move &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    move.click();
  }
});

// ==========================================
// 7. УПРАВЛЕНИЕ КАТЕГОРИЯМИ
// ==========================================

// Правый клик по своей категории:
// редактирование или удаление.

function echoManageCategory(categoryId) {
  const category = echoUserCategories.find(
    item => item.id === categoryId
  );

  if (!category) return;

  const answer = prompt(
    `Категория: ${category.icon} ${category.name}\n\n` +
    "1 — Редактировать\n" +
    "2 — Удалить\n\n" +
    "Введите номер:"
  );

  if (answer === "1") {
    echoOpenCategoryModal(category);
  }

  if (answer === "2") {
    const confirmed = confirm(
      `Удалить категорию «${category.name}»?\n\n` +
      "Сами карточки не удалятся."
    );

    if (!confirmed) return;

    echoUserCategories = echoUserCategories.filter(
      item => item.id !== categoryId
    );

    Object.keys(echoCardCategories).forEach(cardId => {
      if (echoCardCategories[cardId] === categoryId) {
        delete echoCardCategories[cardId];
      }
    });

    if (echoActiveCategory === categoryId) {
      echoActiveCategory = "all";
    }

    if (!echoSaveUserCategories()) return;
    echoRenderUserCategories();
    echoAssignUserCardCategories();
    updateEchoCategories();
  }
}

echoCategoryList.addEventListener(
  "contextmenu",
  event => {
    const button = event.target.closest(
      ".echo-user-category"
    );

    if (!button) return;

    event.preventDefault();

    echoManageCategory(button.dataset.category);
  }
);

// ==========================================
// 8. ИСПРАВЛЕНИЕ ФИЛЬТРА КАТЕГОРИЙ
// ==========================================

// Сохраняем старую функцию из части 8.

const echoOriginalAssignCategories =
  assignEchoCategories;

assignEchoCategories = function () {
  echoOriginalAssignCategories();
  echoAssignUserCardCategories();
};

// Добавляем поддержку своих категорий
// в функцию выбора.

selectEchoCategory = function (categoryId) {
  const exists = [
    ...echoCategories,
    ...echoUserCategories
  ].some(category => category.id === categoryId);

  echoActiveCategory = exists ? categoryId : "all";

  echoRefreshCategorySelection();
  updateEchoCategories();
};

// ==========================================
// 9. ОБНОВЛЕНИЕ НОВЫХ КАРТОЧЕК
// ==========================================

if (phraseGrid) {
  const echoUserCategoryObserver = new MutationObserver(
    mutations => {
      const added = mutations.some(mutation =>
        [...mutation.addedNodes].some(node =>
          node.nodeType === 1 &&
          (
            node.matches?.(".custom-card") ||
            node.querySelector?.(".custom-card")
          )
        )
      );

      if (added) {
        echoAssignUserCardCategories();
        echoAddMoveButtons();
        updateEchoCategories();
      }
    }
  );

  echoUserCategoryObserver.observe(phraseGrid, {
    childList: true
  });
}

// ==========================================
// 10. ЗАПУСК
// ==========================================

echoRenderUserCategories();
echoAssignUserCardCategories();
echoAddMoveButtons();
updateEchoCategories();

console.log("ECHO: свои категории подключены 📁");

// ==========================================
// КОНЕЦ ЧАСТИ 8.1
// ==========================================

// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 9: ИСТОРИЯ ПРОИЗНЕСЁННЫХ ФРАЗ
// ==========================================

// ==========================================
// 1. НАСТРОЙКИ ИСТОРИИ
// ==========================================

const echoHistoryKey = "echoPhraseHistory";
const echoHistoryLimit = 100;

let echoHistory = [];

try {
  const saved = JSON.parse(
    localStorage.getItem(echoHistoryKey) || "[]"
  );

  if (Array.isArray(saved)) {
    echoHistory = saved.filter(item =>
      item &&
      typeof item.text === "string" &&
      typeof item.time === "number"
    ).slice(0, echoHistoryLimit);
  }
} catch (error) {
  console.warn("ECHO: история не загружена", error);
}

// ==========================================
// 2. СОХРАНЕНИЕ ИСТОРИИ
// ==========================================

function saveEchoHistory() {
  try {
    localStorage.setItem(
      echoHistoryKey,
      JSON.stringify(echoHistory)
    );
  } catch (error) {
    console.warn("ECHO: история не сохранена", error);
  }
}

// ==========================================
// 3. ДОБАВЛЕНИЕ ФРАЗЫ В ИСТОРИЮ
// ==========================================

function addEchoHistory(text) {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  echoHistory.unshift({
    id: Date.now() + "-" +
      Math.random().toString(36).slice(2),
    text: text.trim(),
    language: echoSettings.language,
    time: Date.now()
  });

  echoHistory = echoHistory.slice(
    0,
    echoHistoryLimit
  );

  saveEchoHistory();
  renderEchoHistory();
}

// ==========================================
// 4. ПОДКЛЮЧЕНИЕ К ОЗВУЧИВАНИЮ
// ==========================================

// Сохраняем исходную функцию speak.
// Все существующие карточки и кнопки
// продолжат работать.

const echoOriginalSpeak = speak;

speak = function (text) {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  addEchoHistory(text);

  return echoOriginalSpeak(text);
};

// ==========================================
// 5. СОЗДАНИЕ ПАНЕЛИ ИСТОРИИ
// ==========================================

const echoHistoryPanel = document.createElement("section");

echoHistoryPanel.className = "echo-history-panel";
echoHistoryPanel.hidden = true;

echoHistoryPanel.innerHTML = `
  <div class="echo-history-header">
    <div>
      <h2>🕘 История фраз</h2>
      <p>Недавно выбранные сообщения</p>
    </div>

    <button
      type="button"
      class="echo-history-clear"
      id="echoHistoryClear"
    >
      🗑️ Очистить
    </button>
  </div>

  <div
    id="echoHistoryList"
    class="echo-history-list"
  ></div>
`;

if (phraseGrid) {
  phraseGrid.insertAdjacentElement(
    "afterend",
    echoHistoryPanel
  );
} else {
  document.querySelector("main")
    ?.appendChild(echoHistoryPanel);
}

const echoHistoryList =
  document.getElementById("echoHistoryList");

// ==========================================
// 6. ФОРМАТИРОВАНИЕ ВРЕМЕНИ
// ==========================================

function formatEchoHistoryTime(timestamp) {
  const date = new Date(timestamp);

  const locale =
    echoCurrentLanguage === "kk" ? "kk-KZ" :
    echoCurrentLanguage === "en" ? "en-US" :
    echoCurrentLanguage === "be" ? "be-BY" : "ru-RU";

  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ==========================================
// 7. ОТОБРАЖЕНИЕ ИСТОРИИ
// ==========================================

function renderEchoHistory() {
  if (!echoHistoryList) return;

  echoHistoryList.replaceChildren();

  if (echoHistory.length === 0) {
    const empty = document.createElement("div");

    empty.className = "echo-history-empty";
    empty.textContent =
      "📭 История пока пуста. Произнеси первую фразу!";

    echoHistoryList.appendChild(empty);
    return;
  }

  echoHistory.forEach(item => {
    const card = document.createElement("div");

    card.className = "echo-history-item";

    const info = document.createElement("div");
    info.className = "echo-history-info";

    const phrase = document.createElement("div");
    phrase.className = "echo-history-text";
    phrase.textContent = item.text;

    const time = document.createElement("div");
    time.className = "echo-history-time";
    time.textContent =
      formatEchoHistoryTime(item.time);

    info.append(phrase, time);

    const replay = document.createElement("button");

    replay.type = "button";
    replay.className = "echo-history-replay";
    replay.textContent = "🔊";

    replay.setAttribute(
      "aria-label",
      "Повторить фразу"
    );

    // Повторяем на языке, который был
    // выбран при первоначальном произнесении.

    replay.addEventListener("click", () => {
      const previousLanguage = echoSettings.language;
      const previousVoiceName = echoSettings.voiceName;

      const savedLanguage = item.language;

      if (savedLanguage) {
        echoSettings.language = savedLanguage;
        echoSettings.voiceName = "";
      }

      // Вызываем исходную озвучку, чтобы
      // повтор не добавлялся в историю заново.

      echoOriginalSpeak(item.text);

      echoSettings.language = previousLanguage;
      echoSettings.voiceName = previousVoiceName;
    });

    card.append(info, replay);
    echoHistoryList.appendChild(card);
  });
}

// ==========================================
// 8. ОЧИСТКА ИСТОРИИ
// ==========================================

document.getElementById("echoHistoryClear")
  ?.addEventListener("click", () => {
    if (echoHistory.length === 0) return;

    const confirmed = confirm(
      "Удалить всю историю произнесённых фраз?"
    );

    if (!confirmed) return;

    echoHistory = [];
    saveEchoHistory();
    renderEchoHistory();
  });

// ==========================================
// 9. КНОПКА ВКЛАДКИ «ИСТОРИЯ»
// ==========================================

const echoHistoryNav = document.createElement("button");

echoHistoryNav.type = "button";
echoHistoryNav.className = "nav-item echo-history-nav";

echoHistoryNav.innerHTML = `
  <span aria-hidden="true">🕘</span>
  <span>История</span>
`;

const echoNavigation =
  document.querySelector(".bottom-nav") ||
  document.querySelector(".nav-bar") ||
  document.querySelector("nav");

if (echoNavigation) {
  echoNavigation.appendChild(echoHistoryNav);
}

// ==========================================
// 10. ПОКАЗ ИСТОРИИ
// ==========================================

function showEchoHistory() {
  echoHistoryPanel.hidden = false;

  if (phraseGrid) phraseGrid.hidden = true;

  echoSearchPanel.hidden = true;
  echoCategoryPanel.hidden = true;

  // Скрываем панели настроек.

  [
    sizePanel,
    themePanel,
    voicePanel,
    languagePanel,
    vibrationPanel
  ].forEach(panel => {
    if (panel) panel.hidden = true;
  });

  document.querySelectorAll(".nav-item")
    .forEach(button => {
      button.classList.remove("active");
    });

  echoHistoryNav.classList.add("active");

  renderEchoHistory();
}

function hideEchoHistory() {
  echoHistoryPanel.hidden = true;

  if (phraseGrid) phraseGrid.hidden = false;

  echoSearchPanel.hidden = false;
  echoCategoryPanel.hidden = false;
}

echoHistoryNav.addEventListener(
  "click",
  showEchoHistory
);

// Возвращение к другим разделам.

document.querySelectorAll(".nav-item")
  .forEach(button => {
    if (button === echoHistoryNav) return;

    button.addEventListener(
      "click",
      hideEchoHistory
    );
  });

// ==========================================
// 11. ПЕРВЫЙ ЗАПУСК
// ==========================================

renderEchoHistory();

console.log("ECHO: история подключена 🕘");

// ==========================================
// КОНЕЦ ЧАСТИ 9
// ==========================================

// ==========================================
// ECHO — SCRIPT.JS
// ЧАСТЬ 10: БЫСТРЫЕ ФРАЗЫ
// ==========================================

// ==========================================
// 1. ХРАНЕНИЕ ЗАКРЕПЛЁННЫХ ФРАЗ
// ==========================================

const echoPinnedKey = "echoPinnedPhrases";

let echoPinnedPhrases = [];

try {
  const saved = JSON.parse(
    localStorage.getItem(echoPinnedKey) || "[]"
  );

  if (Array.isArray(saved)) {
    echoPinnedPhrases = saved.filter(
      item => typeof item === "string"
    );
  }
} catch (error) {
  console.warn("ECHO: ошибка загрузки закреплений", error);
}

function saveEchoPinned() {
  try {
    localStorage.setItem(
      echoPinnedKey,
      JSON.stringify(echoPinnedPhrases)
    );
    return true;
  } catch (error) {
    console.warn("ECHO: закрепления не сохранены", error);
  }
}

// ==========================================
// 2. УНИКАЛЬНЫЙ ID КАРТОЧКИ
// ==========================================

function getEchoPinId(card) {
  if (card.classList.contains("custom-card")) {
    return "custom:" + card.dataset.id;
  }

  if (card.dataset.favoriteId !== undefined) {
    return "default-id:" + card.dataset.favoriteId;
  }

  const defaultCards = [
    ...phraseGrid.querySelectorAll(
      ".phrase-card:not(.custom-card)"
    )
  ];

  return "default-id:" + defaultCards.indexOf(card);
}

// ==========================================
// 3. КНОПКА ЗАКРЕПЛЕНИЯ
// ==========================================

function addEchoPinButtons() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".phrase-card")
    .forEach(card => {
      if (card.querySelector(".echo-pin-button")) return;

      const pin = document.createElement("button");
      pin.type = "button";

      pin.className = "echo-pin-button";
      pin.setAttribute("role", "button");
      pin.setAttribute("tabindex", "0");

      card.appendChild(pin);
    });

  updateEchoPinButtons();
}

function updateEchoPinButtons() {
  if (!phraseGrid) return;

  phraseGrid.querySelectorAll(".phrase-card")
    .forEach(card => {
      const pin = card.querySelector(".echo-pin-button");
      if (!pin) return;

      const pinned = echoPinnedPhrases.includes(
        getEchoPinId(card)
      );

      pin.textContent = pinned ? "📌" : "📍";

      pin.classList.toggle("pinned", pinned);

      pin.setAttribute(
        "aria-label",
        pinned ? "Открепить фразу" : "Закрепить фразу"
      );

      pin.title = pinned
        ? "Открепить"
        : "Закрепить";
    });
}

// ==========================================
// 4. ЗАКРЕПЛЕНИЕ И ОТКРЕПЛЕНИЕ
// ==========================================

function toggleEchoPin(card) {
  const before = [...echoPinnedPhrases];
  const id = getEchoPinId(card);

  if (echoPinnedPhrases.includes(id)) {
    echoPinnedPhrases = echoPinnedPhrases.filter(
      item => item !== id
    );
  } else {
    echoPinnedPhrases.push(id);
  }

  if (!saveEchoPinned()) echoPinnedPhrases = before;
  updateEchoPinButtons();
  renderEchoQuickPhrases();
}

// Перехватываем нажатие на значок
// до обработчика озвучивания карточки.

phraseGrid?.addEventListener(
  "click",
  event => {
    const pin = event.target.closest(
      ".echo-pin-button"
    );

    if (!pin) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const card = pin.closest(".phrase-card");

    if (card) toggleEchoPin(card);
  },
  true
);

phraseGrid?.addEventListener(
  "keydown",
  event => {
    const pin = event.target.closest(
      ".echo-pin-button"
    );

    if (
      pin &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      event.stopPropagation();
      pin.click();
    }
  },
  true
);

// ==========================================
// 5. СОЗДАНИЕ РАЗДЕЛА «БЫСТРЫЕ»
// ==========================================

const echoQuickPanel = document.createElement("section");

echoQuickPanel.className = "echo-quick-panel";
echoQuickPanel.hidden = true;

echoQuickPanel.innerHTML = `
  <div class="echo-quick-header">
    <h2>📌 Быстрые фразы</h2>
    <p>Самые важные сообщения под рукой</p>
  </div>

  <div
    id="echoQuickGrid"
    class="echo-quick-grid"
  ></div>
`;

if (echoHistoryPanel?.isConnected) {
  echoHistoryPanel.insertAdjacentElement(
    "afterend",
    echoQuickPanel
  );
} else {
  document.querySelector("main")
    ?.appendChild(echoQuickPanel);
}

const echoQuickGrid =
  document.getElementById("echoQuickGrid");

// ==========================================
// 6. ОТОБРАЖЕНИЕ БЫСТРЫХ ФРАЗ
// ==========================================

function renderEchoQuickPhrases() {
  if (!echoQuickGrid || !phraseGrid) return;

  echoQuickGrid.replaceChildren();

  const allCards = [
    ...phraseGrid.querySelectorAll(".phrase-card")
  ];

  let count = 0;

  echoPinnedPhrases.forEach(id => {
    const original = allCards.find(
      card => getEchoPinId(card) === id
    );

    if (!original) return;

    count++;

    const item = document.createElement("div");
    item.className = "echo-quick-card";

    const emoji = document.createElement("div");
    emoji.className = "echo-quick-emoji";

    emoji.textContent =
      original.querySelector(".phrase-icon")
        ?.textContent?.trim() || "💬";

    const text = document.createElement("div");
    text.className = "echo-quick-text";

    text.textContent =
      original.dataset.text ||
      original.querySelector(".phrase-name")
        ?.textContent?.trim() ||
      "Фраза";

    const actions = document.createElement("div");
    actions.className = "echo-quick-actions";

    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "echo-quick-speak";
    speakButton.textContent = "🔊 Сказать";

    speakButton.addEventListener("click", () => {
      // Используем обычную озвучку карточки:
      // настройки голоса и история сохраняются.

      speak(original.dataset.text || text.textContent);
    });

    const unpinButton = document.createElement("button");
    unpinButton.type = "button";
    unpinButton.className = "echo-quick-unpin";
    unpinButton.textContent = "✕";
    unpinButton.setAttribute(
      "aria-label",
      "Убрать из быстрых"
    );

    unpinButton.addEventListener("click", () => {
      toggleEchoPin(original);
    });

    actions.append(speakButton, unpinButton);
    item.append(emoji, text, actions);

    echoQuickGrid.appendChild(item);
  });

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "echo-quick-empty";

    empty.textContent =
      "📌 Пока нет закреплённых фраз. " +
      "Нажми 📍 на любой карточке!";

    echoQuickGrid.appendChild(empty);
  }
}

// ==========================================
// 7. КНОПКА В НАВИГАЦИИ
// ==========================================

const echoQuickNav = document.createElement("button");

echoQuickNav.type = "button";
echoQuickNav.className = "nav-item echo-quick-nav";

echoQuickNav.innerHTML = `
  <span aria-hidden="true">📌</span>
  <span>Быстрые</span>
`;

if (echoNavigation) {
  echoNavigation.appendChild(echoQuickNav);
}

// ==========================================
// 8. ОТКРЫТИЕ БЫСТРЫХ ФРАЗ
// ==========================================

function showEchoQuickPhrases() {
  echoQuickPanel.hidden = false;
  echoHistoryPanel.hidden = true;

  if (phraseGrid) phraseGrid.hidden = true;

  echoSearchPanel.hidden = true;
  echoCategoryPanel.hidden = true;

  [
    sizePanel,
    themePanel,
    voicePanel,
    languagePanel,
    vibrationPanel
  ].forEach(panel => {
    if (panel) panel.hidden = true;
  });

  document.querySelectorAll(".nav-item")
    .forEach(button => {
      button.classList.remove("active");
    });

  echoQuickNav.classList.add("active");

  renderEchoQuickPhrases();
}

function hideEchoQuickPhrases() {
  echoQuickPanel.hidden = true;
}

echoQuickNav.addEventListener(
  "click",
  showEchoQuickPhrases
);

// Когда открываем другой раздел,
// скрываем быстрые фразы.

document.querySelectorAll(".nav-item")
  .forEach(button => {
    if (button === echoQuickNav) return;

    button.addEventListener(
      "click",
      hideEchoQuickPhrases
    );
  });

// Совместимость с историей

echoHistoryNav?.addEventListener(
  "click",
  hideEchoQuickPhrases
);

echoQuickNav.addEventListener(
  "click",
  () => {
    echoHistoryPanel.hidden = true;
  }
);

// ==========================================
// 9. ОБНОВЛЕНИЕ ПРИ СОЗДАНИИ КАРТОЧЕК
// ==========================================

if (phraseGrid) {
  const echoPinObserver = new MutationObserver(
    mutations => {
      const changed = mutations.some(mutation =>
        [...mutation.addedNodes, ...mutation.removedNodes]
          .some(node =>
            node.nodeType === 1 &&
            (
              node.matches?.(".phrase-card") ||
              node.querySelector?.(".phrase-card")
            )
          )
      );

      if (changed) {
        addEchoPinButtons();
        renderEchoQuickPhrases();
      }
    }
  );

  echoPinObserver.observe(phraseGrid, {
    childList: true
  });
}

// ==========================================
// 10. ЗАПУСК
// ==========================================

addEchoPinButtons();
renderEchoQuickPhrases();

console.log("ECHO: быстрые фразы подключены 📌");

// ==========================================
// КОНЕЦ ЧАСТИ 10
// ==========================================

// ==========================================
// ECHO — ЧАСТЬ 11: ЭКСТРЕННАЯ ПОМОЩЬ
// ==========================================

// 1. ТЕКСТЫ НА ТРЁХ ЯЗЫКАХ

const echoSOSLanguages = window.echoI18n.sos;

// 2. СОЗДАЁМ КНОПКУ SOS

const echoSOSNav = document.createElement("button");

echoSOSNav.type = "button";
echoSOSNav.className = "nav-item echo-sos-nav";

echoSOSNav.innerHTML = `
  <span aria-hidden="true">🆘</span>
  <span>SOS</span>
`;

if (echoNavigation) {
  echoNavigation.appendChild(echoSOSNav);
}

// 3. СОЗДАЁМ ЭКРАН SOS

const echoSOSPanel = document.createElement("section");

echoSOSPanel.className = "echo-sos-panel";
echoSOSPanel.hidden = true;

echoSOSPanel.innerHTML = `
  <div class="echo-sos-content">

    <div class="echo-sos-symbol" aria-hidden="true">
      🆘
    </div>

    <h2 id="echoSOSTitle">
      Экстренная помощь
    </h2>

    <p id="echoSOSMessage">
      Помогите! Мне срочно нужна помощь!
    </p>

    <button
      type="button"
      id="echoSOSSpeak"
      class="echo-sos-speak"
    >
      🔊 Позвать на помощь
    </button>

    <button
      type="button"
      id="echoSOSStop"
      class="echo-sos-stop"
    >
      ■ Остановить
    </button>

    <button
      type="button"
      id="echoSOSCall"
      class="echo-sos-call"
    >
      📞 Позвонить 112
    </button>

    <p id="echoSOSNote" class="echo-sos-note"></p>

  </div>
`;

if (echoQuickPanel?.isConnected) {
  echoQuickPanel.insertAdjacentElement(
    "afterend",
    echoSOSPanel
  );
} else {
  document.querySelector("main")
    ?.appendChild(echoSOSPanel);
}

// 4. ПОЛУЧАЕМ ТЕКУЩИЙ ЯЗЫК

function getEchoSOSLanguage() {
  return echoSOSLanguages[echoCurrentLanguage] ||
    echoSOSLanguages.ru;
}

// 5. ОБНОВЛЯЕМ ПЕРЕВОД

function updateEchoSOSLanguage() {
  const lang = getEchoSOSLanguage();

  document.getElementById("echoSOSTitle")
    .textContent = lang.title;

  document.getElementById("echoSOSMessage")
    .textContent = lang.message;

  document.getElementById("echoSOSSpeak")
    .textContent = lang.speak;

  document.getElementById("echoSOSCall")
    .textContent = lang.call;

  document.getElementById("echoSOSStop")
    .textContent = lang.stop;

  document.getElementById("echoSOSNote")
    .textContent = lang.note;
}

// 6. ОЗВУЧИВАНИЕ SOS

document.getElementById("echoSOSSpeak")
  .addEventListener("click", () => {
    const lang = getEchoSOSLanguage();

    // Используем обычный голос ECHO,
    // чтобы сохранились настройки озвучивания.

    speak(lang.message);
  });

// 7. ОСТАНОВКА ОЗВУЧИВАНИЯ

document.getElementById("echoSOSStop")
  .addEventListener("click", () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  });

// 8. ПЕРЕХОД К НАБОРУ 112

document.getElementById("echoSOSCall")
  .addEventListener("click", () => {
    const confirmed = confirm(
      "Открыть набор номера 112?\n\n" +
      "Звонок не выполняется автоматически."
    );

    if (!confirmed) return;

    // Показываем номер и пытаемся открыть
    // телефонное приложение устройства.

    alert(
      "Экстренный номер: 112\n\n" +
      "Если телефонный набор не откроется, " +
      "наберите номер вручную."
    );

    window.location.href = "tel:112";
  });

// 9. ОТКРЫТИЕ ЭКРАНА SOS

function showEchoSOS() {
  updateEchoSOSLanguage();

  echoSOSPanel.hidden = false;

  if (phraseGrid) phraseGrid.hidden = true;

  echoSearchPanel.hidden = true;
  echoCategoryPanel.hidden = true;
  echoHistoryPanel.hidden = true;
  echoQuickPanel.hidden = true;

  [
    sizePanel,
    themePanel,
    voicePanel,
    languagePanel,
    vibrationPanel
  ].forEach(panel => {
    if (panel) panel.hidden = true;
  });

  document.querySelectorAll(".nav-item")
    .forEach(button => {
      button.classList.remove("active");
    });

  echoSOSNav.classList.add("active");
}

// 10. ЗАКРЫТИЕ ЭКРАНА SOS

function hideEchoSOS() {
  echoSOSPanel.hidden = true;
}

echoSOSNav.addEventListener(
  "click",
  showEchoSOS
);

document.querySelectorAll(".nav-item")
  .forEach(button => {
    if (button === echoSOSNav) return;

    button.addEventListener(
      "click",
      hideEchoSOS
    );
  });

// 11. ПЕРВЫЙ ЗАПУСК

updateEchoSOSLanguage();

console.log("ECHO: экстренная помощь подключена 🆘");

// ==========================================
// КОНЕЦ ЧАСТИ 11
// ==========================================

// ==========================================
// ECHO — ЧАСТЬ 11.1
// БЕЛОРУССКИЙ ЯЗЫК 🇧🇾
// ==========================================

// 1. РЕГИСТРАЦИЯ ЯЗЫКА

echoLanguages.be = {
  label: "Беларуская",
  speech: "be-BY"
};

// 2. ПЕРЕВОД СТАНДАРТНЫХ ФРАЗ



// 3. ПЕРЕВОД SOS



// 4. ДОБАВЛЯЕМ КНОПКУ ВЫБОРА ЯЗЫКА

const echoBelarusianButton =
  document.createElement("button");

echoBelarusianButton.type = "button";
echoBelarusianButton.className =
  "echo-language-option";

echoBelarusianButton.dataset.language = "be";
echoBelarusianButton.textContent =
  "🇧🇾 Беларуская";

// Ищем контейнер существующих кнопок.

const echoExistingLanguageButton =
  languagePanel.querySelector("[data-language='en']");

if (echoExistingLanguageButton) {
  echoBelarusianButton.className =
    echoExistingLanguageButton.className;

  echoExistingLanguageButton.insertAdjacentElement(
    "afterend",
    echoBelarusianButton
  );
} else {
  languagePanel.appendChild(echoBelarusianButton);
}

// 5. ПЕРЕКЛЮЧЕНИЕ НА БЕЛОРУССКИЙ

echoBelarusianButton.addEventListener("click", () => {
  applyEchoLanguage("be");

  // Обновляем SOS.
  updateEchoSOSLanguage();

  // Обновляем историю и быстрые фразы.
  renderEchoHistory();
  renderEchoQuickPhrases();
});

// 6. ПЕРЕВОД ПОДСКАЗКИ ПОИСКА

const echoOriginalApplyLanguage = applyEchoLanguage;

applyEchoLanguage = function(language) {
  const result = echoOriginalApplyLanguage(language);

  const placeholders = Object.fromEntries(["ru","kk","en","be"].map(lang=>[lang,echoI18n.t("Найти фразу...",{},lang)]));

  if (echoSearchInput) {
    echoSearchInput.placeholder =
      placeholders[language] || placeholders.ru;
  }

  updateEchoSOSLanguage();
  renderEchoQuickPhrases();

  return result;
};

// 7. ОБНОВЛЯЕМ ВЫБОР ГОЛОСА

// Голос для be-BY будет доступен только
// если он установлен в браузере или системе.

function echoCheckBelarusianVoice() {
  if (!("speechSynthesis" in window)) return false;

  return window.speechSynthesis.getVoices().some(
    voice => voice.lang.toLowerCase().startsWith("be")
  );
}

// 8. ВОССТАНОВЛЕНИЕ ЯЗЫКА

if (echoCurrentLanguage === "be") {
  applyEchoLanguage("be");
}

console.log("ECHO: беларуская мова дададзена 🇧🇾");

// ==========================================
// КОНЕЦ ЧАСТИ 11.1
// ==========================================

// ==========================================
// ECHO — ПРОВЕРКА БЕЛОРУССКОГО ГОЛОСА
// ==========================================

const echoOriginalSpeakBelarusian = speak;

speak = function(text) {
  if (
    echoCurrentLanguage === "be" &&
    !echoCheckBelarusianVoice()
  ) {
    console.warn(
      "ECHO: белорусский голос не найден. " +
      "Браузер может использовать другой голос."
    );
  }

  return echoOriginalSpeakBelarusian(text);
};


// ==========================================
// ЧАСТЬ 12 — АДАПТАЦИЯ ГОЛОСА: ПРОФИЛИ
// ==========================================
const echoVoiceProfiles = {
  normal: { name: "Обычный", rate: 1, pitch: 1 },
  calm: { name: "Спокойный", rate: 0.8, pitch: 0.9 },
  clear: { name: "Чёткий", rate: 0.9, pitch: 1 },
  slow: { name: "Медленный", rate: 0.65, pitch: 1 },
  expressive: { name: "Выразительный", rate: 1.05, pitch: 1.15 }
};

if (typeof voicePanel !== "undefined" && voicePanel) {
  const echoProfilePanel = document.createElement("section");
  echoProfilePanel.className = "echo-profile-panel";
  const title = document.createElement("h3");
  title.textContent = "🎙️ Голосовые профили";
  echoProfilePanel.appendChild(title);
  const buttons = document.createElement("div");
  buttons.className = "echo-profile-buttons";
  Object.entries(echoVoiceProfiles).forEach(([id, profile]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "echo-profile-button";
    button.dataset.profile = id;
    button.textContent = profile.name;
    buttons.appendChild(button);
  });
  echoProfilePanel.appendChild(buttons);
  voicePanel.appendChild(echoProfilePanel);
  function updateEchoProfileSelection() {
    buttons.querySelectorAll("button").forEach(button => {
      const profile = echoVoiceProfiles[button.dataset.profile];
      const active = Number(echoSettings.rate) === profile.rate &&
        Number(echoSettings.pitch) === profile.pitch;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  buttons.addEventListener("click", event => {
    const button = event.target.closest("button[data-profile]");
    if (!button) return;
    const profile = echoVoiceProfiles[button.dataset.profile];
    echoSettings.rate = profile.rate;
    echoSettings.pitch = profile.pitch;
    echoVoiceRate.value = profile.rate;
    echoVoicePitch.value = profile.pitch;
    updateVoiceLabels();
    saveSettings();
    updateEchoProfileSelection();
    const test = echoVoiceTestPhrases[echoCurrentLanguage] ||
      echoVoiceTestPhrases.ru;
    speak(test);
  });
  echoVoiceRate.addEventListener("input", updateEchoProfileSelection);
  echoVoicePitch.addEventListener("input", updateEchoProfileSelection);
  updateEchoProfileSelection();
}

// ==========================================
// ECHO FIX — видимые кнопки удаления категорий
// ==========================================
const echoOriginalRenderUserCategories = echoRenderUserCategories;
echoRenderUserCategories = function () {
  echoCategoryList.querySelectorAll(".echo-user-category-group").forEach(group => group.remove());
  echoOriginalRenderUserCategories();
  echoCategoryList.querySelectorAll(".echo-user-category").forEach(button => {
    if (button.querySelector(".echo-category-delete-btn")) return;
    const group = document.createElement("div"); group.className = "echo-user-category-group";
    button.replaceWith(group); group.append(button);
    const remove = document.createElement("button"); remove.type = "button";
    remove.dataset.categoryId = button.dataset.category;
    remove.className = "echo-category-delete-btn";
    remove.textContent = "✕";
    remove.title = "Удалить категорию";
    remove.setAttribute("role", "button");
    remove.setAttribute("tabindex", "0");
    remove.setAttribute("aria-label", "Удалить категорию");
    group.appendChild(remove);
  });
};
echoCategoryList.addEventListener("click", event => {
  const remove = event.target.closest(".echo-category-delete-btn");
  if (!remove) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const id = remove.dataset.categoryId;
  const category = echoUserCategories.find(item => item.id === id);
  if (!category || !confirm(`Удалить категорию «${category.name}»? Карточки сохранятся.`)) return;
  echoUserCategories = echoUserCategories.filter(item => item.id !== id);
  Object.keys(echoCardCategories).forEach(cardId => {
    if (echoCardCategories[cardId] === id) delete echoCardCategories[cardId];
  });
  if (echoActiveCategory === id) echoActiveCategory = "all";
  if (!echoSaveUserCategories()) return;
  echoRenderUserCategories();
  echoAssignUserCardCategories();
  updateEchoCategories();
}, true);
echoCategoryList.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") &&
      event.target.matches(".echo-category-delete-btn")) {
    event.preventDefault();
    event.target.click();
  }
});
echoRenderUserCategories();

// Make the existing edit action available on double click without changing functionality.
echoCategoryList.addEventListener("dblclick", event => {
  const button = event.target.closest(".echo-user-category");
  if (button && !event.target.closest(".echo-category-delete-btn")) {
    const category = echoUserCategories.find(item => item.id === button.dataset.category);
    if (category) echoOpenCategoryModal(category);
  }
});


// ==========================================
// PIPER — SETTINGS PANEL
// ==========================================
(function echoInstallPiperSettings() {
  const panel = document.createElement("section");
  panel.id = "echoPiperPanel";
  panel.className = "echo-piper-panel";
  panel.innerHTML = `
    <h3>🗣️ Нейросетевые голоса Piper</h3>
    <p>Бесплатная локальная озвучка. Требуется запущенный Piper Bridge и скачанные модели.</p>
    <label class="echo-piper-check"><input id="echoPiperEnabled" type="checkbox"> Использовать Piper TTS</label>
    <label for="echoPiperUrl">Адрес локального сервера</label>
    <input id="echoPiperUrl" type="url" placeholder="http://127.0.0.1:8765">
    <label for="echoPiperVoice">Нейросетевой голос</label>
    <select id="echoPiperVoice"><option value="">Нажми «Обновить голоса»</option></select>
    <div class="echo-piper-actions">
      <button type="button" id="echoPiperRefresh">Обновить голоса</button>
      <button type="button" id="echoPiperPreview">▶ Послушать</button>
    </div>
    <small id="echoPiperStatus" aria-live="polite">Piper работает на этом устройстве. Голос устройства выбирается отдельно.</small>`;
  const target = document.querySelector(".voice-settings-panel") || document.querySelector("main") || document.body;
  target.appendChild(panel);
  const enabled = panel.querySelector("#echoPiperEnabled");
  const url = panel.querySelector("#echoPiperUrl");
  const voice = panel.querySelector("#echoPiperVoice");
  if (echoPiperConfig.voice) voice.add(new Option(echoPiperConfig.voice, echoPiperConfig.voice, true, true));
  const status = panel.querySelector("#echoPiperStatus");
  enabled.checked = !!echoPiperConfig.enabled;
  url.value = echoPiperConfig.url;
  function save() {
    window.echoStopSpeech?.();
    const previous = { ...echoPiperConfig };
    echoPiperConfig.enabled = enabled.checked;
    echoPiperConfig.url = url.value.trim() || "http://127.0.0.1:8765";
    echoPiperConfig.voice = voice.value;
    if (!echoPiperSave()) {
      Object.assign(echoPiperConfig, previous); enabled.checked = previous.enabled;
      url.value = previous.url; voice.value = previous.voice;
      status.textContent = "Настройки Piper не сохранены. Изменения отменены.";
    }
  }
  enabled.addEventListener("change", save);
  url.addEventListener("change", save);
  voice.addEventListener("change", save);
  panel.querySelector("#echoPiperRefresh").addEventListener("click", async () => {
    save(); status.textContent = "Ищем модели…";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response;
      try { response = await fetch(echoPiperURL() + "/api/voices", { signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const voices = await response.json();
      voice.replaceChildren(new Option("Выбери голос", ""));
      for (const item of voices) voice.add(new Option(item.label || item.id, item.id));
      voice.value = echoPiperConfig.voice;
      if (!voice.value) { echoPiperConfig.voice = ""; echoPiperSave(); }
      status.textContent = voices.length ? `Найдено моделей: ${voices.length}` : "Модели не найдены. Добавь .onnx и .onnx.json в piper_models.";
    } catch (error) { status.textContent = "Нет соединения с локальным Piper Bridge. См. README.md"; }
  });
  panel.querySelector("#echoPiperPreview").addEventListener("click", () => {
    save();
    if (!echoPiperConfig.enabled || !echoPiperConfig.voice) {
      status.textContent = "⚠️ Включи Piper и выбери нейросетевой голос.";
      return;
    }
    status.textContent = "Проверяем голос: " + echoPiperConfig.voice;
    speak(echoCurrentLanguage === "kk" ? "Сәлем! Мен ECHO." : echoCurrentLanguage === "en" ? "Hello! I am ECHO." : "Привет! Я ECHO. Это мой голос.");
  });
})();

// Card metadata remains backward compatible; large binary images live only in IndexedDB.
function echoReadCardsStrict() {
  const raw = localStorage.getItem("echoCustomPhrases");
  const cards = raw ? JSON.parse(raw) : [];
  const ids = new Set();
  if (!Array.isArray(cards)) throw new Error("Повреждены сохранённые карточки.");
  for (const card of cards) {
    if (!card || !["string", "number"].includes(typeof card.id) ||
        typeof card.name !== "string" || typeof card.text !== "string" || ids.has(String(card.id))) {
      throw new Error("Повреждены сохранённые карточки. Данные не перезаписаны.");
    }
    ids.add(String(card.id));
  }
  return cards;
}
async function echoImageStore(action, value) {
  if (!echoImageDB) echoImageDB = new Promise((resolve, reject) => {
    const request = indexedDB.open("echo-card-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images", {keyPath: "id"});
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); echoImageDB = null; };
      resolve(request.result);
    };
    request.onerror = request.onblocked = () => { echoImageDB = null; reject(new Error("Хранилище изображений недоступно. Закройте другие вкладки и повторите.")); };
  });
  const db = await echoImageDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", action === "get" || action === "getAll" ? "readonly" : "readwrite");
    const request = tx.objectStore("images")[action](value);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error("Не удалось сохранить изображение. Проверьте свободное место."));
  });
}
function echoResetImage(id = null) {
  if (echoCardSaving) return;
  echoImageEpoch++;
  savePhraseButton.disabled = false;
  echoImageId = id || null; echoImageBlob = null;
  if (echoImageURL) URL.revokeObjectURL(echoImageURL);
  echoImageURL = null;
  const preview = document.getElementById("echoImagePreview");
  if (!preview) return;
  preview.hidden = true; preview.removeAttribute("src");
  document.getElementById("echoCardImage").value = "";
  document.getElementById("echoImageError").textContent = "";
  const epoch = echoImageEpoch;
  if (id) echoImageStore("get", id).then(record => {
    if (record && epoch === echoImageEpoch) echoPreviewImage(record.blob);
  }).catch(error => { if (epoch === echoImageEpoch) document.getElementById("echoImageError").textContent = error.message; });
}
function echoPreviewImage(blob) {
  if (echoImageURL) URL.revokeObjectURL(echoImageURL);
  echoImageURL = URL.createObjectURL(blob);
  const preview = document.getElementById("echoImagePreview");
  preview.src = echoImageURL; preview.hidden = false;
}
function echoInitImages() {
  const fields = document.createElement("div"); fields.className = "echo-image-fields";
  fields.innerHTML = `<label for="echoCardImage" class="field-label">Добавить или заменить изображение (JPEG, PNG, WebP, до 8 МБ)</label>
    <input id="echoCardImage" type="file" accept="image/jpeg,image/png,image/webp">
    <img id="echoImagePreview" alt="Предпросмотр изображения карточки" hidden>
    <button id="echoRemoveImage" type="button">Удалить изображение · использовать emoji</button>
    <p id="echoImageError" role="alert"></p>`;
  document.querySelector(".emoji-list").after(fields);
  document.getElementById("echoRemoveImage").onclick = () => echoResetImage();
  document.getElementById("echoCardImage").onchange = async event => {
    if (echoCardSaving) return;
    const file = event.target.files[0]; if (!file) return;
    const epoch = ++echoImageEpoch;
    const errorLabel = document.getElementById("echoImageError"); errorLabel.textContent = "";
    savePhraseButton.disabled = true;
    let bitmap;
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Выберите JPEG, PNG или WebP.");
      if (file.size > 8 * 1024 * 1024) throw new Error("Изображение должно быть не больше 8 МБ.");
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const png = [137,80,78,71,13,10,26,10].every((b,i) => header[i] === b);
      const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
      const webp = String.fromCharCode(...header.slice(0,4)) === "RIFF" && String.fromCharCode(...header.slice(8,12)) === "WEBP";
      if (!({"image/png":png,"image/jpeg":jpeg,"image/webp":webp})[file.type]) throw new Error("Содержимое файла не соответствует JPEG, PNG или WebP.");
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 20000000) throw new Error("Изображение слишком большое: максимум 20 миллионов пикселей.");
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob || blob.size > 1024 * 1024) throw new Error("Не удалось уменьшить изображение до 1 МБ.");
      if (epoch === echoImageEpoch) { echoImageBlob = blob; echoPreviewImage(blob); }
    } catch (error) { if (epoch === echoImageEpoch) errorLabel.textContent = error.message || "Не удалось прочитать изображение."; }
    finally { bitmap?.close(); if (epoch === echoImageEpoch && !echoCardSaving) savePhraseButton.disabled = false; }
  };
}
function echoEnhanceCard(card, phrase) {
  // Edit/delete controls are siblings of the speech button, never nested in it.
  card.querySelectorAll(".edit-card,.delete-card").forEach(control => {
    const button = document.createElement("button"); button.type = "button";
    for (const attr of control.attributes) if (!["role", "tabindex"].includes(attr.name)) button.setAttribute(attr.name, attr.value);
    button.textContent = control.textContent;
    button.onclick = event => { event.stopPropagation(); button.classList.contains("edit-card") ? openEditPhrase(phrase) : requestDeletePhrase(phrase, card); };
    control.replaceWith(button);
  });
  const actions = document.createElement("div"); actions.className = "echo-order-actions";
  for (const [step, label] of [[-1, "Вверх"], [1, "Вниз"]]) {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = (step === -1 ? "↑ " : "↓ ") + label;
    button.setAttribute("aria-label", `${label}: ${phrase.name}`);
    button.onclick = event => {
      event.stopPropagation();
      // Resolve pending deletion before reading the single persisted order.
      if (pendingDelete) finishDelete();
      let cards;
      try { cards = echoReadCardsStrict(); } catch (_) { alert("Сохранённые карточки повреждены. Порядок не изменён."); return; }
      const visible = [...phraseGrid.querySelectorAll(".custom-card")].filter(c => !c.hidden && !c.classList.contains("favorite-hidden") && !c.classList.contains("echo-category-hidden") && !c.classList.contains("echo-search-hidden"));
      const next = visible[visible.indexOf(card) + step]; if (!next) return;
      const from = cards.findIndex(p => String(p.id) === String(phrase.id));
      const to = cards.findIndex(p => String(p.id) === next.dataset.id);
      if (from < 0 || to < 0) return;
      cards.splice(to, 0, cards.splice(from, 1)[0]);
      if (!saveCustomPhrases(cards)) { alert("Не удалось сохранить порядок карточек."); return; }
      // Move existing nodes, preserving all category/favorite handlers and focus.
      if (step < 0) phraseGrid.insertBefore(card, next);
      else phraseGrid.insertBefore(card, next.nextSibling);
      document.getElementById("echoCardStatus").textContent = `Порядок изменён: ${phrase.name}`;
      button.focus();
    };
    actions.append(button);
  }
  card.append(actions);
  if (phrase.imageId) echoImageStore("get", phrase.imageId).then(record => {
    if (!record || !card.isConnected) return;
    const image = document.createElement("img"); image.alt = ""; image.className = "echo-card-image";
    const url = URL.createObjectURL(record.blob);
    image.onload = image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
    card.querySelector(".phrase-icon").replaceChildren(image);
  }).catch(() => { /* Emoji is the offline/storage failure fallback. */ });
}
const echoCardStatus = document.createElement("p"); echoCardStatus.id = "echoCardStatus";
echoCardStatus.setAttribute("role", "status"); phraseGrid.after(echoCardStatus);

// Persist a pending deletion when leaving before the undo countdown expires.
window.addEventListener("pagehide", () => { if (pendingDelete) finishDelete(); });
