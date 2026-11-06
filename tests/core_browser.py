"""Core-card integration checks using the real browser and persistent IndexedDB."""
import base64
import json
from playwright.sync_api import sync_playwright, expect

URL = 'http://127.0.0.1:8000'

def main():
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':390, 'height':844})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        accept_dialog = lambda d: d.accept()
        page.on('dialog', accept_dialog)
        page.goto(URL)
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        def create(name, image=None):
            page.locator('.add-button').click()
            page.locator('#newPhraseName').fill(name)
            page.locator('#newPhraseText').fill('Текст ' + name)
            if image:
                page.locator('#echoCardImage').set_input_files(image)
                expect(page.locator('#echoImagePreview')).to_be_visible()
                expect(page.locator('#savePhrase')).to_be_enabled()
            page.locator('#savePhrase').click()
            expect(page.locator('#addPhraseModal')).not_to_have_class('modal open')
        def order():
            return page.locator('.custom-card .phrase-name').all_text_contents()
        def names(): return [n.strip() for n in order()]
        create('Старая')
        create('Вторая')
        assert names() == ['Старая','Вторая']
        page.locator('.custom-card').nth(1).get_by_role('button',name='Вверх: Вторая',exact=True).focus()
        page.keyboard.press('Enter')
        assert names() == ['Вторая','Старая']
        page.reload(); assert names() == ['Вторая','Старая']
        checks.append('create, keyboard order and reload')
        page.locator('.custom-card').first.locator('.edit-card').click()
        page.locator('#newPhraseName').fill('Изменена')
        page.locator('#savePhrase').click()
        assert names() == ['Изменена','Старая']
        page.locator('.custom-card').first.locator('.delete-card').click()
        page.locator('.undo-delete').click()
        assert names() == ['Изменена','Старая']
        checks.append('edit, delete and five-second undo preserve order')
        for mime, extension in [('image/jpeg','jpg'),('image/png','png'),('image/webp','webp')]:
            data = page.evaluate('''mime => { const c=document.createElement('canvas'); c.width=1200;c.height=900;
                c.getContext('2d').fillRect(0,0,1200,900);return c.toDataURL(mime).split(',')[1]; }''', mime)
            create(extension, {'name':'photo.'+extension,'mimeType':mime,'buffer':base64.b64decode(data)})
            expect(page.locator('.custom-card').last.locator('img')).to_be_visible()
        stored = page.evaluate('async () => (await echoImageStore("getAll")).map(i => ({size:i.blob.size,type:i.blob.type}))')
        assert len(stored) == 3 and all(i['size'] <= 1048576 for i in stored)
        assert 'base64' not in page.evaluate('localStorage.getItem("echoCustomPhrases")')
        page.reload(); expect(page.locator('.echo-card-image')).to_have_count(3)
        context.set_offline(True); page.reload(); expect(page.locator('.echo-card-image')).to_have_count(3)
        context.set_offline(False)
        checks.append('JPEG/PNG/WebP resize, IndexedDB, reload and offline images')
        page.locator('.custom-card').last.locator('.edit-card').click()
        old_image = page.evaluate('getCustomPhrases().at(-1).imageId')
        page.locator('#echoCardImage').set_input_files({'name':'replacement.webp','mimeType':'image/webp','buffer':base64.b64decode(data)})
        expect(page.locator('#echoImagePreview')).to_be_visible()
        expect(page.locator('#savePhrase')).to_be_enabled()
        page.locator('#savePhrase').click()
        expect(page.locator('#addPhraseModal')).not_to_have_class('modal open')
        assert page.evaluate('getCustomPhrases().at(-1).imageId') != old_image
        page.wait_for_function('async () => (await echoImageStore("getAll")).length === 3')

        page.locator('.custom-card').last.locator('.edit-card').click()
        page.locator('#echoCardImage').set_input_files({'name':'bad.svg','mimeType':'image/svg+xml','buffer':b'<svg onload="alert(1)"/>'})
        expect(page.locator('#echoImageError')).to_contain_text('JPEG')
        page.locator('#echoCardImage').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'bad'})
        expect(page.locator('#echoImageError')).not_to_be_empty()
        page.locator('#echoCardImage').set_input_files({'name':'large.png','mimeType':'image/png','buffer':b'0'*(8*1024*1024+1)})
        expect(page.locator('#echoImageError')).to_contain_text('8 МБ')
        page.locator('#echoRemoveImage').click(); page.locator('#savePhrase').click()
        expect(page.locator('.echo-card-image')).to_have_count(2)
        assert page.evaluate('async () => (await echoImageStore("getAll")).length') == 2
        checks.append('invalid/corrupt/oversized files rejected and image removal cleans IndexedDB')
        # Management controls must never reach the speech pipeline.
        page.evaluate('() => {window.spoken=[]; speak = text => window.spoken.push(text);}')
        page.locator('.custom-card').last.get_by_role('button',name='Вверх: webp',exact=True).click()
        assert page.evaluate('window.spoken') == [], page.evaluate('window.spoken')
        page.locator('.custom-card').filter(has_text='webp').locator('.card-speak').click()
        assert page.evaluate('window.spoken') == ['Текст webp']
        assert page.locator('button button, button [role="button"]').filter(has=page.locator('.phrase-card')).count() == 0
        assert page.locator('.phrase-card button button, button.phrase-card [role="button"]').count() == 0
        checks.append('speech text retained; order does not speak; separate native buttons')
        # Filtered reordering uses visible neighbors and one persisted order.
        for card in [page.locator('.custom-card').nth(0), page.locator('.custom-card').nth(2)]: card.locator('.favorite-star').click()
        page.locator('#favoritesTab').click()
        visible = page.locator('.custom-card:visible')
        before = visible.locator('.phrase-name').all_text_contents()
        visible.last.locator('.echo-order-actions button').first.click()
        assert visible.locator('.phrase-name').all_text_contents() == list(reversed(before))
        page.locator('#phrasesTab').click()
        page.locator('#echoSearchInput').fill('Текст webp')
        expect(page.locator('.custom-card:visible')).to_have_count(1)
        page.locator('#echoSearchInput').fill('')
        checks.append('favorites, search and filtered reordering')
        page.locator('.echo-add-category').click()
        page.locator('#echoNewCategoryName').fill('Моя категория')
        page.locator('#echoSaveCategory').click()
        category_id = page.locator('.echo-user-category').first.get_attribute('data-category')
        # Existing category chooser is a native prompt; choose the user category.
        def choose_category(dialog): dialog.accept('2')
        page.remove_listener('dialog', accept_dialog)
        page.on('dialog', choose_category)
        page.locator('.custom-card').first.locator('.echo-move-card').click()
        page.remove_listener('dialog', choose_category); page.on('dialog', accept_dialog)
        page.locator(f'[data-category="{category_id}"]').first.click()
        expect(page.locator('.custom-card:visible')).to_have_count(1)
        page.reload()
        page.locator(f'[data-category="{category_id}"]').first.click()
        expect(page.locator('.custom-card:visible')).to_have_count(1)
        page.locator('[data-category="all"]').first.click()
        page.locator('.custom-card').first.locator('.echo-pin-button').click()
        page.reload()
        assert page.evaluate('JSON.parse(localStorage.getItem("echoPinnedPhrases")).length') == 1
        checks.append('custom categories, card assignment and quick phrases survive reload')
        # An IndexedDB write failure cannot commit card metadata.
        before_image = page.evaluate('localStorage.getItem("echoCustomPhrases")')
        page.locator('.add-button').click()
        page.locator('#newPhraseName').fill('Сбой изображения'); page.locator('#newPhraseText').fill('Текст')
        page.locator('#echoCardImage').set_input_files({'name':'photo.webp','mimeType':'image/webp','buffer':base64.b64decode(data)})
        expect(page.locator('#echoImagePreview')).to_be_visible()
        page.evaluate('() => {window.originalImageStore=echoImageStore; echoImageStore=(a,v) => a==="put" ? Promise.reject(new Error("quota")) : originalImageStore(a,v);}')
        page.locator('#savePhrase').click(); expect(page.locator('#echoSaveError')).to_be_visible()
        assert page.evaluate('localStorage.getItem("echoCustomPhrases")') == before_image
        page.evaluate('() => {echoImageStore=window.originalImageStore;}')
        page.locator('#closeModal').click()
        checks.append('IndexedDB failure never reports a saved card')
        for width in [320,390,768,1280]:
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.set_viewport_size({'width':390,'height':844})
        # Quota errors cannot close the editor or alter persisted metadata.
        before = page.evaluate('localStorage.getItem("echoCustomPhrases")')
        page.evaluate('() => {window.originalSet=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k==="echoCustomPhrases")throw new DOMException("full","QuotaExceededError");return originalSet.call(this,k,v)};}')
        page.locator('.add-button').click(); page.locator('#newPhraseName').fill('Ошибка'); page.locator('#newPhraseText').fill('Не терять')
        page.locator('#savePhrase').click(); expect(page.locator('#echoSaveError')).to_be_visible()
        expect(page.locator('#newPhraseText')).to_have_value('Не терять')
        assert page.evaluate('localStorage.getItem("echoCustomPhrases")') == before
        page.locator('#closeModal').click()
        count = page.locator('.custom-card').count()
        page.locator('.custom-card').first.locator('.delete-card').click()
        page.wait_for_timeout(5200)
        expect(page.locator('.custom-card')).to_have_count(count)
        page.evaluate('() => {Storage.prototype.setItem=window.originalSet;}')
        checks.append('quota error keeps editor text and restores failed deletion')
        count = page.locator('.custom-card').count()
        page.locator('.custom-card').last.locator('.delete-card').click()
        page.reload()
        expect(page.locator('.custom-card')).to_have_count(count - 1)
        checks.append('leaving during undo countdown persists deletion')

        # Corrupt metadata is preserved, including when the user attempts to add a card.
        page.evaluate('localStorage.setItem("echoCustomPhrases", "broken json")'); page.reload()
        page.locator('.add-button').click(); page.locator('#newPhraseName').fill('Новая'); page.locator('#newPhraseText').fill('Текст')
        page.locator('#savePhrase').click(); expect(page.locator('#echoSaveError')).to_be_visible()
        assert page.evaluate('localStorage.getItem("echoCustomPhrases")') == 'broken json'
        checks.append('corrupt card data is never overwritten')
        page.locator('#closeModal').click()
        for width in [320,390,768,1280]:
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        assert errors == [], errors
        checks.append('320–1280px layouts and no uncaught JS errors')
        browser.close()
    print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))

if __name__ == '__main__': main()
