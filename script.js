// ===============================
// ECHO v0.1
// Голосовой коммуникатор
// ===============================

let currentVoice = null;

function loadVoices() {
  if (!("speechSynthesis" in window)) return;

  const voices = speechSynthesis.getVoices();

  currentVoice =
    voices.find(voice => voice.lang === "ru-RU") ||
    voices.find(voice => voice.lang.startsWith("ru")) ||
    null;
}

loadVoices();

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
}


// ===============================
// ОЗВУЧКА
// ===============================

function speak(text) {
  if (!("speechSynthesis" in window)) {
    alert("На этом устройстве озвучка не поддерживается.");
    return;
  }

  if (!text || !text.trim()) return;

  speechSynthesis.cancel();

  const message = new SpeechSynthesisUtterance(text);

  message.lang = "ru-RU";
  message.rate = 0.9;
  message.pitch = 1;
  message.volume = 1;

  if (currentVoice) {
    message.voice = currentVoice;
  }

  speechSynthesis.speak(message);
}


// ===============================
// БЫСТРЫЕ ФРАЗЫ
// ===============================

function speakPhrase(button) {
  const text = button.dataset.text;

  button.classList.add("speaking");

  setTimeout(() => {
    button.classList.remove("speaking");
  }, 400);

  speak(text);
}


// ===============================
// СВОЯ ФРАЗА
// ===============================

function speakCustomPhrase() {
  const input = document.getElementById("customPhrase");
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  speak(text);
}

const customInput = document.getElementById("customPhrase");

if (customInput) {
  customInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      speakCustomPhrase();
    }
  });
}


// ===============================
// НАВИГАЦИЯ
// ===============================

const navButtons = document.querySelectorAll(".nav-item");

navButtons.forEach(button => {
  button.addEventListener("click", function () {
    navButtons.forEach(item => {
      item.classList.remove("active");
    });

    this.classList.add("active");
  });
});


// ===============================
// НАСТРОЙКИ
// ===============================

const echoSettings =
  JSON.parse(localStorage.getItem("echoSettings")) || {
    language: "ru-RU",
    rate: 0.9
  };

function saveSettings() {
  localStorage.setItem(
    "echoSettings",
    JSON.stringify(echoSettings)
  );
}
// ===============================
// ДОБАВЛЕНИЕ СВОИХ ФРАЗ
// ===============================

const addButton = document.querySelector(".add-button");
const modal = document.getElementById("addPhraseModal");
const closeModal = document.getElementById("closeModal");

const iconInput = document.getElementById("newPhraseIcon");
const nameInput = document.getElementById("newPhraseName");
const textInput = document.getElementById("newPhraseText");

const savePhraseButton =
  document.getElementById("savePhraseButton");


// Загружаем сохранённые карточки
let customPhrases =
  JSON.parse(localStorage.getItem("echoPhrases")) || [];


// Открыть окно
addButton.addEventListener("click", () => {

  modal.classList.add("open");

  nameInput.focus();

});


// Закрыть окно
closeModal.addEventListener("click", () => {

  modal.classList.remove("open");

});


// Нажатие по затемнённой области
modal.addEventListener("click", event => {

  if(event.target === modal){
    modal.classList.remove("open");
  }

});


// Создание карточки
function createPhraseCard(phrase){

  const card = document.createElement("button");

  card.className = "phrase-card";

  card.dataset.text = phrase.text;

  card.innerHTML = `
    <span class="phrase-icon">${phrase.icon}</span>

    <span class="phrase-name">
      ${phrase.name}
    </span>

    <span class="phrase-text">
      ${phrase.text}
    </span>

    <span class="sound-icon">
      🔊
    </span>
  `;

  card.addEventListener("click", () => {

    card.classList.add("speaking");

    setTimeout(() => {
      card.classList.remove("speaking");
    },400);

    speak(phrase.text);

  });

  document
    .querySelector(".phrase-grid")
    .appendChild(card);
}


// Показываем сохранённые карточки
customPhrases.forEach(phrase => {

  createPhraseCard(phrase);

});


// Сохранить новую карточку
savePhraseButton.addEventListener("click", () => {

  const icon =
    iconInput.value.trim() || "💬";

  const name =
    nameInput.value.trim();

  const text =
    textInput.value.trim();


  if(!name){

    nameInput.focus();
    return;

  }


  if(!text){

    textInput.focus();
    return;

  }


  const newPhrase = {

    id: Date.now(),

    icon: icon,

    name: name,

    text: text

  };


  customPhrases.push(newPhrase);


  // Сохраняем на устройстве
  localStorage.setItem(
    "echoPhrases",
    JSON.stringify(customPhrases)
  );


  // Показываем карточку
  createPhraseCard(newPhrase);


  // Очищаем поля
  iconInput.value = "";
  nameInput.value = "";
  textInput.value = "";


  // Закрываем окно
  modal.classList.remove("open");

});