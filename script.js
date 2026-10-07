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