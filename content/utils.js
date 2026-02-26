(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  function debounce(fn, waitMs) {
    let timerId = null;
    return function debounced(...args) {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => fn(...args), waitMs);
    };
  }

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function normalizePreview(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function getConversationIdFromUrl(urlString) {
    try {
      const url = new URL(urlString, location.origin);
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch (_error) {
      return null;
    }
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "";
    }

    try {
      return new Date(timestamp).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_error) {
      return "";
    }
  }

  ns.utils = {
    debounce,
    formatTimestamp,
    getConversationIdFromUrl,
    hashString,
    normalizePreview
  };
})();
