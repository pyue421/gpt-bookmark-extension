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

  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
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
      button.setAttribute(
        "aria-label",
        active ? "Bookmarked" : "Bookmark"
      );
      button.dataset.gptBmTooltip = active ? "Bookmarked" : "Bookmark";
    }

    createControlButton(kind) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `gpt-bm-btn gpt-bm-btn-${kind}`;

      if (kind === "bookmark") {
        button.dataset.gptBmTooltip = "Bookmark Q&A pair";
        button.setAttribute("aria-label", "Bookmark Q&A pair");
        button.innerHTML =
          '<svg class="gpt-bm-icon gpt-bm-icon-bookmark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M8 3.75H16C17.7949 3.75 19.25 5.20507 19.25 7V20.0326C19.25 20.6332 18.5771 20.9917 18.0766 20.6564L12 16.5858L5.92341 20.6564C5.42291 20.9917 4.75 20.6332 4.75 20.0326V7C4.75 5.20508 6.20508 3.75 8 3.75Z"></path>' +
          "</svg>";
      } else {
        button.dataset.gptBmTooltip = "Remove message thread";
        button.setAttribute("aria-label", "Remove message thread");
        button.innerHTML =
          '<svg class="gpt-bm-icon gpt-bm-icon-trash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M9.1 3.5C8.16112 3.5 7.4 4.26112 7.4 5.2V6H4.85C4.35355 6 3.95 6.40355 3.95 6.9C3.95 7.39645 4.35355 7.8 4.85 7.8H5.68623L6.55844 17.1094C6.74373 19.0862 8.40445 20.6 10.3899 20.6H13.6101C15.5955 20.6 17.2563 19.0862 17.4416 17.1094L18.3138 7.8H19.15C19.6464 7.8 20.05 7.39645 20.05 6.9C20.05 6.40355 19.6464 6 19.15 6H16.6V5.2C16.6 4.26112 15.8389 3.5 14.9 3.5H9.1ZM14.8 6H9.2V5.3H14.8V6ZM7.49393 7.8H16.5061L15.6486 16.9533C15.5494 18.0117 14.6606 18.8211 13.5975 18.8211H10.4025C9.33942 18.8211 8.45057 18.0117 8.35139 16.9533L7.49393 7.8ZM9.95 10.15C10.4464 10.15 10.85 10.5535 10.85 11.05V15.15C10.85 15.6464 10.4464 16.05 9.95 16.05C9.45354 16.05 9.05 15.6464 9.05 15.15V11.05C9.05 10.5535 9.45354 10.15 9.95 10.15ZM14.05 10.15C14.5464 10.15 14.95 10.5535 14.95 11.05V15.15C14.95 15.6464 14.5464 16.05 14.05 16.05C13.5535 16.05 13.15 15.6464 13.15 15.15V11.05C13.15 10.5535 13.5535 10.15 14.05 10.15Z"></path>' +
          "</svg>";
      }

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
      if (!isExtensionContextValid()) {
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
