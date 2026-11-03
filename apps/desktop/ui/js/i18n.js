// Language switch for the studio and the landing page. Plain browser script:
// exposes globalThis.KgsmI18n. English is the default; Indonesian (id) comes
// from the dictionary in i18n-dict.js.
//
// Text is matched exactly (whitespace-normalized) against the dictionary, so
// anything missing from it simply stays in English. Original English is kept
// on each node, so switching back is exact even after re-rendering.
(function () {
  'use strict';

  var KEY = 'kgsm.lang';
  var LANGS = ['en', 'id'];
  var SKIP_TAGS = { SCRIPT: true, STYLE: true, TEXTAREA: true, CODE: true, PRE: true };
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var observer = null;
  var pending = false;

  function dictionary() {
    var all = globalThis.KgsmI18nDict || {};
    return all.id || {};
  }

  function current() {
    try {
      var saved = globalThis.localStorage.getItem(KEY);
      if (LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) { /* private mode: fall back to the default */ }
    return 'en';
  }

  function norm(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  // Translate one string for the current language. Edge whitespace is kept.
  function tr(s) {
    var text = String(s);
    if (current() !== 'id') return text;
    var hit = dictionary()[norm(text)];
    if (hit === undefined) return text;
    var lead = text.match(/^\s*/)[0];
    var trail = text.match(/\s*$/)[0];
    return lead + hit + trail;
  }

  function translateText(node) {
    var value = node.nodeValue;
    // If the app wrote new text since our last pass, that text is the new original.
    if (node.__kgsmOut !== undefined && value !== node.__kgsmOut) node.__kgsmEn = value;
    if (node.__kgsmEn === undefined) node.__kgsmEn = value;
    var out = tr(node.__kgsmEn);
    node.__kgsmOut = out;
    if (value !== out) node.nodeValue = out;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var state = el.__kgsmAttrs || (el.__kgsmAttrs = {});
      var value = el.getAttribute(name);
      var rec = state[name] || (state[name] = {});
      if (rec.out !== undefined && value !== rec.out) rec.en = value;
      if (rec.en === undefined) rec.en = value;
      rec.out = tr(rec.en);
      if (value !== rec.out) el.setAttribute(name, rec.out);
    }
  }

  function walk(node) {
    if (node.nodeType === 3) { translateText(node); return; }
    if (node.nodeType !== 1 || SKIP_TAGS[node.tagName]) return;
    translateAttrs(node);
    for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  function apply() {
    if (!document.body) return;
    if (observer) observer.disconnect();
    walk(document.body);
    if (observer) {
      observer.observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ATTRS,
      });
    }
  }

  // Batch bursts of re-renders into one pass per frame.
  function schedule() {
    if (pending) return;
    pending = true;
    var raf = globalThis.requestAnimationFrame || function (cb) { setTimeout(cb, 16); };
    raf(function () { pending = false; apply(); });
  }

  function setLang(lang) {
    if (LANGS.indexOf(lang) < 0) return;
    try { globalThis.localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    apply();
  }

  function init() {
    document.documentElement.lang = current();
    if (!observer && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(schedule);
    }
    apply();
  }

  globalThis.KgsmI18n = {
    lang: current,
    setLang: setLang,
    tr: tr,
    init: init,
    apply: apply,
  };
})();
