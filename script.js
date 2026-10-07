// ===============================
// ECHO v0.1
// Голосовой коммуникатор
// ===============================

let currentVoice = null;

// Ищем подходящий русский голос
function loadVoices() {
  const voices = speechSynthesis.getVoices();

  currentVoice =
    voices.find(v => v.lang === "ru-RU") ||
    voices.find(v => v.lang.startsWith("ru")) ||
    null;
}

loadVoices();

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
}


// ===============================
// ГЛАВНАЯ ФУНКЦИЯ ОЗВУЧКИ
// ===============================

function speak(text) {

  if (!("speechSynthesis" in window)) {
    alert("На этом устройстве озвучка не поддерживается.");
    return;
  }

  if (!text || !text.trim()) return;

  // Останавливаем предыдущую фразу
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

  // Небольшая визуальная реакция
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


// Enter тоже произносит сообщение
const customInput = document.getElementById("customPhrase");

if (customInput) {
  customInput.addEventListener("keydown", function(event) {

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

  button.addEventListener("click", function() {

    navButtons.forEach(item => {
      item.classList.remove("active");
    });

    this.classList.add("active");

  });

});


// ===============================
// СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЬСКИХ ДАННЫХ
// Основа для будущих настроек ECHO
// ===============================

const echoSettings = JSON.parse(
  localStorage.getItem("echoSettings")
) || {
  language: "ru-RU",
  rate: 0.9
};

function saveSettings() {
  localStorage.setItem(
    "echoSettings",
    JSON.stringify(echoSettings)
  );
}