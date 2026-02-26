(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

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
    }

    buildBookmarkItem(bookmark) {
      const item = document.createElement("div");
      item.className = "gpt-bm-item";
      item.dataset.messageKey = bookmark.messageKey;

      const content = document.createElement("button");
      content.type = "button";
      content.className = "gpt-bm-item-content";
      content.addEventListener("click", () => this.onJumpToBookmark(bookmark));

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
        ns.utils.formatTimestamp(bookmark.createdAt)
      ].filter(Boolean);
      meta.textContent = pieces.join(" • ");

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "gpt-bm-item-remove";
      removeButton.textContent = "✕";
      removeButton.title = "Remove bookmark";
      removeButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.onRemoveBookmark(bookmark.messageKey);
      });

      content.append(preview, meta);
      item.append(content, removeButton);

      return item;
    }

    refresh() {
      this.ensurePanel();

      if (!this.panelList || !this.panelEmpty || !this.panelCount) {
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
