/* Lightweight accessibility layer over the existing ECHO screens and actions. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = document.createElement('section');
  panel.className='echo-local-panel echo-accessibility-panel';panel.hidden=true;
  panel.innerHTML='<h3>Удобство общения</h3><label class="echo-history-choice"><input id="echoSimpleMode" type="checkbox"> Простой режим</label><p>Крупные карточки и четыре раздела. SOS остаётся доступен. Выключите переключатель, чтобы вернуть все настройки и управление карточками.</p><p id="echoAccessStatus" role="status" aria-live="polite"></p>';
  document.querySelector('main').prepend(panel);
  let simple=false;try{simple=localStorage.getItem('echoSimpleMode')==='true';}catch{}
  function applySimple(value){simple=value;document.body.classList.toggle('simple-mode',value);$('echoSimpleMode').checked=value;measure();}
  $('echoSimpleMode').onchange=()=>{const next=$('echoSimpleMode').checked;try{localStorage.setItem('echoSimpleMode',String(next));applySimple(next);$('echoAccessStatus').textContent=next?'Простой режим включён. Все данные сохранены.':'Обычный режим включён.';}catch{applySimple(simple);$('echoAccessStatus').textContent='Не удалось сохранить режим. Изменения отменены.';}};
  const contrast=document.createElement('button');contrast.type='button';contrast.className='theme-option';contrast.dataset.theme='contrast';contrast.textContent='◐ Высококонтрастная';themePanel.querySelector('.theme-options')?.append(contrast);
  if(!contrast.isConnected)themePanel.append(contrast);
  contrast.setAttribute('aria-pressed',String(document.body.classList.contains('contrast-theme')));contrast.classList.toggle('active',document.body.classList.contains('contrast-theme'));
  const dock=document.createElement('div');dock.className='echo-action-dock';dock.setAttribute('role','group');dock.setAttribute('aria-label','Быстрые действия общения');
  dock.innerHTML='<button type="button" id="echoDockStop">■ Остановить голос</button><button type="button" id="echoDockCompose">Собрать сообщение</button>';
  document.querySelector('.app').append(dock);
  $('echoDockStop').onclick=()=>{window.echoStopSpeech?.();window.echoSpeechNotice?.('Озвучка остановлена');};
  $('echoDockCompose').onclick=()=>{$('phrasesTab').click();$('echoSentence').scrollIntoView({block:'center',behavior:'instant'});$('echoSentence').focus({preventScroll:true});};
  const skip=document.createElement('a');skip.href='#echoMain';skip.className='echo-skip-link';skip.textContent='Перейти к общению';document.querySelector('.app').prepend(skip);
  document.querySelector('main').id='echoMain';document.querySelector('main').tabIndex=-1;
  phraseGrid.setAttribute('aria-label','Карточки фраз');
  for(const icon of document.querySelectorAll('.nav-item > span:first-child'))icon.setAttribute('aria-hidden','true');
  function decorate(root){for(const e of root.querySelectorAll('.phrase-icon,.sound-icon'))e.setAttribute('aria-hidden','true');
    for(const b of root.querySelectorAll('button[role="button"]')){b.removeAttribute('role');b.removeAttribute('tabindex');}}
  function syncEmoji(){for(const button of emojiButtons){button.setAttribute('aria-pressed',String(button.classList.contains('selected')));button.setAttribute('aria-label','Иконка '+button.textContent.trim());}}
  syncEmoji();new MutationObserver(syncEmoji).observe(document.querySelector('.emoji-list'),{subtree:true,attributes:true,attributeFilter:['class']});
  decorate(document);new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)decorate(n);}).observe(phraseGrid,{childList:true});
  // Preserve native button semantics while announcing which screen is open.
  // "Add" launches an editor, not a persistent page, so it is never aria-current.
  function syncNavCurrent(){
    const buttons=[...document.querySelectorAll('.nav-item')];
    const active=buttons.find(button=>button.classList.contains('active')&&!button.classList.contains('add-button'));
    for(const button of buttons){
      if(button===active)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
  }
  const navCurrentObserver=new MutationObserver(records=>{
    if(records.some(record=>record.type==='attributes'&&record.attributeName==='class'&&record.target.matches('.nav-item')))syncNavCurrent();
  });
  navCurrentObserver.observe(document.querySelector('.app'),{attributes:true,subtree:true,attributeFilter:['class']});
  syncNavCurrent();
  // Optional motor-access navigation: arrow keys move between visible phrase actions.
  // Tab/Shift+Tab continue to work normally; never intercept when editing text.
  phraseGrid.addEventListener('keydown',event=>{
    const direction={ArrowRight:1,ArrowLeft:-1,ArrowDown:2,ArrowUp:-2};
    if(!Object.hasOwn(direction,event.key)&&event.key!=='Home'&&event.key!=='End')return;
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const active=event.target;
    const card=active.closest?.('.phrase-card');
    if(!card||!phraseGrid.contains(card))return;
    const primary=card.querySelector('.card-speak')||(card.matches('button')?card:null);
    if(active!==primary)return;
    const cards=[...phraseGrid.querySelectorAll('.phrase-card')]
      .filter(c=>!c.hidden&&!c.closest('[hidden]')&&c.getClientRects().length);
    const items=cards.map(c=>c.querySelector('.card-speak')||(c.matches('button')?c:null));
    const index=items.indexOf(primary);
    if(index<0)return;
    // Use actual grid columns, not hardcoded viewport assumptions.
    const columns=Math.max(1,getComputedStyle(phraseGrid).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
    const offset=event.key==='ArrowDown'?columns:event.key==='ArrowUp'?-columns:direction[event.key];
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:index+offset;
    if(next<0||next>=items.length||!items[next])return;
    event.preventDefault();
    items[next].focus({preventScroll:true});
    items[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  });
  const nav=document.querySelector('.bottom-nav');
  function measure(){document.documentElement.style.setProperty('--echo-nav-height',nav.getBoundingClientRect().height+'px');document.documentElement.style.setProperty('--echo-dock-height',dock.getBoundingClientRect().height+'px');}
  new ResizeObserver(measure).observe(nav);new ResizeObserver(measure).observe(dock);
  const viewport=window.visualViewport;
  function keyboard(){const input=document.activeElement?.matches('input:not([type=checkbox]):not([type=range]),textarea,select');document.body.classList.toggle('echo-keyboard-open',!!input&&!!viewport&&innerHeight-viewport.height>120);}
  viewport?.addEventListener('resize',keyboard);document.addEventListener('focusin',keyboard);document.addEventListener('focusout',()=>queueMicrotask(keyboard));
  function route(){panel.hidden=document.body.dataset.echoSection!=='settings';measure();}
  new MutationObserver(route).observe(document.body,{attributes:true,attributeFilter:['data-echo-section']});
  // Native controls retain the existing dialog open/close and focus-return paths.
  let current=null,isolated=[];
  function restoreSiblings(){for(const [e,value]of isolated)e.inert=value;isolated=[];}
  function syncModal(){const next=!echoCategoryModal.hidden?echoCategoryModal:modal.classList.contains('open')?modal:null;if(next===current)return;const previous=current;restoreSiblings();current=next;if(!next){if(previous)queueMicrotask(()=>{let target=previous===echoCategoryModal?echoPreviousFocus:echoModalReturnFocus;if(!target?.isConnected){const id=target?.closest('.custom-card')?.dataset.id;target=[...phraseGrid.querySelectorAll('.custom-card')].find(c=>c.dataset.id===id)?.querySelector('.edit-card')||document.querySelector('.echo-add-category');}target?.focus();});return;}
    let branch=next;while(branch.parentElement&&branch!==document.body){for(const sibling of branch.parentElement.children)if(sibling!==branch&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){isolated.push([sibling,sibling.inert]);sibling.inert=true;}branch=branch.parentElement;}
  }
  const observer=new MutationObserver(syncModal);observer.observe(modal,{attributes:true,attributeFilter:['class']});observer.observe(echoCategoryModal,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('keydown',event=>{if(!current)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();current===echoCategoryModal?echoCloseCategoryModal():closeAddModal();syncModal();return;}
    if(event.key!=='Tab')return;const items=[...current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(e=>!e.disabled&&e.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}},true);
  // Restore background interactivity before the old focus-return observers run.
  for(const button of [$('closeModal'),$('echoCancelCategory')])button.addEventListener('click',()=>queueMicrotask(()=>{syncModal();}),true);
  applySimple(simple);route();
})();
