/* Presentation only: system icons are replaced; personal symbols/data are untouched. */
(() => {
  'use strict';
  const paths = {
    message:'M4 4h16v12H9l-5 4V4Z', star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
    plus:'M12 4v16M4 12h16', settings:'M4 7h16M4 17h16M8 4v6M16 14v6', history:'M4 5v5h5M4.5 9A8 8 0 1 1 4 15M12 7v5l3 2',
    pin:'m8 3 8 0-1 6 3 3H6l3-3-1-6ZM12 12v9', sos:'M12 3 2 21h20L12 3ZM12 9v5M12 17v1', water:'M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z',
    folder:'M3 6h7l2 2h9v12H3V6ZM3 6V4h7l2 2',
    food:'M5 3v7M9 3v7M5 7h4M7 10v11M17 3c-4 3-4 8 0 8v10M17 3v8', home:'m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7',
    check:'m5 12 4 4L19 6', no:'m6 6 12 12M18 6 6 18', speaker:'m4 9 4 0 5-5v16l-5-5H4V9ZM16 8c3 2 3 6 0 8M19 5c5 4 5 10 0 14',
    heart:'M12 21 3 12C-3 4 7-1 12 6c5-7 15-2 9 6l-9 9Z', grid:'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM15 15l6 6'
  };
  function icon(node, name) {
    if (!node || (node.firstElementChild?.dataset.echoIcon === name && node.childNodes.length === 1)) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.dataset.echoIcon=name;svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);node.replaceChildren(svg);
  }
  function decorate() {
    icon(document.querySelector('.settings-btn'),'settings');
    icon(document.querySelector('.speak-custom'),'speaker');
    const nav={'phrasesTab':'message','favoritesTab':'star','settingsTab':'settings'};
    for(const [id,name] of Object.entries(nav))icon(document.querySelector('#'+id+' > span:first-child'),name);
    for(const [selector,name] of [['.add-button','plus'],['.echo-history-nav','history'],['.echo-quick-nav','pin'],['.echo-sos-nav','sos']])icon(document.querySelector(selector+' > span:first-child'),name);
    document.querySelectorAll('.phrase-card:not(.custom-card)').forEach((card,i)=>icon(card.querySelector('.phrase-icon'),['water','food','sos','home','check','no'][i%6]));
    document.querySelectorAll('.sound-icon').forEach(e=>icon(e,'speaker'));
    document.querySelectorAll('.favorite-star').forEach(e=>icon(e,'star'));
    document.querySelectorAll('.echo-pin-button').forEach(e=>icon(e,'pin'));
    document.querySelectorAll('.echo-move-card').forEach(e=>icon(e,'folder'));
    for(const [id,name]of Object.entries({all:'grid',food:'food',help:'sos',health:'heart',communication:'message',custom:'plus'}))icon(document.querySelector(`.echo-category-button[data-category="${id}"] > span:first-child`),name);
    icon(document.querySelector('.echo-search-icon'),'search');
  }
  // Work once per mutation batch; never observe personal input values or storage.
  let queued=false;
  new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;decorate();});}}).observe(document.querySelector('.app'),{childList:true,subtree:true});
  decorate();
})();
