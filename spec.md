# GPT Bookmarks Extension Spec

## 1) Product Summary

`GPT Bookmarks` is a Chrome Manifest V3 extension that augments ChatGPT web conversations (`chat.openai.com`, `chatgpt.com`) with:

- Message-level bookmarking
- One-click jump navigation to saved messages
- Local hide/delete behavior for individual message blocks

All state is client-side only and scoped per conversation.

## 2) Scope

### In Scope

- Hover controls on conversation messages:
  - Bookmark toggle
  - Hide (local delete) action
- Persistent bookmark panel anchored on the left side
- Jump-to-message from bookmark panel with brief visual highlight
- Bookmark removal from panel
- Persist bookmarks + hidden messages across reloads via `chrome.storage.local`

### Out of Scope

- Any server-side message deletion
- Editing assistant/user message content
- Sync to cloud or cross-browser accounts

## 3) Target Platform

- Browser Extension: Chrome MV3
- Target domains:
  - `https://chat.openai.com/*`
  - `https://chatgpt.com/*`

## 4) User Problems Addressed

- Long threads are hard to navigate manually
- No native message bookmarking in ChatGPT UI
- No message-level local deletion/hide capability
- High effort to revisit key answers

## 5) Core Features

## [P1] Bookmark Button

- Displayed on message hover
- Click toggles bookmark state for that message
- Bookmarked state is visually indicated (`active` icon state)
- Bookmark payload includes:
  - `conversationId`
  - `messageKey`
  - `textPreview`
  - `role`
  - `index`
  - `createdAt` (extension metadata)

## [P1] Bookmark Panel

- Persistent left-side panel on desktop widths
- Shows ordered bookmarks (newest first)
- Each item includes:
  - preview text
  - role + index + timestamp metadata
  - remove button
- Clicking item:
  - scrolls to target message
  - auto-unhides if currently hidden
  - applies temporary highlight

## [P1] Hide Message (Local Delete)

- Hide icon shown on message hover
- Click hides that message block from DOM using CSS class
- Hidden state persists across reloads
- Behavior is local-only and does not affect server conversation history

## 6) Data Model

Storage backend: `chrome.storage.local`

Top-level key:

- `gptBookmarkExtensionStateV1`

Value shape:

```json
{
  "<conversationId>": {
    "bookmarks": [
      {
        "conversationId": "abc123",
        "messageKey": "msg_42_hash",
        "textPreview": "Use FFT smoothing...",
        "role": "assistant",
        "index": 42,
        "createdAt": 1737042500000
      }
    ],
    "hiddenMessages": [
      {
        "conversationId": "abc123",
        "messageKey": "msg_17_hash"
      }
    ]
  }
}
```

Conversation ID is derived from URL path:

- `/c/{conversationId}`

## 7) Message Identity Strategy

Message key derivation order:

1. `data-message-id` on message node
2. Node `id`
3. Descendant `data-message-id`
4. `data-testid` (`conversation-turn-*`)
5. Fallback hash of `(role + index + preview snippet)`

This provides robust matching across UI rerenders while gracefully degrading when stable IDs are unavailable.

## 8) UI/DOM Behavior

- Content script scans ChatGPT conversation nodes using resilient selector fallbacks.
- A `MutationObserver` rebinds controls when the page rerenders.
- Route watcher detects SPA URL changes and reloads state when conversation changes.
- Hover controls and panel are injected without modifying server data.

## 9) File Layout

- `manifest.json`: MV3 manifest + permissions + content script registration
- `content.js`: main runtime logic (scan, actions, storage, panel, observers)
- `styles.css`: panel styling, hover controls, hidden/highlight states
- `spec.md`: this product + technical spec

## 10) Acceptance Criteria

- Bookmarks can be added from message hover and persist after reload.
- Bookmarks render in panel with remove action.
- Clicking a bookmark navigates to the corresponding message and highlights it.
- Messages can be hidden locally and remain hidden after reload.
- Functionality is scoped per conversation ID.
- Works on both supported ChatGPT hostnames.
