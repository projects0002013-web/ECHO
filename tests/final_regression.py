"""Focused final-review regressions, each with isolated browser storage."""
import base64
import json
import unittest
from playwright.sync_api import sync_playwright, expect

URL = 'http://127.0.0.1:8000'

class FinalVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':390,'height':844})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('dialog', lambda d: d.accept())
        self.page.goto(URL)

    def tearDown(self):
        self.context.close()

    def create(self, name, text=None):
        p=self.page
        p.locator('.add-button').click()
        p.locator('#newPhraseName').fill(name)
        p.locator('#newPhraseText').fill(text or name)
        p.locator('#savePhrase').click()
        expect(p.locator('#addPhraseModal')).not_to_have_class('modal open')

    def image(self):
        data = self.page.evaluate('''() => {const c=document.createElement('canvas'); c.width=40;c.height=30;
            c.getContext('2d').fillRect(0,0,40,30);return c.toDataURL('image/png').split(',')[1];}''')
        return {'name':'image.png','mimeType':'image/png','buffer':base64.b64decode(data)}

    def test_text_quotes_cannot_create_attributes(self):
        text = 'Фраза " onfocus="window.echoInjected=1'
        self.create('Кавычки <>&', text)
        speech=self.page.locator('.custom-card .card-speak')
        expect(speech).to_have_attribute('aria-label',text)
        self.assertIsNone(speech.get_attribute('onfocus'))
        speech.focus()
        self.assertIsNone(self.page.evaluate('window.echoInjected'))
        self.page.reload()
        expect(self.page.locator('.custom-card .phrase-text')).to_have_text(text)

    def test_latest_image_decode_keeps_save_disabled(self):
        p=self.page
        p.locator('.add-button').click()
        p.evaluate('''() => {window.decodeGates=[]; window.originalBitmap=createImageBitmap;
            window.createImageBitmap=(...args) => new Promise(resolve => decodeGates.push(() => resolve(originalBitmap(...args))));}''')
        image=self.image()
        p.locator('#echoCardImage').set_input_files(image)
        p.wait_for_function('decodeGates.length === 1')
        p.locator('#echoCardImage').set_input_files({**image,'name':'second.png'})
        p.wait_for_function('decodeGates.length === 2')
        p.evaluate('() => decodeGates[0]()')
        p.wait_for_timeout(100)
        expect(p.locator('#savePhrase')).to_be_disabled()
        p.evaluate('() => decodeGates[1]()')
        expect(p.locator('#savePhrase')).to_be_enabled()
        expect(p.locator('#echoImagePreview')).to_be_visible()

    def test_async_image_save_preserves_other_card_updates(self):
        p=self.page
        self.create('Первая')
        p.locator('.custom-card .edit-card').click()
        p.locator('#newPhraseName').fill('Изменена')
        p.locator('#echoCardImage').set_input_files(self.image())
        expect(p.locator('#echoImagePreview')).to_be_visible()
        p.evaluate('''() => {window.originalImageStore=echoImageStore;
          echoImageStore=async (action,value) => {const result=await originalImageStore(action,value);
            if(action==='put') await new Promise(resolve => window.finishImageWrite=resolve); return result;};}''')
        p.locator('#savePhrase').click()
        p.wait_for_function('typeof finishImageWrite === "function"')
        p.evaluate('''() => {const cards=getCustomPhrases(); cards.push({id:'other-tab',name:'Другая',text:'Не терять',emoji:'💧'});
            localStorage.setItem('echoCustomPhrases',JSON.stringify(cards)); finishImageWrite();}''')
        expect(p.locator('#addPhraseModal')).not_to_have_class('modal open')
        self.assertEqual([c['name'] for c in p.evaluate('getCustomPhrases()')], ['Изменена','Другая'])

    def test_corrupt_category_items_do_not_break_app_or_overwrite_data(self):
        p=self.page
        p.evaluate('localStorage.setItem("echoUserCategories", "[null]")')
        p.reload()
        expect(p.locator('#echoSentence')).to_be_visible()
        self.assertEqual(self.errors, [])
        p.locator('.echo-add-category').click()
        p.locator('#echoNewCategoryName').fill('Новая')
        p.locator('#echoSaveCategory').click()
        self.assertEqual(p.evaluate('localStorage.getItem("echoUserCategories")'),'[null]')
        self.assertIsNone(p.evaluate('localStorage.getItem("echoCategoryState")'))

    def test_rapid_delete_and_sequential_edit_preserve_legacy_data(self):
        p=self.page
        legacy=[{'id':i,'name':f'Карточка {i}','text':f'Текст {i}','emoji':'💧','legacyField':'сохранить'} for i in range(4)]
        p.evaluate('(cards) => localStorage.setItem("echoCustomPhrases",JSON.stringify(cards))',legacy)
        p.reload()
        for name in ['Первое изменение','Второе изменение']:
            p.locator('.custom-card').last.locator('.edit-card').click()
            p.locator('#newPhraseName').fill(name);p.locator('#savePhrase').click()
            expect(p.locator('#addPhraseModal')).not_to_have_class('modal open')
        for _ in range(3): p.locator('.custom-card').first.locator('.delete-card').click()
        p.locator('.undo-delete').click()
        cards=p.evaluate('getCustomPhrases()')
        self.assertEqual([c['id'] for c in cards],[2,3])
        self.assertTrue(all(c['legacyField']=='сохранить' for c in cards))
        p.reload()
        expect(p.locator('.custom-card')).to_have_count(2)
        self.assertEqual(p.evaluate('getCustomPhrases()'),cards)

    def test_legacy_favorites_quota_does_not_abort_startup(self):
        p=self.page
        raw='["default:Я хочу пить"]'
        p.evaluate('(raw) => localStorage.setItem("echoFavorites", raw)',raw)
        p.add_init_script("""const set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v) {
            if(k==='echoFavorites') throw new DOMException('full','QuotaExceededError'); return set.call(this,k,v); };""")
        p.reload()
        expect(p.locator('#echoSentence')).to_be_visible()
        self.assertEqual(p.evaluate('localStorage.getItem("echoFavorites")'),raw)
        self.assertEqual(self.errors,[])

    def test_category_delete_uses_separate_keyboard_button(self):
        p=self.page
        self.create('Сохранить карточку')
        p.locator('.echo-add-category').click();p.locator('#echoNewCategoryName').fill('Категория')
        p.locator('#echoSaveCategory').click()
        self.assertEqual(p.locator('.echo-category-list button [role="button"], .echo-category-list button button').count(),0)
        remove=p.locator('.echo-category-delete-btn')
        self.assertGreaterEqual(remove.bounding_box()['height'],44)
        remove.focus();p.keyboard.press('Enter')
        expect(p.locator('.echo-user-category')).to_have_count(0)
        expect(p.locator('.custom-card')).to_have_count(1)
        p.reload();expect(p.locator('.custom-card')).to_have_count(1)

    def test_editor_returns_keyboard_focus_after_cancel_and_save(self):
        p=self.page
        add=p.locator('.add-button');add.focus();p.keyboard.press('Enter')
        expect(p.locator('#newPhraseName')).to_be_focused()
        p.keyboard.press('Escape');expect(add).to_be_focused()
        self.create('Фокус')
        edit=p.locator('.custom-card .edit-card');edit.focus();p.keyboard.press('Enter')
        p.locator('#newPhraseName').fill('Фокус после редактирования')
        p.locator('#savePhrase').click()
        expect(p.locator('.custom-card .edit-card')).to_be_focused()

    def test_quota_rolls_back_favorites_quick_phrases_and_categories(self):
        p=self.page
        self.create('Сохранённая')
        p.evaluate("""() => {const set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v) {
          if(['echoFavorites','echoPinnedPhrases','echoCategoryState'].includes(k)) throw new DOMException('full','QuotaExceededError');
          return set.call(this,k,v); };}""")
        p.locator('.custom-card .favorite-star').click()
        self.assertEqual(p.evaluate('favorites'),[])
        p.locator('.custom-card .echo-pin-button').click()
        self.assertEqual(p.evaluate('echoPinnedPhrases'),[])
        p.locator('.echo-add-category').click();p.locator('#echoNewCategoryName').fill('Не сохранена')
        p.locator('#echoSaveCategory').click()
        expect(p.locator('#echoNewCategoryName')).to_be_visible()
        expect(p.locator('.echo-user-category')).to_have_count(0)
        self.assertIsNone(p.evaluate('localStorage.getItem("echoCategoryState")'))
        self.assertEqual(self.errors,[])

    def test_error_and_order_text_contrast_in_both_themes(self):
        import re
        p=self.page
        self.create('Контраст')
        p.locator('.echo-add-category').click();p.locator('#echoNewCategoryName').fill('Контраст')
        p.locator('#echoSaveCategory').click()
        p.locator('.add-button').click()
        p.evaluate('() => {echoShowSaveError(); document.getElementById("echoImageError").textContent="Ошибка изображения";}')
        def luminance(color):
            values=[int(v)/255 for v in re.findall(r'[0-9]+',color)[:3]]
            rgb=[v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values]
            return sum(a*b for a,b in zip(rgb,[.2126,.7152,.0722]))
        for dark in [False,True]:
            p.evaluate('(dark) => document.body.classList.toggle("dark-theme",dark)',dark)
            for selector in ['#echoSaveError','#echoImageError','.echo-order-actions button','.echo-category-delete-btn']:
                colors=p.locator(selector).first.evaluate("""e => {let parent=e,bg;
                  while(parent) {bg=getComputedStyle(parent).backgroundColor; if(bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent') break;parent=parent.parentElement;}
                  return {fg:getComputedStyle(e).color,bg};}""")
                f,b=luminance(colors['fg']),luminance(colors['bg'])
                self.assertGreaterEqual((max(f,b)+.05)/(min(f,b)+.05),4.5,(dark,selector,colors))

    def test_filtered_order_with_legacy_categories_search_and_favorites(self):
        p=self.page
        cards=[{'id':k,'name':name,'text':name,'emoji':'💧'} for k,name in [('a','Общее А'),('b','Другое Б'),('c','Общее В'),('d','Другое Г')]]
        p.evaluate("""cards => {
            localStorage.setItem('echoCustomPhrases',JSON.stringify(cards));
            localStorage.setItem('echoUserCategories',JSON.stringify([{id:'user-legacy',name:'Прежняя',icon:'📁'}]));
            localStorage.setItem('echoCardCategories',JSON.stringify({a:'user-legacy',c:'user-legacy'}));
            localStorage.setItem('echoFavorites',JSON.stringify(['custom:a','custom:c']));
        }""",cards)
        p.reload()
        p.locator('.echo-user-category').click()
        visible=p.locator('.custom-card:visible')
        expect(visible).to_have_count(2)
        visible.last.locator('.echo-order-actions button').first.click()
        self.assertEqual(visible.evaluate_all('cards=>cards.map(c=>c.dataset.id)'),['c','a'])
        p.reload();p.locator('[data-category="all"]').first.click()
        p.locator('#echoSearchInput').fill('Общее')
        expect(visible).to_have_count(2)
        visible.last.locator('.echo-order-actions button').first.click()
        self.assertEqual(visible.evaluate_all('cards=>cards.map(c=>c.dataset.id)'),['a','c'])
        p.locator('#echoSearchInput').fill('');p.locator('#favoritesTab').click()
        visible.last.locator('.echo-order-actions button').first.click()
        p.reload();p.locator('#favoritesTab').click()
        self.assertEqual(visible.evaluate_all('cards=>cards.map(c=>c.dataset.id)'),['c','a'])
        self.assertEqual([c['id'] for c in p.evaluate('getCustomPhrases()')],['c','a','b','d'])
        self.assertEqual(p.evaluate('JSON.parse(localStorage.getItem("echoCardCategories"))'),{'a':'user-legacy','c':'user-legacy'})
        self.assertEqual(self.errors,[])

    def test_conflicting_card_edit_stays_open_and_cleans_new_image(self):
        p=self.page
        self.create('Исходная')
        p.locator('.custom-card .edit-card').click()
        p.locator('#newPhraseName').fill('Моя правка')
        p.locator('#echoCardImage').set_input_files(self.image())
        expect(p.locator('#echoImagePreview')).to_be_visible()
        p.evaluate("""() => {window.originalImageStore=echoImageStore;
          echoImageStore=async (action,value) => {const result=await originalImageStore(action,value);
            if(action==='put') await new Promise(resolve => window.finishImageWrite=resolve); return result;};}""")
        p.locator('#savePhrase').click();p.wait_for_function('typeof finishImageWrite === "function"')
        p.evaluate("""() => {const cards=getCustomPhrases(); cards[0].name='Правка другой вкладки';
          localStorage.setItem('echoCustomPhrases',JSON.stringify(cards));finishImageWrite();}""")
        expect(p.locator('#echoSaveError')).to_contain_text('другой вкладке')
        expect(p.locator('#newPhraseName')).to_have_value('Моя правка')
        self.assertEqual(p.evaluate('getCustomPhrases()[0].name'),'Правка другой вкладки')
        p.wait_for_function('async () => (await originalImageStore("getAll")).length === 0')

    def test_image_fits_icon_without_covering_title(self):
        p=self.page
        self.create('Фото карточки','Хочу домой')
        p.locator('.custom-card .edit-card').click()
        p.locator('#echoCardImage').set_input_files(self.image())
        expect(p.locator('#echoImagePreview')).to_be_visible()
        p.locator('#savePhrase').click()
        expect(p.locator('.custom-card img')).to_be_visible()
        for width in [320,375,390,768,1280]:
            p.set_viewport_size({'width':width,'height':900})
            rects=p.locator('.custom-card').evaluate("""c => Object.fromEntries(['.phrase-icon','img','.phrase-name'].map(s=>[s,c.querySelector(s).getBoundingClientRect().toJSON()]))""")
            icon,image,title=rects['.phrase-icon'],rects['img'],rects['.phrase-name']
            self.assertLessEqual(image['bottom'],icon['bottom']+.5,width)
            self.assertLessEqual(image['right'],icon['right']+.5,width)
            self.assertLessEqual(image['bottom'],title['top'],width)
            self.assertEqual(p.locator('.custom-card img').evaluate('e=>getComputedStyle(e).objectFit'),'contain')

    def test_layout_focus_and_control_overlap(self):
        p=self.page
        self.create('Длинная карточка','Текст для проверки управления')
        for width in [320,375,390,768,1280]:
            p.set_viewport_size({'width':width,'height':900})
            self.assertTrue(p.evaluate('document.documentElement.scrollWidth <= innerWidth'),width)
            card=p.locator('.custom-card')
            speech=card.locator('.card-speak');p.keyboard.press('Tab');speech.focus()
            self.assertEqual(speech.evaluate('e => getComputedStyle(e).outlineStyle'),'solid')
            geometry=card.evaluate("""c => ({text:c.querySelector('.phrase-text').getBoundingClientRect().toJSON(),
                controls:[...c.querySelectorAll('button:not(.card-speak)')].map(e=>({class:e.className,...e.getBoundingClientRect().toJSON()}))})""")
            rect=geometry['text']
            for bounds in geometry['controls']:
                self.assertGreaterEqual(bounds['height'],44)
                overlap=min(rect['x']+rect['width'],bounds['x']+bounds['width'])>max(rect['x'],bounds['x']) and min(rect['y']+rect['height'],bounds['y']+bounds['height'])>max(rect['y'],bounds['y'])
                self.assertFalse(overlap, (width,bounds['class']))
        self.assertEqual(p.locator('.phrase-card button button, .phrase-card button [role="button"]').count(),0)
        self.assertEqual(self.errors,[])

if __name__ == '__main__': unittest.main(verbosity=2)
