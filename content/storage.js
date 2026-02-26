(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (result) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result[key]);
      });
    });
  }

  function storageSet(payload) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  async function loadConversationState(conversationId) {
    if (!conversationId) {
      return {
        bookmarks: [],
        hiddenMessageKeys: new Set()
      };
    }

    const allState = (await storageGet(ns.constants.STORAGE_KEY)) || {};
    const conversationState = allState[conversationId] || {};
    const bookmarks = Array.isArray(conversationState.bookmarks)
      ? conversationState.bookmarks
      : [];
    const hiddenMessages = Array.isArray(conversationState.hiddenMessages)
      ? conversationState.hiddenMessages
      : [];

    return {
      bookmarks: bookmarks.filter(
        (bookmark) => bookmark && typeof bookmark.messageKey === "string"
      ),
      hiddenMessageKeys: new Set(
        hiddenMessages
          .map((entry) =>
            typeof entry === "string" ? entry : entry && entry.messageKey
          )
          .filter(Boolean)
      )
    };
  }

  async function persistConversationState(
    conversationId,
    bookmarks,
    hiddenMessageKeys
  ) {
    if (!conversationId) {
      return;
    }

    const allState = (await storageGet(ns.constants.STORAGE_KEY)) || {};
    allState[conversationId] = {
      bookmarks,
      hiddenMessages: Array.from(hiddenMessageKeys).map((messageKey) => ({
        conversationId,
        messageKey
      }))
    };

    await storageSet({ [ns.constants.STORAGE_KEY]: allState });
  }

  ns.storage = {
    loadConversationState,
    persistConversationState
  };
})();
