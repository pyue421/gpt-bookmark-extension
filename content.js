(function () {
  "use strict";

  const STORAGE_KEY = "gptBookmarkExtensionStateV1";
  const PANEL_ROOT_ID = "gpt-bm-panel-root";
  const PANEL_ID = "gpt-bm-panel";
  const ROUTE_WATCH_INTERVAL_MS = 750;
  const DOM_SCAN_DEBOUNCE_MS = 120;
  const HIGHLIGHT_DURATION_MS = 1600;

  const state = {
    url: location.href,
    conversationId: null,
    bookmarks: [],
    hiddenMessageKeys: new Set(),
    nodeByKey: new Map(),
    observer: null,
    panelRoot: null,
    panelList: null,
    panelCount: null,
    panelEmpty: null
  };

  function debounce(fn, waitMs) {
    let timerId = null;
    return function debounced(...args) {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => fn(...args), waitMs);
    };
  }

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

  function getConversationIdFromUrl(urlString) {
    try {
      const url = new URL(urlString, location.origin);
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch (_error) {
      return null;
    }
  }

  async function loadConversationState(conversationId) {
    state.bookmarks = [];
    state.hiddenMessageKeys = new Set();

    if (!conversationId) {
      refreshPanel();
      return;
    }

    const allState = (await storageGet(STORAGE_KEY)) || {};
    const conversationState = allState[conversationId] || {};
    const bookmarks = Array.isArray(conversationState.bookmarks)
      ? conversationState.bookmarks
      : [];
    const hiddenMessages = Array.isArray(conversationState.hiddenMessages)
      ? conversationState.hiddenMessages
      : [];

    state.bookmarks = bookmarks.filter(
      (bookmark) => bookmark && typeof bookmark.messageKey === "string"
    );
    state.hiddenMessageKeys = new Set(
      hiddenMessages
        .map((entry) =>
          typeof entry === "string" ? entry : entry && entry.messageKey
        )
        .filter(Boolean)
    );
  }

  async function persistConversationState() {
    if (!state.conversationId) {
      return;
    }

    const allState = (await storageGet(STORAGE_KEY)) || {};
    allState[state.conversationId] = {
      bookmarks: state.bookmarks,
      hiddenMessages: Array.from(state.hiddenMessageKeys).map((messageKey) => ({
        conversationId: state.conversationId,
        messageKey
      }))
    };
    await storageSet({ [STORAGE_KEY]: allState });
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

  function inferRole(node, index) {
    const explicitRole =
      node.getAttribute("data-message-author-role") ||
      (node.querySelector("[data-message-author-role]") &&
        node
          .querySelector("[data-message-author-role]")
          .getAttribute("data-message-author-role"));

    if (explicitRole === "assistant" || explicitRole === "user" || explicitRole === "system") {
      return explicitRole;
    }

    const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
    if (ariaLabel.includes("assistant")) {
      return "assistant";
    }
    if (ariaLabel.includes("user") || ariaLabel.includes("you")) {
      return "user";
    }

    return index % 2 === 0 ? "assistant" : "user";
  }

  function deriveMessageKey(node, index, role, preview) {
    const directMessageId = node.getAttribute("data-message-id");
    if (directMessageId) {
      return `msg_${directMessageId}`;
    }

    if (node.id) {
      return `node_${node.id}`;
    }

    const descendantMessageNode = node.querySelector("[data-message-id]");
    if (descendantMessageNode) {
      return `msg_${descendantMessageNode.getAttribute("data-message-id")}`;
    }

    const testId = node.getAttribute("data-testid");
    if (testId && testId.startsWith("conversation-turn-")) {
      return `turn_${testId}`;
    }

    const fingerprint = `${role}|${index}|${preview.slice(0, 80)}`;
    return `hash_${hashString(fingerprint)}`;
  }

  function dedupeNodes(nodes) {
    const unique = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      let isNested = false;
      for (const parent of unique) {
        if (parent.contains(node)) {
          isNested = true;
          break;
        }
      }
      if (isNested) {
        continue;
      }
      unique.push(node);
    }
    return unique;
  }

  function findMessageNodes() {
    const selectors = [
      'main [data-testid^="conversation-turn-"]',
      "main [data-message-id]",
      "main article"
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length > 0) {
        return dedupeNodes(nodes).filter((node) => {
          const text = (node.innerText || "").trim();
          return text.length > 0;
        });
      }
    }
    return [];
  }

  function getBookmarkByKey(messageKey) {
    return state.bookmarks.find((bookmark) => bookmark.messageKey === messageKey);
  }

  function isBookmarked(messageKey) {
    return Boolean(getBookmarkByKey(messageKey));
  }

  function applyHiddenState(node, messageKey) {
    if (state.hiddenMessageKeys.has(messageKey)) {
      node.classList.add("gpt-bm-hidden");
    } else {
      node.classList.remove("gpt-bm-hidden");
    }
  }

  function setBookmarkButtonState(button, messageKey) {
    const active = isBookmarked(messageKey);
    button.classList.toggle("gpt-bm-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? "Bookmarked" : "Bookmark message";
  }

  function createControlButton(kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gpt-bm-btn gpt-bm-btn-${kind}`;
    button.textContent = kind === "bookmark" ? "★" : "⊖";
    button.title = kind === "bookmark" ? "Bookmark message" : "Hide message locally";
    return button;
  }

  function updateBookmarkButtonForMessage(messageKey) {
    const node = state.nodeByKey.get(messageKey);
    if (!node) {
      return;
    }

    const bookmarkBtn = node.querySelector(".gpt-bm-btn-bookmark");
    if (bookmarkBtn) {
      setBookmarkButtonState(bookmarkBtn, messageKey);
    }
  }

  function buildMessageMeta(node, index) {
    const preview = normalizePreview(node.innerText || "");
    const role = inferRole(node, index);
    const messageKey = deriveMessageKey(node, index, role, preview);
    return {
      index,
      preview,
      role,
      messageKey
    };
  }

  function annotateNode(node, meta) {
    node.classList.add("gpt-bm-message");
    node.dataset.gptBmIndex = String(meta.index);
    node.dataset.gptBmRole = meta.role;
    node.dataset.gptBmPreview = meta.preview;
    node.dataset.gptBmKey = meta.messageKey;
  }

  function attachControlsToNode(node, meta) {
    let controls = node.querySelector(":scope > .gpt-bm-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "gpt-bm-controls";

      const bookmarkButton = createControlButton("bookmark");
      const hideButton = createControlButton("hide");
      controls.append(bookmarkButton, hideButton);
      node.appendChild(controls);

      bookmarkButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const messageKey = node.dataset.gptBmKey;
        if (!messageKey || !state.conversationId) {
          return;
        }

        const existingIndex = state.bookmarks.findIndex(
          (bookmark) => bookmark.messageKey === messageKey
        );
        if (existingIndex >= 0) {
          state.bookmarks.splice(existingIndex, 1);
        } else {
          state.bookmarks.push({
            conversationId: state.conversationId,
            messageKey,
            textPreview: node.dataset.gptBmPreview || "",
            role: node.dataset.gptBmRole || "assistant",
            index: Number(node.dataset.gptBmIndex || 0),
            createdAt: Date.now()
          });
        }

        await persistConversationState();
        refreshPanel();
        setBookmarkButtonState(bookmarkButton, messageKey);
      });

      hideButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const messageKey = node.dataset.gptBmKey;
        if (!messageKey || !state.conversationId) {
          return;
        }

        state.hiddenMessageKeys.add(messageKey);
        applyHiddenState(node, messageKey);
        await persistConversationState();
      });
    }

    const bookmarkButton = controls.querySelector(".gpt-bm-btn-bookmark");
    if (bookmarkButton) {
      setBookmarkButtonState(bookmarkButton, meta.messageKey);
    }
  }

  function refreshMessageBindings() {
    const messageNodes = findMessageNodes();
    state.nodeByKey.clear();

    messageNodes.forEach((node, index) => {
      const meta = buildMessageMeta(node, index);
      annotateNode(node, meta);
      state.nodeByKey.set(meta.messageKey, node);
      attachControlsToNode(node, meta);
      applyHiddenState(node, meta.messageKey);
    });
  }

  function ensurePanel() {
    if (state.panelRoot && document.body.contains(state.panelRoot)) {
      return;
    }

    const root = document.createElement("aside");
    root.id = PANEL_ROOT_ID;
    root.innerHTML =
      `<div id="${PANEL_ID}" class="gpt-bm-panel">` +
      '<div class="gpt-bm-panel-header">' +
      '<div class="gpt-bm-title">Bookmarks</div>' +
      '<div class="gpt-bm-count" id="gpt-bm-count">0</div>' +
      "</div>" +
      '<div id="gpt-bm-empty" class="gpt-bm-empty">No bookmarks yet.</div>' +
      '<div id="gpt-bm-list" class="gpt-bm-list"></div>' +
      "</div>";

    document.body.appendChild(root);
    state.panelRoot = root;
    state.panelList = root.querySelector("#gpt-bm-list");
    state.panelCount = root.querySelector("#gpt-bm-count");
    state.panelEmpty = root.querySelector("#gpt-bm-empty");
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

  async function removeBookmark(messageKey) {
    state.bookmarks = state.bookmarks.filter(
      (bookmark) => bookmark.messageKey !== messageKey
    );
    await persistConversationState();
    refreshPanel();
    updateBookmarkButtonForMessage(messageKey);
  }

  function scrollToBookmark(bookmark) {
    let node = state.nodeByKey.get(bookmark.messageKey);
    if (!node) {
      refreshMessageBindings();
      node = state.nodeByKey.get(bookmark.messageKey);
    }

    if (!node) {
      return;
    }

    if (state.hiddenMessageKeys.has(bookmark.messageKey)) {
      state.hiddenMessageKeys.delete(bookmark.messageKey);
      applyHiddenState(node, bookmark.messageKey);
      persistConversationState().catch(() => {});
    }

    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("gpt-bm-highlight");
    window.setTimeout(() => {
      node.classList.remove("gpt-bm-highlight");
    }, HIGHLIGHT_DURATION_MS);
  }

  function buildBookmarkItem(bookmark) {
    const item = document.createElement("div");
    item.className = "gpt-bm-item";
    item.dataset.messageKey = bookmark.messageKey;

    const content = document.createElement("button");
    content.type = "button";
    content.className = "gpt-bm-item-content";
    content.addEventListener("click", () => scrollToBookmark(bookmark));

    const preview = document.createElement("div");
    preview.className = "gpt-bm-item-preview";
    preview.textContent = bookmark.textPreview || "(No preview)";

    const meta = document.createElement("div");
    meta.className = "gpt-bm-item-meta";
    const indexLabel = Number.isFinite(Number(bookmark.index))
      ? `#${Number(bookmark.index) + 1}`
      : "#?";
    const pieces = [
      bookmark.role || "assistant",
      indexLabel,
      formatTimestamp(bookmark.createdAt)
    ].filter(Boolean);
    meta.textContent = pieces.join(" • ");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "gpt-bm-item-remove";
    removeButton.textContent = "✕";
    removeButton.title = "Remove bookmark";
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeBookmark(bookmark.messageKey);
    });

    content.append(preview, meta);
    item.append(content, removeButton);
    return item;
  }

  function refreshPanel() {
    ensurePanel();
    if (!state.panelList || !state.panelEmpty || !state.panelCount) {
      return;
    }

    const hasConversation = Boolean(state.conversationId);
    const sortedBookmarks = state.bookmarks
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    state.panelList.innerHTML = "";

    if (!hasConversation) {
      state.panelEmpty.textContent = "Open a conversation (/c/{id}) to use bookmarks.";
      state.panelEmpty.hidden = false;
    } else if (sortedBookmarks.length === 0) {
      state.panelEmpty.textContent = "No bookmarks yet.";
      state.panelEmpty.hidden = false;
    } else {
      state.panelEmpty.hidden = true;
      sortedBookmarks.forEach((bookmark) => {
        state.panelList.appendChild(buildBookmarkItem(bookmark));
      });
    }

    state.panelCount.textContent = String(sortedBookmarks.length);
    state.panelRoot.classList.toggle("gpt-bm-panel-disabled", !hasConversation);
  }

  const debouncedRefreshMessageBindings = debounce(
    refreshMessageBindings,
    DOM_SCAN_DEBOUNCE_MS
  );

  function connectMutationObserver() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      debouncedRefreshMessageBindings();
    });
    state.observer.observe(document.body, { subtree: true, childList: true });
  }

  async function handleRouteChange(force) {
    const nextConversationId = getConversationIdFromUrl(location.href);
    if (!force && nextConversationId === state.conversationId) {
      return;
    }

    state.conversationId = nextConversationId;
    await loadConversationState(state.conversationId);
    refreshMessageBindings();
    refreshPanel();
  }

  function startRouteWatcher() {
    window.setInterval(() => {
      if (location.href === state.url) {
        return;
      }
      state.url = location.href;
      handleRouteChange(false).catch(() => {});
    }, ROUTE_WATCH_INTERVAL_MS);
  }

  function bootstrap() {
    ensurePanel();
    connectMutationObserver();
    startRouteWatcher();

    handleRouteChange(true).catch(() => {});
    window.setTimeout(() => {
      refreshMessageBindings();
      refreshPanel();
    }, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
