// KGSM HUD theme manager: dark-first, persisted as kawalight_theme (default dark).
// Loads synchronously in <head> so the theme class is set before first paint.
// Plain browser script; exposes globalThis.KgsmTheme = {get, set, toggle, init}.
(function () {
  'use strict';

  var LS_KEY = 'kawalight_theme';
  var DARK = 'dark';
  var LIGHT = 'light';

  function stored() {
    try {
      var v = window.localStorage.getItem(LS_KEY);
      return v === LIGHT || v === DARK ? v : null;
    } catch (e) { return null; }
  }

  function save(name) {
    try { window.localStorage.setItem(LS_KEY, name); } catch (e) { /* private mode */ }
  }

  function current() {
    return document.documentElement.classList.contains(DARK) ? DARK : LIGHT;
  }

  function paintToggle() {
    var btn = document.getElementById('themeToggle');
    var label = document.getElementById('themeText');
    var slot = document.getElementById('themeIcon');
    var isDark = current() === DARK;
    if (label) label.textContent = isDark ? 'DARK' : 'LIGHT';
    if (btn) btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    if (slot) {
      var I = globalThis.KgsmIcons;
      slot.innerHTML = I ? I.svg(isDark ? 'moon' : 'sun', 'k-toggle-icon') : (isDark ? '◐' : '◑');
    }
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', isDark ? 'dark light' : 'light dark');
  }

  function apply(name) {
    var root = document.documentElement;
    if (name === LIGHT) root.classList.remove(DARK);
    else root.classList.add(DARK);
    paintToggle();
    try {
      window.dispatchEvent(new CustomEvent('kawalight:theme', { detail: { theme: current() } }));
    } catch (e) { /* old webview: ignore */ }
  }

  function set(name) {
    if (name !== LIGHT && name !== DARK) return current();
    save(name);
    apply(name);
    return current();
  }

  function init() {
    apply(stored() || DARK);
  }

  function bind() {
    var btn = document.getElementById('themeToggle');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        set(current() === DARK ? LIGHT : DARK);
      });
    }
    paintToggle();
  }

  globalThis.KgsmTheme = { get: current, set: set, toggle: function () { return set(current() === DARK ? LIGHT : DARK); }, init: init };

  init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
