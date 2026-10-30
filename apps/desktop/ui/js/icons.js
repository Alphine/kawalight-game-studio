// KGSM HUD inline SVG icon set (offline-safe: no CDN, no fonts).
// Stroke icons, currentColor, 24x24 viewBox. Exposes globalThis.KgsmIcons.
(function () {
  'use strict';

  // Each entry is inner SVG markup (paths/shapes only).
  var P = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.8V20h12V9.8"/><path d="M10 20v-5h4v5"/>',
    plus: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.2v7.6M8.2 12h7.6"/>',
    blueprint: '<path d="M6 3.5h8L19 8.5V20.5H6z"/><path d="M14 3.5V8.5H19"/><path d="M9 12.5h6M9 15.5h6"/>',
    forge: '<path d="M6 20 14.5 11.5"/><path d="M14 4.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M18.5 12l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
    lab: '<path d="M10 3.5h4M10.5 3.5V8l-5.3 9.2a1.6 1.6 0 0 0 1.4 2.3h10.8a1.6 1.6 0 0 0 1.4-2.3L13.5 8V3.5"/><path d="M8.2 14.5h7.6"/>',
    audio: '<circle cx="7" cy="17.5" r="2.8"/><path d="M9.8 17.5V6l10-2.2V15"/><circle cx="17" cy="15" r="2.8"/>',
    levels: '<path d="M12 3.5 3.5 8.5 12 13.5l8.5-5z"/><path d="M4.5 12.5 12 17l7.5-4.5"/><path d="M4.5 16.5 12 21l7.5-4.5"/>',
    sliders: '<path d="M5 7.5h14M5 16.5h14"/><circle cx="10" cy="7.5" r="2.3"/><circle cx="15" cy="16.5" r="2.3"/>',
    play: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.8v6.4L15.5 12z"/>',
    shield: '<path d="M12 3.5 5 6v6c0 4.6 2.9 7.6 7 8.9 4.1-1.3 7-4.3 7-8.9V6z"/><path d="M9 11.8l2.2 2.2L15.5 9.5"/>',
    export: '<path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 16v3.5h15V16"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 7V4.5M14 7V4.5M10 20v-2.5M14 20v-2.5M7 10H4.5M7 14H4.5M20 10h-2.5M20 14h-2.5"/>',
    gamepad: '<rect x="3" y="8" width="18" height="9" rx="4"/><path d="M8 12.5v3M6.5 14h3"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="15" r="1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.5 2.5 4.8-5.2"/>',
    warn: '<path d="M12 4 3.5 19.5h17z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".4"/>',
    error: '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5V8H15"/>',
    folder: '<path d="M3.5 6.5a1 1 0 0 1 1-1h5l1.8 2.2h6.2a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"/>',
    dot: '<circle cx="12" cy="12" r="5"/>',
  };

  function esc(s) {
    return String(s).replace(/[^a-z0-9-]/gi, '');
  }

  // Returns an inline <svg> string. cls is appended to the class list (sanitized).
  function svg(name, cls) {
    var inner = P[name] || P.dot;
    var extra = cls ? ' ' + esc(cls) : '';
    return '<svg class="k-icon' + extra + '" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
      + 'aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  globalThis.KgsmIcons = { svg: svg, has: function (n) { return !!P[n]; } };
})();
