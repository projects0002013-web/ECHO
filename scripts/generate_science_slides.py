#!/usr/bin/env python3
"""Generate ECHO scientific pitch deck (ten evidence-aware slides).

Requires: pip install python-pptx==1.0.2
Usage: python scripts/generate_science_slides.py ECHO-science.pptx
No invented user-study statistics; the outcomes page remains a placeholder.
"""
from pathlib import Path
from sys import argv
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

GREEN = RGBColor(20, 119, 82)
INK = RGBColor(32, 67, 51)
MUTED = RGBColor(87, 110, 99)
WHITE = RGBColor(255, 255, 255)
LIGHT = RGBColor(241, 248, 244)
SOURCE = ("WHO (2024), Assistive technology; ASHA, Augmentative and "
          "Alternative Communication; official AAC product documentation")
PAGES = [
    ("ECHO — общение доступнее", "Бесплатный AAC-коммуникатор для повседневных сообщений",
     [("Цель", "Доступный выбор и озвучивание фраз"),
      ("Формат", "Карточки · записи · системная речь · локальные данные")]),
    ("Проблема", "Короткие сообщения тоже требуют понятного способа общения",
     [("Скорость", "Нужно быстро найти фразу"),("Доступность", "Крупный текст и понятные кнопки"),
      ("Независимость", "Базовое общение без обязательной сети")]),
    ("Цель и гипотеза", "Сравниваем обычный и упрощённый режим",
     [("Цель", "Разработать и оценить понятный AAC-прототип"),
      ("Гипотеза — не доказана", "Простой режим может уменьшить время и количество нажатий")]),
    ("Аналоги", "Обзор официальных описаний, не рейтинг эффективности",
     [("Proloquo2Go", "Символы и расширенный словарь"),
      ("TD Snap", "Наборы страниц и альтернативное управление"),
      ("Public AAC", "Бесплатные коммуникационные доски"),
      ("ECHO", "Карточки, записи, локальные функции")]),
    ("Функции ECHO", "Реализовано в коде; физическая приёмка впереди",
     [("Карточки", "Избранное, поиск и категории"),
      ("Голос", "TTS, сохранённые записи, тестовый PocketTTS English"),
      ("Настройки", "Executive Light, простой режим"),
      ("Данные", "Резервное копирование и восстановление")]),
    ("Архитектура", "Обработка пользовательских сообщений",
     [("Ввод", "Карточка или новый текст"),
      ("Обработка", "Выбор источника озвучивания"),
      ("Вывод", "Аудио и локальный кэш"),
      ("Приватность", "Без обязательной передачи личных записей в облако")]),
    ("Доступность", "Каждый пользователь имеет свои потребности",
     [("Зрение", "Контраст и размер элементов"),
      ("Моторика", "Клавиатура, стрелки и простая навигация"),
      ("Общение", "Кнопка Stop, системный TTS и сохранённые записи")]),
    ("Метод исследования", "План добровольного UX-испытания",
     [("Задания", "Одинаковые просьбы в двух режимах"),
      ("Показатели", "Время, ошибки, нажатия, успешность"),
      ("Этика", "Добровольность, согласия и обезличивание")]),
    ("Результаты", "Исследование пользователей ещё не проведено",
     [("Время", "Нет измерений"),
      ("Нажатия", "Нет измерений"),
      ("Успешность", "Нет измерений"),
      ("Важно", "Автотесты не доказывают удобство для людей")]),
    ("Вывод", "Прототип готовится к финальной приёмке",
     [("Есть", "Работающий код, автоматические проверки и тестовая APK"),
      ("Осталось", "Реальные устройства, UX-исследование, стабильный релиз"),
      ("Источники", SOURCE)]),
]

def add_text(slide, x, y, w, h, value, size=19, bold=False, color=INK):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    p = frame.paragraphs[0]
    p.text = value
    p.font.name = "Aptos"
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color

def make(output):
    deck = Presentation()
    deck.slide_width = Inches(13.333)
    deck.slide_height = Inches(7.5)
    for number, (title, subtitle, cards) in enumerate(PAGES, 1):
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = LIGHT
        stripe = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(.13), Inches(7.5))
        stripe.fill.solid()
        stripe.fill.fore_color.rgb = GREEN
        stripe.line.fill.background()
        add_text(slide, .56, .40, 11.9, .56, title, 30, True)
        add_text(slide, .58, 1.05, 11.8, .5, subtitle, 15, False, MUTED)
        for i, (heading, body) in enumerate(cards):
            cols = min(len(cards), 2)
            x = .70 + (i % cols) * (6.1 if cols == 2 else 0)
            y = 1.85 + (i // cols) * (2.05 if len(cards) > 2 else 0)
            w = 5.85 if cols == 2 else 11.8
            h = 1.82 if len(cards) > 2 else 3.7
            shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                           Inches(x), Inches(y), Inches(w), Inches(h))
            shape.fill.solid()
            shape.fill.fore_color.rgb = WHITE
            shape.line.color.rgb = RGBColor(212, 228, 219)
            add_text(slide, x+.25, y+.22, w-.5, .53, heading, 19, True)
            add_text(slide, x+.25, y+.81, w-.5, h-.9, body, 15, False, MUTED)
        add_text(slide, .65, 7.03, 11, .27,
                 "ECHO · Научный проект · Результаты пользователей не вымышлены", 10, False, MUTED)
        add_text(slide, 12.23, 7.01, .6, .27, str(number), 11, True, GREEN)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    deck.save(str(output))
    assert len(PAGES) == 10
    print(f"10-slide ECHO science deck written: {output}")

if __name__ == "__main__":
    make(argv[1] if len(argv)>1 else "ECHO-science.pptx")
