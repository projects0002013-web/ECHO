// ==========================================
// ECHO
// script.js
// ==========================================


// ==========================================
// ГОЛОС
// ==========================================

let currentVoice = null;


// Загружаем доступные голоса
function loadVoices() {

  if (!("speechSynthesis" in window)) {
    return;
  }

  const voices = speechSynthesis.getVoices();

  currentVoice =
    voices.find(voice => voice.lang === "ru-RU") ||
    voices.find(voice => voice.lang.startsWith("ru")) ||
    null;
}


// Первая загрузка
loadVoices();


// Некоторые браузеры загружают голоса позже
if ("speechSynthesis" in window) {

  speechSynthesis.onvoiceschanged = loadVoices;

}


// ==========================================
// ПРОИЗНЕСЕНИЕ ТЕКСТА
// ==========================================

function speak(text) {

  if (!("speechSynthesis" in window)) {

    alert(
      "На этом устройстве озвучка не поддерживается."
    );

    return;
  }


  if (!text || !text.trim()) {
    return;
  }


  speechSynthesis.cancel();


  const message =
    new SpeechSynthesisUtterance(text);


  message.lang = "ru-RU";
  message.rate = 0.9;
  message.pitch = 1;
  message.volume = 1;


  if (currentVoice) {

    message.voice = currentVoice;

  }


  speechSynthesis.speak(message);

}


// ==========================================
// БЫСТРЫЕ КАРТОЧКИ
// ==========================================

function speakPhrase(button) {

  const text =
    button.dataset.text;


  if (!text) {
    return;
  }


  button.classList.add(
    "speaking"
  );


  setTimeout(() => {

    button.classList.remove(
      "speaking"
    );

  }, 400);


  speak(text);

}


// ==========================================
// СВОЯ ФРАЗА
// ==========================================

function speakCustomPhrase() {

  const input =
    document.getElementById(
      "customPhrase"
    );


  if (!input) {
    return;
  }


  const text =
    input.value.trim();


  if (!text) {

    input.focus();

    return;

  }


  speak(text);

}


// Enter запускает свою фразу

const customInput =
  document.getElementById(
    "customPhrase"
  );


if (customInput) {

  customInput.addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {

        speakCustomPhrase();

      }

    }
  );

}


// ==========================================
// НАВИГАЦИЯ
// ==========================================

const navButtons =
  document.querySelectorAll(
    ".nav-item"
  );


navButtons.forEach(button => {

  button.addEventListener(
    "click",
    function () {

      navButtons.forEach(item => {

        item.classList.remove(
          "active"
        );

      });


      this.classList.add(
        "active"
      );

    }
  );

});


// ==========================================
// НАСТРОЙКИ ECHO
// ==========================================

let echoSettings = {

  language: "ru-RU",

  rate: 0.9

};


try {

  const savedSettings =
    localStorage.getItem(
      "echoSettings"
    );


  if (savedSettings) {

    echoSettings =
      JSON.parse(
        savedSettings
      );

  }

} catch (error) {

  console.log(
    "Не удалось загрузить настройки ECHO"
  );

}


// ==========================================
// СОХРАНЕНИЕ НАСТРОЕК
// ==========================================

function saveSettings() {

  localStorage.setItem(
    "echoSettings",
    JSON.stringify(
      echoSettings
    )
  );

}
// ==========================================
// ЭЛЕМЕНТЫ ОКНА ДОБАВЛЕНИЯ / РЕДАКТИРОВАНИЯ
// ==========================================

const addButton =
  document.querySelector(
    ".add-button"
  );

const modal =
  document.getElementById(
    "addPhraseModal"
  );

const closeModalButton =
  document.getElementById(
    "closeModal"
  );

const savePhraseButton =
  document.getElementById(
    "savePhrase"
  );

const nameInput =
  document.getElementById(
    "newPhraseName"
  );

const phraseInput =
  document.getElementById(
    "newPhraseText"
  );

const phraseGrid =
  document.querySelector(
    ".phrase-grid"
  );

const emojiButtons =
  document.querySelectorAll(
    ".emoji-option"
  );


// ==========================================
// НОВОЕ: РЕЖИМ РЕДАКТИРОВАНИЯ
// ==========================================

// null = создаём новую карточку
// ID = редактируем существующую карточку

let editingPhraseId = null;


// Выбранный эмодзи

let selectedEmoji = "💧";


// ==========================================
// ВЫБОР ЭМОДЗИ
// ==========================================

emojiButtons.forEach(button => {

  button.addEventListener(
    "click",
    () => {

      emojiButtons.forEach(item => {

        item.classList.remove(
          "selected"
        );

      });


      button.classList.add(
        "selected"
      );


      selectedEmoji =
        button.textContent.trim();

    }
  );

});


// ==========================================
// ОТКРЫТИЕ ОКНА ДЛЯ НОВОЙ КАРТОЧКИ
// ==========================================

if (addButton && modal) {

  addButton.addEventListener(
    "click",
    () => {

      // ВАЖНО:
      // переключаемся обратно
      // в режим создания

      editingPhraseId = null;


      // Очищаем поля

      resetAddForm();


      // Возвращаем обычный текст кнопки

      if (savePhraseButton) {

        savePhraseButton.textContent =
          "Добавить карточку";

      }


      // Открываем окно

      modal.classList.add(
        "open"
      );


      if (nameInput) {

        setTimeout(() => {

          nameInput.focus();

        }, 100);

      }

    }
  );

}


// ==========================================
// ЗАКРЫТИЕ ОКНА
// ==========================================

function closeAddModal() {

  if (!modal) {
    return;
  }


  modal.classList.remove(
    "open"
  );

}


// Кнопка X

if (closeModalButton) {

  closeModalButton.addEventListener(
    "click",
    closeAddModal
  );

}


// Нажатие на затемнённый фон

if (modal) {

  modal.addEventListener(
    "click",
    event => {

      if (event.target === modal) {

        closeAddModal();

      }

    }
  );

}


// ESC закрывает окно

document.addEventListener(
  "keydown",
  event => {

    if (event.key === "Escape") {

      closeAddModal();

    }

  }
);


// ==========================================
// ПОЛУЧЕНИЕ СОХРАНЁННЫХ ФРАЗ
// ==========================================

function getCustomPhrases() {

  try {

    const saved =
      localStorage.getItem(
        "echoCustomPhrases"
      );


    if (!saved) {

      return [];

    }


    const parsed =
      JSON.parse(saved);


    if (!Array.isArray(parsed)) {

      return [];

    }


    return parsed;

  } catch (error) {

    console.log(
      "Не удалось загрузить фразы ECHO"
    );


    return [];

  }

}


// ==========================================
// СОХРАНЕНИЕ ФРАЗ
// ==========================================

function saveCustomPhrases(phrases) {

  localStorage.setItem(
    "echoCustomPhrases",
    JSON.stringify(
      phrases
    )
  );

}


// ==========================================
// ЗАЩИТА ТЕКСТА
// ==========================================

function escapeHTML(text) {

  const element =
    document.createElement(
      "div"
    );


  element.textContent =
    String(text ?? "");


  return element.innerHTML;

}
// ==========================================
// СОЗДАНИЕ ПОЛЬЗОВАТЕЛЬСКОЙ КАРТОЧКИ
// ==========================================

function createPhraseCard(phrase) {

  if (!phraseGrid) {
    return;
  }


  const button =
    document.createElement("button");


  button.className =
    "phrase-card custom-card";


  button.dataset.text =
    phrase.text;


  button.dataset.id =
    phrase.id;


  button.innerHTML = `

    <span class="phrase-icon">
      ${escapeHTML(phrase.emoji)}
    </span>

    <span class="phrase-name">
      ${escapeHTML(phrase.name)}
    </span>

    <span class="phrase-text">
      ${escapeHTML(phrase.text)}
    </span>

    <span class="sound-icon">
      🔊
    </span>


    <!-- РЕДАКТИРОВАТЬ -->

    <span
      class="edit-card"
      title="Редактировать карточку"
      aria-label="Редактировать карточку"
    >
      ✎
    </span>


    <!-- УДАЛИТЬ -->

    <span
      class="delete-card"
      title="Удалить карточку"
      aria-label="Удалить карточку"
    >
      ×
    </span>

  `;


  // ========================================
  // НАЖАТИЕ НА КАРТОЧКУ = ОЗВУЧКА
  // ========================================

  button.addEventListener(
    "click",
    event => {

      // Не озвучиваем,
      // если нажали редактировать/удалить

      if (
        event.target.closest(".edit-card") ||
        event.target.closest(".delete-card")
      ) {

        return;

      }


      speakPhrase(button);

    }
  );


  // ========================================
  // КНОПКА РЕДАКТИРОВАНИЯ
  // ========================================

  const editButton =
    button.querySelector(
      ".edit-card"
    );


  if (editButton) {

    editButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();


        openEditPhrase(
          phrase
        );

      }
    );

  }


  // ========================================
  // КНОПКА УДАЛЕНИЯ
  // ========================================

  const deleteButton =
    button.querySelector(
      ".delete-card"
    );


  if (deleteButton) {

    deleteButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();


        requestDeletePhrase(
          phrase,
          button
        );

      }
    );

  }


  phraseGrid.appendChild(
    button
  );

}


// ==========================================
// ОТКРЫТИЕ РЕДАКТИРОВАНИЯ
// ==========================================

function openEditPhrase(phrase) {

  if (!modal) {
    return;
  }


  // Запоминаем ID редактируемой карточки

  editingPhraseId =
    phrase.id;


  // Ставим старое название

  if (nameInput) {

    nameInput.value =
      phrase.name;

  }


  // Ставим старую фразу

  if (phraseInput) {

    phraseInput.value =
      phrase.text;

  }


  // Ставим старый эмодзи

  selectedEmoji =
    phrase.emoji;


  emojiButtons.forEach(
    button => {

      button.classList.remove(
        "selected"
      );


      if (
        button.textContent.trim() ===
        phrase.emoji
      ) {

        button.classList.add(
          "selected"
        );

      }

    }
  );


  // Меняем текст кнопки

  if (savePhraseButton) {

    savePhraseButton.textContent =
      "Сохранить изменения";

  }


  // Открываем окно

  modal.classList.add(
    "open"
  );


  // Фокус на названии

  if (nameInput) {

    setTimeout(() => {

      nameInput.focus();

    }, 100);

  }

}


// ==========================================
// ЗАГРУЗКА СОХРАНЁННЫХ КАРТОЧЕК
// ==========================================

function loadCustomPhrases() {

  const phrases =
    getCustomPhrases();


  phrases.forEach(
    phrase => {

      createPhraseCard(
        phrase
      );

    }
  );

}


// Загружаем карточки при запуске

loadCustomPhrases();


// ==========================================
// ОЧИСТКА ФОРМЫ
// ==========================================

function resetAddForm() {

  if (nameInput) {

    nameInput.value = "";

  }


  if (phraseInput) {

    phraseInput.value = "";

  }


  selectedEmoji = "💧";


  emojiButtons.forEach(
    button => {

      button.classList.remove(
        "selected"
      );

    }
  );


  if (emojiButtons[0]) {

    emojiButtons[0]
      .classList.add(
        "selected"
      );

  }

}


// ==========================================
// ОБНОВЛЕНИЕ КАРТОЧЕК НА ЭКРАНЕ
// ==========================================

function refreshCustomCards() {

  if (!phraseGrid) {
    return;
  }


  // Удаляем с экрана только
  // пользовательские карточки

  const customCards =
    phraseGrid.querySelectorAll(
      ".custom-card"
    );


  customCards.forEach(
    card => {

      card.remove();

    }
  );


  // Заново загружаем их из localStorage

  loadCustomPhrases();

}
// ==========================================
// ДОБАВЛЕНИЕ / СОХРАНЕНИЕ ИЗМЕНЕНИЙ
// ==========================================

if (
  savePhraseButton &&
  nameInput &&
  phraseInput
) {

  savePhraseButton.addEventListener(
    "click",
    () => {

      const name =
        nameInput.value.trim();

      const text =
        phraseInput.value.trim();


      // Проверка названия

      if (!name) {

        nameInput.focus();
        return;

      }


      // Проверка текста

      if (!text) {

        phraseInput.focus();
        return;

      }


      let phrases =
        getCustomPhrases();


      // ======================================
      // РЕЖИМ РЕДАКТИРОВАНИЯ
      // ======================================

      if (editingPhraseId !== null) {

        const index =
          phrases.findIndex(
            phrase =>
              String(phrase.id) ===
              String(editingPhraseId)
          );


        if (index !== -1) {

          phrases[index] = {

            ...phrases[index],

            emoji:
              selectedEmoji,

            name:
              name,

            text:
              text

          };


          saveCustomPhrases(
            phrases
          );


          // Обновляем карточки на экране

          refreshCustomCards();

        }


        // Выходим из режима редактирования

        editingPhraseId = null;


        savePhraseButton.textContent =
          "Добавить карточку";


        resetAddForm();

        closeAddModal();

        return;

      }


      // ======================================
      // РЕЖИМ СОЗДАНИЯ
      // ======================================

      const newPhrase = {

        id: Date.now(),

        emoji:
          selectedEmoji,

        name:
          name,

        text:
          text

      };


      phrases.push(
        newPhrase
      );


      saveCustomPhrases(
        phrases
      );


      createPhraseCard(
        newPhrase
      );


      resetAddForm();

      closeAddModal();

    }
  );

}


// ==========================================
// УДАЛЕНИЕ С ОТМЕНОЙ — 5 СЕКУНД
// ==========================================

let pendingDelete = null;


// ==========================================
// ЗАПРОС НА УДАЛЕНИЕ
// ==========================================

function requestDeletePhrase(
  phrase,
  card
) {

  // Если уже удаляется другая карточка,
  // завершаем её удаление

  if (pendingDelete) {

    finishDelete();

  }


  // Запоминаем следующую карточку,
  // чтобы вернуть на прежнее место

  const nextCard =
    card.nextElementSibling;


  // Сразу убираем карточку с экрана

  card.remove();


  // Создаём уведомление

  const undoBox =
    document.createElement(
      "div"
    );


  undoBox.className =
    "delete-undo";


  undoBox.innerHTML = `

    <span class="delete-message">
      Карточка удалена
    </span>

    <button
      class="undo-delete"
      type="button"
    >
      Отменить
    </button>

    <span class="delete-countdown">
      5
    </span>

  `;


  document.body.appendChild(
    undoBox
  );


  pendingDelete = {

    phrase:
      phrase,

    card:
      card,

    nextCard:
      nextCard,

    undoBox:
      undoBox,

    seconds:
      5,

    interval:
      null,

    timeout:
      null

  };


  const countdown =
    undoBox.querySelector(
      ".delete-countdown"
    );


  const undoButton =
    undoBox.querySelector(
      ".undo-delete"
    );


  // ========================================
  // ОТСЧЁТ 5 → 4 → 3 → 2 → 1
  // ========================================

  pendingDelete.interval =
    setInterval(
      () => {

        if (!pendingDelete) {
          return;
        }


        pendingDelete.seconds--;


        if (
          countdown &&
          pendingDelete.seconds > 0
        ) {

          countdown.textContent =
            pendingDelete.seconds;

        }

      },
      1000
    );


  // ========================================
  // ЧЕРЕЗ 5 СЕКУНД УДАЛЯЕМ ОКОНЧАТЕЛЬНО
  // ========================================

  pendingDelete.timeout =
    setTimeout(
      () => {

        finishDelete();

      },
      5000
    );


  // ========================================
  // ОТМЕНИТЬ
  // ========================================

  if (undoButton) {

    undoButton.addEventListener(
      "click",
      () => {

        undoDelete();

      }
    );

  }

}


// ==========================================
// ОТМЕНА УДАЛЕНИЯ
// ==========================================

function undoDelete() {

  if (!pendingDelete) {
    return;
  }


  clearInterval(
    pendingDelete.interval
  );


  clearTimeout(
    pendingDelete.timeout
  );


  const card =
    pendingDelete.card;


  const nextCard =
    pendingDelete.nextCard;


  // Возвращаем карточку
  // на её прежнее место

  if (
    nextCard &&
    nextCard.parentNode === phraseGrid
  ) {

    phraseGrid.insertBefore(
      card,
      nextCard
    );

  } else {

    phraseGrid.appendChild(
      card
    );

  }


  pendingDelete.undoBox.remove();


  pendingDelete = null;

}


// ==========================================
// ОКОНЧАТЕЛЬНОЕ УДАЛЕНИЕ
// ==========================================

function finishDelete() {

  if (!pendingDelete) {
    return;
  }


  clearInterval(
    pendingDelete.interval
  );


  clearTimeout(
    pendingDelete.timeout
  );


  const id =
    String(
      pendingDelete.phrase.id
    );


  let phrases =
    getCustomPhrases();


  phrases =
    phrases.filter(
      phrase =>
        String(phrase.id) !== id
    );


  // Теперь удаляем и из памяти

  saveCustomPhrases(
    phrases
  );


  pendingDelete.undoBox.remove();


  pendingDelete = null;

}


// ==========================================
// НАСТРОЙКИ ГОЛОСА
// ==========================================

function applyVoiceSettings(
  message
) {

  if (!message) {
    return;
  }


  message.lang =
    echoSettings.language ||
    "ru-RU";


  message.rate =
    echoSettings.rate ||
    0.9;


  message.pitch = 1;

  message.volume = 1;


  if (currentVoice) {

    message.voice =
      currentVoice;

  }

}


// ==========================================
// ОБНОВЛЁННАЯ ФУНКЦИЯ ГОЛОСА
// ==========================================

speak = function (text) {

  if (
    !("speechSynthesis" in window)
  ) {

    alert(
      "На этом устройстве озвучка не поддерживается."
    );

    return;

  }


  if (!text || !text.trim()) {
    return;
  }


  speechSynthesis.cancel();


  const message =
    new SpeechSynthesisUtterance(
      text
    );


  applyVoiceSettings(
    message
  );


  speechSynthesis.speak(
    message
  );

};


// ==========================================
// КНОПКА НАСТРОЕК
// ==========================================

const topSettingsButton =
  document.querySelector(
    ".settings-btn"
  );


if (topSettingsButton) {

  topSettingsButton.addEventListener(
    "click",
    () => {

      console.log(
        "Настройки ECHO — следующий этап"
      );

    }
  );

}


// ==========================================
// ПРОВЕРКА LOCAL STORAGE
// ==========================================

function checkStorage() {

  try {

    const testKey =
      "__echo_test__";


    localStorage.setItem(
      testKey,
      "ok"
    );


    localStorage.removeItem(
      testKey
    );


    return true;

  } catch (error) {

    console.warn(
      "ECHO: localStorage недоступен"
    );


    return false;

  }

}


checkStorage();


// ==========================================
// ECHO ГОТОВ
// ==========================================

console.log(
  "ECHO запущен успешно 🔊"
);
