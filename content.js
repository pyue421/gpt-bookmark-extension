(function () {
  "use strict";

  function start() {
    const ns = globalThis.GPTBM || {};
    if (!ns.App) {
      return;
    }

    const app = new ns.App();
    app.bootstrap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
