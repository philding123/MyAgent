// Omni stub for the WorkBuddy renderer bridge (window.workbuddyDesktop):
// every property access returns another omni value, every call returns the
// omni value again (non-thenable, so `await` resolves to it). Good enough
// for the settings React tree to mount and paint its static chrome; real
// data comes back empty/undefined.
(function () {
  function make() {
    const fn = function () { return omni; };
    const omni = new Proxy(fn, {
      get: function (t, k) {
        if (k === 'then' || k === Symbol.toPrimitive) return undefined;
        if (k === 'addEventListener' || k === 'removeEventListener' || k === 'on' || k === 'off') return function () { return function () {}; };
        return omni;
      },
      apply: function () { return omni; },
    });
    return omni;
  }
  const omni = make();
  window.workbuddyDesktop = omni;
  window.electron = omni;
  window.electronAPI = omni;
  // the Desktop SDK binds this provider channel during init (see
  // desktop-sdk-setup / app-core "WorkbuddySDK 尚未初始化")
  window.__wbInvoke = omni;
  window.__wbOn = omni;
})();
