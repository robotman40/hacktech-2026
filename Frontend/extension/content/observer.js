/* content/observer.js — MutationObserver lifecycle + polling scheduler */
(function () {

  class ConversationObserver {
    constructor({ adapter, onchange, debounceMs = 800 }) {
      this.adapter      = adapter;
      this.onchange     = onchange;    // called with (messages) when thread changes
      this.debounceMs   = debounceMs;
      this._observer   = null;
      this._debounce   = null;
      this._pollTimer  = null;
      this._lastHash   = "";
      this._root       = null;
    }

    // ── Start ──────────────────────────────────────────────────────────────

    start(pollIntervalSec = 60) {
      this._attachObserver();
      this._startPolling(pollIntervalSec);

      // Re-attach if the conversation root is replaced by a SPA navigation
      this._navObserver = new MutationObserver(() => {
        if (!document.contains(this._root)) {
          this._detachObserver();
          this._attachObserver();
        }
      });
      this._navObserver.observe(document.body, { childList: true, subtree: false });
    }

    stop() {
      this._detachObserver();
      clearInterval(this._pollTimer);
      clearTimeout(this._debounce);
      this._navObserver?.disconnect();
    }

    // ── MutationObserver ──────────────────────────────────────────────────

    _attachObserver() {
      this._root = this.adapter.getConversationRoot();
      if (!this._root) return;

      this._observer = new MutationObserver(() => {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._tick("mutation"), this.debounceMs);
      });

      this._observer.observe(this._root, {
        childList:     true,
        subtree:       true,
        characterData: true,
      });
    }

    _detachObserver() {
      this._observer?.disconnect();
      this._observer = null;
    }

    // ── Polling fallback ──────────────────────────────────────────────────

    _startPolling(intervalSec) {
      clearInterval(this._pollTimer);
      this._pollTimer = setInterval(
        () => this._tick("poll"),
        intervalSec * 1000
      );
      // Also run immediately on start
      this._tick("init");
    }

    // ── Core tick ─────────────────────────────────────────────────────────

    _tick(reason) {
      const messages = Extractor.extract(this.adapter);
      if (messages.length === 0) return;

      const hash = Extractor.hashMessages(messages);
      if (hash === this._lastHash) return; // nothing changed
      this._lastHash = hash;

      this.onchange(messages, reason);
    }

    // Allow the poll interval to be updated at runtime (e.g. from options page).
    updatePollInterval(newSec) {
      this._startPolling(newSec);
    }
  }

  window.ConversationObserver = ConversationObserver;
})();
