(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  ns.constants = Object.freeze({
    STORAGE_KEY: "gptBookmarkExtensionStateV1",
    PANEL_ROOT_ID: "gpt-bm-panel-root",
    PANEL_ID: "gpt-bm-panel",
    ROUTE_WATCH_INTERVAL_MS: 750,
    DOM_SCAN_DEBOUNCE_MS: 120,
    HIGHLIGHT_DURATION_MS: 1600
  });
})();
