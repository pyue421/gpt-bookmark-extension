(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  function formatRoleLabel(role) {
    const normalized = String(role || "")
      .trim()
      .toLowerCase();

    if (normalized === "chatgpt said" || normalized === "chatgpt") {
      return "GPT";
    }
    if (normalized === "you said" || normalized === "user") {
      return "You";
    }
    if (normalized === "assistant") {
      return "system";
    }

    return role || "GPT";
  }

  class BookmarkPanel {
    constructor(options) {
      this.state = options.state;
      this.onJumpToBookmark = options.onJumpToBookmark;
      this.onRemoveBookmark = options.onRemoveBookmark;

      this.panelRoot = null;
      this.panelNode = null;
      this.panelList = null;
      this.panelCount = null;
      this.panelEmpty = null;
      this.panelHeader = null;

      this.dragState = {
        active: false,
        pointerId: null,
        offsetX: 0,
        offsetY: 0
      };

      this.isResizeListenerAttached = false;
      this.boundHandleDragStart = (event) => this.handleDragStart(event);
      this.boundHandleDragMove = (event) => this.handleDragMove(event);
      this.boundHandleDragEnd = (event) => this.handleDragEnd(event);
      this.boundHandleResize = () => this.clampPanelToViewport();
    }

    ensurePanel() {
      if (this.panelRoot && document.body.contains(this.panelRoot)) {
        return;
      }

      const root = document.createElement("aside");
      root.id = ns.constants.PANEL_ROOT_ID;
      root.innerHTML =
        `<div id="${ns.constants.PANEL_ID}" class="gpt-bm-panel">` +
        '<div class="gpt-bm-panel-header">' +
        '<div class="gpt-bm-title">Bookmarks</div>' +
        '<div class="gpt-bm-count" id="gpt-bm-count">0</div>' +
        "</div>" +
        '<div id="gpt-bm-empty" class="gpt-bm-empty">No bookmarks yet.</div>' +
        '<div id="gpt-bm-list" class="gpt-bm-list"></div>' +
        "</div>";

      document.body.appendChild(root);
      this.panelRoot = root;
      this.panelNode = root.querySelector(`#${ns.constants.PANEL_ID}`);
      this.panelList = root.querySelector("#gpt-bm-list");
      this.panelCount = root.querySelector("#gpt-bm-count");
      this.panelEmpty = root.querySelector("#gpt-bm-empty");
      this.panelHeader = root.querySelector(".gpt-bm-panel-header");
      this.enableDragging();
    }

    enableDragging() {
      if (!this.panelHeader || this.panelHeader.dataset.gptBmDragReady === "1") {
        return;
      }

      this.panelHeader.dataset.gptBmDragReady = "1";
      this.panelHeader.addEventListener("pointerdown", this.boundHandleDragStart);
      this.panelHeader.addEventListener("pointermove", this.boundHandleDragMove);
      this.panelHeader.addEventListener("pointerup", this.boundHandleDragEnd);
      this.panelHeader.addEventListener("pointercancel", this.boundHandleDragEnd);

      if (!this.isResizeListenerAttached) {
        window.addEventListener("resize", this.boundHandleResize);
        this.isResizeListenerAttached = true;
      }
    }

    setPanelPosition(left, top) {
      if (!this.panelRoot) {
        return;
      }

      const maxLeft = Math.max(0, window.innerWidth - this.panelRoot.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - this.panelRoot.offsetHeight);
      const clampedLeft = Math.min(Math.max(0, left), maxLeft);
      const clampedTop = Math.min(Math.max(0, top), maxTop);

      this.panelRoot.style.left = `${Math.round(clampedLeft)}px`;
      this.panelRoot.style.top = `${Math.round(clampedTop)}px`;
    }

    clampPanelToViewport() {
      if (!this.panelRoot) {
        return;
      }

      const currentLeft = Number.parseFloat(this.panelRoot.style.left);
      const currentTop = Number.parseFloat(this.panelRoot.style.top);
      if (!Number.isFinite(currentLeft) || !Number.isFinite(currentTop)) {
        return;
      }

      this.setPanelPosition(currentLeft, currentTop);
    }

    handleDragStart(event) {
      if (!this.panelRoot || !this.panelHeader || event.button !== 0) {
        return;
      }

      event.preventDefault();
      const rect = this.panelRoot.getBoundingClientRect();
      this.dragState.active = true;
      this.dragState.pointerId = event.pointerId;
      this.dragState.offsetX = event.clientX - rect.left;
      this.dragState.offsetY = event.clientY - rect.top;
      this.panelRoot.classList.add("gpt-bm-dragging");

      if (typeof this.panelHeader.setPointerCapture === "function") {
        this.panelHeader.setPointerCapture(event.pointerId);
      }
    }

    handleDragMove(event) {
      if (
        !this.dragState.active ||
        event.pointerId !== this.dragState.pointerId ||
        !this.panelRoot
      ) {
        return;
      }

      event.preventDefault();
      const left = event.clientX - this.dragState.offsetX;
      const top = event.clientY - this.dragState.offsetY;
      this.setPanelPosition(left, top);
    }

    handleDragEnd(event) {
      if (
        !this.dragState.active ||
        event.pointerId !== this.dragState.pointerId ||
        !this.panelHeader
      ) {
        return;
      }

      if (
        typeof this.panelHeader.hasPointerCapture === "function" &&
        this.panelHeader.hasPointerCapture(event.pointerId)
      ) {
        this.panelHeader.releasePointerCapture(event.pointerId);
      }

      this.dragState.active = false;
      this.dragState.pointerId = null;
      if (this.panelRoot) {
        this.panelRoot.classList.remove("gpt-bm-dragging");
      }
    }

    buildBookmarkItem(bookmark) {
      const item = document.createElement("div");
      item.className = "gpt-bm-item";
      item.dataset.messageKey = bookmark.messageKey;

      const content = document.createElement("button");
      content.type = "button";
      content.className = "gpt-bm-item-content";
      content.addEventListener("click", () => this.onJumpToBookmark(bookmark));

      // User message preview
      const userPreview = document.createElement("div");
      userPreview.className = "gpt-bm-item-preview gpt-bm-user-msg";
      userPreview.textContent = bookmark.textPreview || "(No preview)";

      // Assistant response preview
      if (bookmark.assistantPreview) {
        const assistantPreview = document.createElement("div");
        assistantPreview.className = "gpt-bm-item-preview gpt-bm-assistant-msg";
        assistantPreview.textContent = bookmark.assistantPreview;
        content.append(userPreview, assistantPreview);
      } else {
        content.append(userPreview);
      }

      const meta = document.createElement("div");
      meta.className = "gpt-bm-item-meta";
      const indexLabel = Number.isFinite(Number(bookmark.index))
        ? `#${Number(bookmark.index) + 1}`
        : "#?";
      const pieces = [
        "Q&A",
        indexLabel,
        ns.utils.formatTimestamp(bookmark.createdAt)
      ].filter(Boolean);
      meta.textContent = pieces.join(" • ");

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "gpt-bm-item-remove";
      removeButton.textContent = "🗑";
      removeButton.title = "Remove bookmark";
      removeButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.onRemoveBookmark(bookmark.messageKey);
      });

      content.append(meta);
      item.append(content, removeButton);

      return item;
    }

    refresh() {
      this.ensurePanel();

      if (!this.panelList || !this.panelEmpty || !this.panelCount) {
        return;
      }

      // Check if extension context is valid
      const isContextValid = !!(chrome.runtime && chrome.runtime.id);
      if (!isContextValid) {
        this.panelEmpty.textContent = "Extension reloaded. Please refresh the page.";
        this.panelEmpty.hidden = false;
        this.panelList.innerHTML = "";
        this.panelCount.textContent = "0";
        if (this.panelNode) {
          this.panelNode.classList.add("gpt-bm-panel-disabled");
        }
        return;
      }

      const hasConversation = Boolean(this.state.conversationId);
      const sortedBookmarks = this.state.bookmarks
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      this.panelList.innerHTML = "";

      if (!hasConversation) {
        this.panelEmpty.textContent =
          "Open a conversation (/c/{id}) to use bookmarks.";
        this.panelEmpty.hidden = false;
      } else if (sortedBookmarks.length === 0) {
        this.panelEmpty.textContent = "No bookmarks yet.";
        this.panelEmpty.hidden = false;
      } else {
        this.panelEmpty.hidden = true;
        sortedBookmarks.forEach((bookmark) => {
          this.panelList.appendChild(this.buildBookmarkItem(bookmark));
        });
      }

      this.panelCount.textContent = String(sortedBookmarks.length);
      if (this.panelNode) {
        this.panelNode.classList.toggle("gpt-bm-panel-disabled", !hasConversation);
      }
    }
  }

  ns.BookmarkPanel = BookmarkPanel;
})();
