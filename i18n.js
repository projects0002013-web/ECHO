/* One local catalog, plain-text bindings and the existing language-setting event. */
(() => {
  'use strict';
  const normalize = s => String(s).replace(/\s+/g,' ').trim();
  const supported=['ru','kk','en','be'];let language='ru',catalog,reverse,patterns,literals;
  try {const saved=localStorage.getItem('echoLanguage');if(supported.includes(saved))language=saved;} catch {}
  const textBindings=new WeakMap(),attributeBindings=new WeakMap(),missing=new Set();
  const userText = e => !!e?.closest('script,style,textarea,[data-language],.custom-card .card-speak,.echo-user-category > span,.echo-history-text,.echo-history-time,.echo-quick-text,.echo-quick-emoji,#echoWordChoices,[data-no-i18n]');
  function format(key,vars={},lang=language){const value=catalog?.messages[lang]?.[key]??catalog?.messages.ru[key];if(value===undefined){missing.add(key);return key;}return value.replace(/\{(v\d+)\}/g,(m,k)=>Object.hasOwn(vars,k)?String(vars[k]):m);}
  function resolve(text){const s=normalize(text);return catalog.messages.ru[s]!==undefined?s:catalog.aliases[s]||reverse.get(s);}
  function translate(text){const raw=String(text),s=normalize(raw);if(!s)return raw;
    const key=resolve(s);if(key)return format(key);
    for(const p of patterns){const match=p.regex.exec(s);if(match){const vars={};p.names.forEach((name,i)=>vars[name]=match[i+1]);if(p.key.startsWith('Карточек:')){const k=resolve(vars.v3);if(k)vars.v3=format(k);}return format(p.key,vars);}}
    // Composite status/error/prompt messages retain variable contents verbatim.
    let found=false;const translated=s.replace(literals.regex,part=>{found=true;return format(literals.keys.get(part));});
    if(found)return translated;
    // Icons are decoration around message keys, not independent translation entries.
    const icon=s.match(/^([^\p{L}\p{N}]+\s*)(.+)$/u);if(icon){const k=resolve(icon[2]);if(k)return icon[1]+format(k);}
    if(/[А-Яа-яЁё]/.test(s))missing.add(s);return raw;
  }
  function nodeText(node){if(userText(node.parentElement))return;let saved=textBindings.get(node);if(!saved||node.nodeValue!==saved.current)saved={source:node.nodeValue,current:node.nodeValue};
    // Do not bind arbitrary user values or numbers; only catalog-defined UI messages.
    const value=translate(saved.source);if(value!==saved.source||resolve(saved.source)||patterns.some(p=>p.regex.test(normalize(saved.source)))){
      const leading=saved.source.match(/^\s*/)[0],trailing=saved.source.match(/\s*$/)[0];saved.current=leading+normalize(value)+trailing;textBindings.set(node,saved);if(node.nodeValue!==saved.current)node.nodeValue=saved.current;
    }
  }
  const attrs=['aria-label','aria-description','placeholder','title','alt','content'];
  function element(e){if(e?.dataset?.language&&supported.includes(e.dataset.language)&&e.lang!==e.dataset.language)e.lang=e.dataset.language;if(!e?.getAttribute||e.closest('script,style'))return;
    for(const attr of attrs){if(!e.hasAttribute(attr))continue;if((attr==='aria-label'&&e.matches('.custom-card .card-speak'))||e.closest('[data-no-i18n]'))continue;
      let binding=attributeBindings.get(e);if(!binding){binding={};attributeBindings.set(e,binding);}let saved=binding[attr];const current=e.getAttribute(attr);if(!saved||current!==saved.current)saved={source:current,current};const next=translate(saved.source);saved.current=next;binding[attr]=saved;if(current!==next)e.setAttribute(attr,next);
    }
  }
  function scan(root){if(root.nodeType===Node.TEXT_NODE){nodeText(root);return;}if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE)return;
    if(root.nodeType===1)element(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);while(walker.nextNode()){const n=walker.currentNode;n.nodeType===3?nodeText(n):element(n);}}
  function setLanguage(next){language=supported.includes(next)?next:'ru';document.documentElement.lang=language;scan(document);const link=document.querySelector('link[rel="manifest"]');if(link)link.setAttribute('href',`locales/manifest-${language}.json`);}
  const api={t:format,translate,setLanguage,get language(){return language;},get messages(){return catalog?.messages;},missing,
    error(error){const message=error?.message||'';if(error?.name==='QuotaExceededError')return translate('Не удалось сохранить данные. Проверьте свободное место.');if(error instanceof SyntaxError)return translate('Не удалось прочитать файл. Проверьте формат и повторите.');return translate(message||'Не удалось выполнить действие.');}};
  window.echoI18n=api;
  document.querySelector('.app').inert=true;
  fetch('./locales/catalog.json').then(r=>{if(!r.ok)throw new Error('locale HTTP '+r.status);return r.json();}).then(data=>{
    catalog=data;reverse=new Map();for(const lang of supported)for(const [key,value]of Object.entries(data.messages[lang]))if(!reverse.has(normalize(value)))reverse.set(normalize(value),key);
    patterns=[];const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for(const key of Object.keys(data.messages.ru)){if(!/\{v\d+\}/.test(key))continue;const names=[];let regex='',at=0;for(const match of key.matchAll(/\{(v\d+)\}/g)){regex+=escape(key.slice(at,match.index))+'([\\s\\S]*?)';names.push(match[1]);at=match.index+match[0].length;}regex+=escape(key.slice(at));patterns.push({key,names,regex:new RegExp('^'+regex+'$')});}
    const keys=new Map();for(const key of Object.keys(data.messages.ru))if((key.length>=12||key.endsWith(':'))&&!/\{v\d+\}/.test(key))keys.set(key,key);
    literals={keys,regex:new RegExp([...keys.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|'),'g')};
    api.presets=Object.fromEntries(supported.map(lang=>[lang,['Я хочу пить','Я хочу есть','Мне нужна помощь','Я хочу домой','Да','Нет'].map(key=>format(key,{},lang))]));
    api.words=Object.fromEntries(supported.map(lang=>[lang,data.wordKeys.map(key=>format(key,{},lang))]));
    api.sos=Object.fromEntries(supported.map(lang=>[lang,Object.fromEntries(Object.entries({title:'Экстренная помощь',message:'Помогите! Мне срочно нужна помощь!',speak:'🔊 Позвать на помощь',call:'📞 Позвонить 112',stop:'■ Остановить',note:'Если есть непосредственная опасность, обратитесь за помощью к окружающим или в экстренные службы.'}).map(([field,key])=>[field,format(key,{},lang)]))]));
    for(const method of ['alert','confirm','prompt']){const native=window[method].bind(window);window[method]=(text,...args)=>native(String(text).split('\n').map(line=>/^1\. Мои фразы/.test(line)?line.replace('Мои фразы',format('Мои фразы')):translate(line)).join('\n'),...args);}
    setLanguage(language);
    const observer=new MutationObserver(records=>{const roots=new Set();for(const r of records){if(r.type==='attributes'&&r.target===document.documentElement&&r.attributeName==='lang'){if(language!==r.target.lang)setLanguage(r.target.lang);continue;}if(r.type==='childList'){for(const n of r.addedNodes)roots.add(n);}if(r.type==='characterData')roots.add(r.target);if(r.type==='attributes')roots.add(r.target);}for(const root of roots)if(root.isConnected)scan(root);});
    observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:[...attrs,'lang']});
    const boot=document.createElement('script');boot.src='backup.js';boot.onerror=()=>{document.body.append(document.createTextNode(translate('Не удалось загрузить')+' backup.js'));};document.body.append(boot);
  }).catch(error=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent='ECHO: не удалось загрузить переводы / could not load translations. '+error.message;document.body.prepend(p);});
})();
