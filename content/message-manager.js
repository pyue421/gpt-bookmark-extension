(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  function inferRole(node, index) {
    const explicitRole =
      node.getAttribute("data-message-author-role") ||
      (node.querySelector("[data-message-author-role]") &&
        node
          .querySelector("[data-message-author-role]")
          .getAttribute("data-message-author-role"));

    if (explicitRole === "assistant") {
      return "system";
    }
    if (explicitRole === "system" || explicitRole === "user") {
      return explicitRole;
    }

    const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
    if (ariaLabel.includes("assistant")) {
      return "system";
    }
    if (ariaLabel.includes("system")) {
      return "system";
    }
    if (ariaLabel.includes("user") || ariaLabel.includes("you")) {
      return "user";
    }

    return index % 2 === 0 ? "system" : "user";
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
    return `hash_${ns.utils.hashString(fingerprint)}`;
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
      if (!isNested) {
        unique.push(node);
      }
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

  class MessageManager {
    constructor(options) {
      this.state = options.state;
      this.isBookmarked = options.isBookmarked;
      this.onToggleBookmark = options.onToggleBookmark;
      this.onHideMessage = options.onHideMessage;
    }

    applyHiddenState(node, messageKey) {
      if (this.state.hiddenMessageKeys.has(messageKey)) {
        node.classList.add("gpt-bm-hidden");
      } else {
        node.classList.remove("gpt-bm-hidden");
      }
    }

    setBookmarkButtonState(button, messageKey) {
      const active = this.isBookmarked(messageKey);
      button.classList.toggle("gpt-bm-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.title = active ? "Bookmarked" : "Bookmark message";
    }

    createControlButton(kind) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `gpt-bm-btn gpt-bm-btn-${kind}`;
      button.textContent = kind === "bookmark" ? "★" : "🗑";
      button.title =
        kind === "bookmark" ? "Bookmark Q&A pair" : "Remove Q&A pair locally";
      return button;
    }

    findNativeActionHost(node) {
      const anchorSelectors = [
        'button[aria-label*="Copy"]',
        'button[aria-label*="Edit"]',
        'button[aria-label*="Regenerate"]',
        'button[aria-label*="Like"]',
        'button[aria-label*="Dislike"]',
        'button[data-testid*="copy"]',
        'button[data-testid*="edit"]'
      ];

      let anchorButton = null;
      for (const selector of anchorSelectors) {
        anchorButton = node.querySelector(selector);
        if (anchorButton) {
          break;
        }
      }

      if (!anchorButton) {
        return null;
      }

      let current = anchorButton.parentElement;
      while (current && current !== node) {
        const display = window.getComputedStyle(current).display;
        const directButtonCount = current.querySelectorAll(":scope > button").length;
        if (
          (display === "flex" || display === "inline-flex") &&
          directButtonCount >= 1 &&
          directButtonCount <= 10
        ) {
          return current;
        }
        current = current.parentElement;
      }

      return null;
    }

    buildMessageMeta(node, index) {
      const preview = ns.utils.normalizePreview(node.innerText || "");
      const role = inferRole(node, index);
      const messageKey = deriveMessageKey(node, index, role, preview);

      return {
        index,
        preview,
        role,
        messageKey
      };
    }

    annotateNode(node, meta) {
      node.classList.add("gpt-bm-message");
      node.dataset.gptBmIndex = String(meta.index);
      node.dataset.gptBmRole = meta.role;
      node.dataset.gptBmPreview = meta.preview;
      node.dataset.gptBmKey = meta.messageKey;
    }

    attachControlsToNode(node, meta) {
      // Only show controls for user messages
      const isUserMessage = meta.role === "user";

      // Don't add controls to assistant messages
      if (!isUserMessage) {
        return;
      }

      let controls = node.querySelector('.gpt-bm-controls[data-gpt-bm-owned="1"]');
      if (!controls) {
        controls = document.createElement("div");
        controls.className = "gpt-bm-controls";
        controls.dataset.gptBmOwned = "1";

        const bookmarkButton = this.createControlButton("bookmark");
        bookmarkButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          const messageKey = node.dataset.gptBmKey;
          if (!messageKey || !this.state.conversationId) {
            return;
          }
          await this.onToggleBookmark({ node, messageKey, bookmarkButton });
        });

        const hideButton = this.createControlButton("hide");
        hideButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          const messageKey = node.dataset.gptBmKey;
          if (!messageKey || !this.state.conversationId) {
            return;
          }
          await this.onHideMessage({ node, messageKey });
        });

        controls.append(bookmarkButton, hideButton);
      }

      const nativeActionHost = this.findNativeActionHost(node);
      const shouldInline = Boolean(nativeActionHost);
      controls.classList.toggle("gpt-bm-controls-inline", shouldInline);

      const targetParent = nativeActionHost || node;
      if (controls.parentElement !== targetParent) {
        targetParent.appendChild(controls);
      }

      const bookmarkButton = controls.querySelector(".gpt-bm-btn-bookmark");
      if (bookmarkButton) {
        this.setBookmarkButtonState(bookmarkButton, meta.messageKey);
      }
    }

    refresh() {
      // Don't try to refresh if extension context is invalid
      if (!chrome.runtime || !chrome.runtime.id) {
        return;
      }

      const messageNodes = findMessageNodes();
      this.state.nodeByKey.clear();

      messageNodes.forEach((node, index) => {
        const meta = this.buildMessageMeta(node, index);
        this.annotateNode(node, meta);
        this.state.nodeByKey.set(meta.messageKey, node);
        this.attachControlsToNode(node, meta);
        this.applyHiddenState(node, meta.messageKey);
      });
    }

    updateBookmarkButtonForMessage(messageKey) {
      const node = this.state.nodeByKey.get(messageKey);
      if (!node) {
        return;
      }

      const bookmarkBtn = node.querySelector(".gpt-bm-btn-bookmark");
      if (bookmarkBtn) {
        this.setBookmarkButtonState(bookmarkBtn, messageKey);
      }
    }
  }

  ns.MessageManager = MessageManager;
})();
