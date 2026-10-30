// KGSM view registry. Must load before views-*.js (they register at parse time).
(function () {
  'use strict';
  var views = {};
  globalThis.KgsmViews = {
    register: function (name, def) { views[name] = def; },
    get: function (name) { return views[name]; },
    names: function () { return Object.keys(views); },
  };
})();
