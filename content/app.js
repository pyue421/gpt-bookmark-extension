(function () {
  "use strict";

  const ns = (globalThis.GPTBM = globalThis.GPTBM || {});

  class App {
    constructor() {
      this.state = {
        url: location.href,
        conversationId: null,
        bookmarks: [],
        hiddenMessageKeys: new Set(),
        nodeByKey: new Map(),
        observer: null
      };

      this.messageManager = new ns.MessageManager({
        state: this.state,
        isBookmarked: (messageKey) => this.isBookmarked(messageKey),
        onToggleBookmark: (args) => this.toggleBookmarkForNode(args),
        onHideMessage: (args) => this.hideMessage(args)
      });

      this.panel = new ns.BookmarkPanel({
        state: this.state,
        onJumpToBookmark: (bookmark) => this.scrollToBookmark(bookmark),
        onRemoveBookmark: (messageKey) => this.removeBookmark(messageKey)
      });

      this.debouncedRefreshMessageBindings = ns.utils.debounce(
        () => this.refreshMessageBindings(),
        ns.constants.DOM_SCAN_DEBOUNCE_MS
      );
    }

    getBookmarkByKey(messageKey) {
      return this.state.bookmarks.find(
        (bookmark) => bookmark.messageKey === messageKey
      );
    }

    isBookmarked(messageKey) {
      return Boolean(this.getBookmarkByKey(messageKey));
    }

    async loadConversationState(conversationId) {
      try {
        const loaded = await ns.storage.loadConversationState(conversationId);
        this.state.bookmarks = loaded.bookmarks;
        this.state.hiddenMessageKeys = loaded.hiddenMessageKeys;
      } catch (error) {
        console.warn("GPT Bookmarks: Failed to load state", error);
        this.state.bookmarks = [];
        this.state.hiddenMessageKeys = new Set();
      }
    }

    async persistConversationState() {
      try {
        await ns.storage.persistConversationState(
          this.state.conversationId,
          this.state.bookmarks,
          this.state.hiddenMessageKeys
        );
      } catch (error) {
        console.warn("GPT Bookmarks: Failed to persist state", error);
      }
    }

    async toggleBookmarkForNode({ node, messageKey, bookmarkButton }) {
      const existingIndex = this.state.bookmarks.findIndex(
        (bookmark) => bookmark.messageKey === messageKey
      );

      if (existingIndex >= 0) {
        this.state.bookmarks.splice(existingIndex, 1);
      } else {
        // Find the assistant response (next message)
        const userIndex = Number(node.dataset.gptBmIndex || 0);
        let assistantNode = null;
        let assistantMessageKey = null;
        let assistantPreview = "";

        // Look for the next node with index = userIndex + 1
        for (const [key, candidateNode] of this.state.nodeByKey.entries()) {
          const candidateIndex = Number(candidateNode.dataset.gptBmIndex || 0);
          const candidateRole = candidateNode.dataset.gptBmRole;
          if (candidateIndex === userIndex + 1 && candidateRole === "system") {
            assistantNode = candidateNode;
            assistantMessageKey = key;
            assistantPreview = candidateNode.dataset.gptBmPreview || "";
            break;
          }
        }

        this.state.bookmarks.push({
          conversationId: this.state.conversationId,
          messageKey,
          textPreview: node.dataset.gptBmPreview || "",
          role: node.dataset.gptBmRole || "user",
          index: userIndex,
          createdAt: Date.now(),
          // Add assistant response data
          assistantMessageKey,
          assistantPreview
        });
      }

      await this.persistConversationState();
      this.panel.refresh();
      this.messageManager.setBookmarkButtonState(bookmarkButton, messageKey);
    }

    async hideMessage({ node, messageKey }) {
      // Hide the user message
      this.state.hiddenMessageKeys.add(messageKey);
      this.messageManager.applyHiddenState(node, messageKey);

      // Find and hide the assistant response (next message)
      const userIndex = Number(node.dataset.gptBmIndex || 0);
      for (const [key, candidateNode] of this.state.nodeByKey.entries()) {
        const candidateIndex = Number(candidateNode.dataset.gptBmIndex || 0);
        const candidateRole = candidateNode.dataset.gptBmRole;
        if (candidateIndex === userIndex + 1 && candidateRole === "system") {
          this.state.hiddenMessageKeys.add(key);
          this.messageManager.applyHiddenState(candidateNode, key);
          break;
        }
      }

      await this.persistConversationState();
    }

    async removeBookmark(messageKey) {
      this.state.bookmarks = this.state.bookmarks.filter(
        (bookmark) => bookmark.messageKey !== messageKey
      );

      await this.persistConversationState();
      this.panel.refresh();
      this.messageManager.updateBookmarkButtonForMessage(messageKey);
    }

    refreshMessageBindings() {
      this.messageManager.refresh();
    }

    scrollToBookmark(bookmark) {
      let node = this.state.nodeByKey.get(bookmark.messageKey);
      if (!node) {
        this.refreshMessageBindings();
        node = this.state.nodeByKey.get(bookmark.messageKey);
      }

      if (!node) {
        return;
      }

      // Unhide the user message if hidden
      if (this.state.hiddenMessageKeys.has(bookmark.messageKey)) {
        this.state.hiddenMessageKeys.delete(bookmark.messageKey);
        this.messageManager.applyHiddenState(node, bookmark.messageKey);
        this.persistConversationState().catch(() => {});
      }

      // Unhide the assistant response if hidden
      if (bookmark.assistantMessageKey && this.state.hiddenMessageKeys.has(bookmark.assistantMessageKey)) {
        const assistantNode = this.state.nodeByKey.get(bookmark.assistantMessageKey);
        if (assistantNode) {
          this.state.hiddenMessageKeys.delete(bookmark.assistantMessageKey);
          this.messageManager.applyHiddenState(assistantNode, bookmark.assistantMessageKey);
          this.persistConversationState().catch(() => {});
        }
      }

      node.scrollIntoView({ behavior: "smooth", block: "center" });

      // Highlight both user message and assistant response
      node.classList.add("gpt-bm-highlight");
      if (bookmark.assistantMessageKey) {
        const assistantNode = this.state.nodeByKey.get(bookmark.assistantMessageKey);
        if (assistantNode) {
          assistantNode.classList.add("gpt-bm-highlight");
          window.setTimeout(() => {
            assistantNode.classList.remove("gpt-bm-highlight");
          }, ns.constants.HIGHLIGHT_DURATION_MS);
        }
      }

      window.setTimeout(() => {
        node.classList.remove("gpt-bm-highlight");
      }, ns.constants.HIGHLIGHT_DURATION_MS);
    }

    connectMutationObserver() {
      if (this.state.observer) {
        return;
      }

      this.state.observer = new MutationObserver(() => {
        this.debouncedRefreshMessageBindings();
      });
      this.state.observer.observe(document.body, {
        subtree: true,
        childList: true
      });
    }

    async handleRouteChange(force) {
      const nextConversationId = ns.utils.getConversationIdFromUrl(location.href);
      if (!force && nextConversationId === this.state.conversationId) {
        return;
      }

      this.state.conversationId = nextConversationId;
      await this.loadConversationState(this.state.conversationId);
      this.refreshMessageBindings();
      this.panel.refresh();
    }

    startRouteWatcher() {
      window.setInterval(() => {
        if (location.href === this.state.url) {
          return;
        }

        this.state.url = location.href;
        this.handleRouteChange(false).catch(() => {});
      }, ns.constants.ROUTE_WATCH_INTERVAL_MS);
    }

    bootstrap() {
      this.panel.ensurePanel();
      this.connectMutationObserver();
      this.startRouteWatcher();

      this.handleRouteChange(true).catch(() => {});
      window.setTimeout(() => {
        this.refreshMessageBindings();
        this.panel.refresh();
      }, 900);
    }
  }

  ns.App = App;
})();
