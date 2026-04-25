/* adapters/base.js — BaseAdapter contract every platform adapter must implement */
(function () {
  class BaseAdapter {
    constructor(hostname) {
      this.hostname = hostname;
    }

    // Returns true if this adapter is active on the current page/URL.
    isActive() {
      return false;
    }

    // Returns the root DOM element that contains the conversation.
    // Used by MutationObserver to scope change detection.
    getConversationRoot() {
      return null;
    }

    // Returns the message input element (textarea / contenteditable).
    getInputElement() {
      return null;
    }

    // ── Core extraction ─────────────────────────────────────────────────────

    // Returns array of { user: string, message: string, timestamp: string|null }
    // "You" for outgoing, contact name or "Them" for incoming.
    extractMessages() {
      return [];
    }

    // Returns the current value of the composer input (typed but not sent yet).
    extractDraftMessage() {
      const el = this.getInputElement();
      if (!el) return "";
      return el.innerText || el.value || "";
    }

    // ── Trigger detection ────────────────────────────────────────────────────

    // Attach listeners for send/submit/paste events on the input.
    // `callback(draftText)` is called on each trigger.
    attachSendTrigger(callback) {
      const input = this.getInputElement();
      if (!input) return;

      // Enter key (most platforms send on Enter)
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          callback(this.extractDraftMessage());
        }
      });

      // Paste
      input.addEventListener("paste", () => {
        setTimeout(() => callback(this.extractDraftMessage()), 50);
      });

      // Click on send button if platform exposes one
      const btn = this.getSendButton();
      if (btn) {
        btn.addEventListener("click", () => callback(this.extractDraftMessage()));
      }
    }

    // Override in subclass to return platform-specific send button element.
    getSendButton() {
      return null;
    }

    // Human-readable label for the adapter (shown in options UI).
    get label() {
      return this.hostname;
    }
  }

  window.BaseAdapter = BaseAdapter;
})();
