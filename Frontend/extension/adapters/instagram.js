/* adapters/instagram.js — Instagram Direct Messages */
(function () {

  // aria-label values that belong to the sidebar inbox list, not the thread.
  const SIDEBAR_LIST_LABELS = /^(conversations|chats|direct|inbox|messages inbox)/i;

  // Listitems in the sidebar are navigation links to threads.
  // Real message listitems are bubble elements — they don't wrap themselves in an <a>.
  function _isSidebarItem(listitem) {
    return !!listitem.querySelector('a[href*="/direct/t/"], a[href*="/t/"]');
  }

  // A valid message listitem must have readable text in a dir="auto" node.
  function _hasMessageText(listitem) {
    const node = listitem.querySelector('[dir="auto"]');
    return node && node.innerText.trim().length > 0;
  }

  class InstagramAdapter extends BaseAdapter {
    constructor() { super("instagram.com"); }

    get label() { return "Instagram DMs"; }

    isActive() {
      return (
        location.hostname.includes("instagram.com") &&
        (location.pathname.startsWith("/direct") ||
         location.pathname.includes("/t/"))
      );
    }

    // ── Active thread container ─────────────────────────────────────────────
    // Instagram renders two role="list" nodes on the DM page:
    //   1. The inbox sidebar  — aria-label ~ "Conversations", items are <a> links
    //   2. The active thread  — aria-label ~ "Chat with X", items are message bubbles
    //
    // The most reliable anchor is the composer input: it only exists inside the
    // active chat panel. Walking up from the input to the nearest ancestor that
    // also contains a role="list" with message content gives us exactly the thread.
    _getActiveThreadContainer() {
      const input = this.getInputElement();
      if (!input) return null;

      // Walk up from the input until we find a shared ancestor that contains
      // a role="list" with actual message bubbles (dir="auto" text nodes).
      let el = input.parentElement;
      while (el && el !== document.body) {
        const list = el.querySelector('[role="list"]');
        if (list) {
          const label = (list.getAttribute("aria-label") || "").trim();
          // Reject if this list is the sidebar inbox.
          if (SIDEBAR_LIST_LABELS.test(label)) {
            el = el.parentElement;
            continue;
          }
          // Confirm the list actually holds message bubbles, not nav links.
          if (list.querySelector('[dir="auto"]')) return list;
        }
        el = el.parentElement;
      }

      // Fallback: scan all role="list" nodes and pick the one that is clearly
      // the thread (not the inbox sidebar) by checking its aria-label and content.
      const allLists = document.querySelectorAll('[role="list"]');
      for (const list of allLists) {
        const label = (list.getAttribute("aria-label") || "").trim();
        if (SIDEBAR_LIST_LABELS.test(label)) continue;
        if (list.querySelector('[dir="auto"]')) return list;
      }

      return null;
    }

    // Returns the thread root for the MutationObserver.
    getConversationRoot() {
      return this._getActiveThreadContainer();
    }

    getInputElement() {
      return (
        document.querySelector('[contenteditable="true"][aria-placeholder]') ||
        document.querySelector('[contenteditable="true"][aria-label*="message" i]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[type="submit"][aria-label*="Send" i]') ||
        document.querySelector('button[aria-label*="Send" i]') ||
        document.querySelector('[data-testid="send-message-button"]')
      );
    }

    extractMessages() {
      // Scope entirely to the active thread — never touch document-level selectors.
      const root = this._getActiveThreadContainer();
      if (!root) return [];

      const messages = [];
      const items = root.querySelectorAll('[role="listitem"]');

      items.forEach((item) => {
        // Drop sidebar/nav items that might be nested inside a shared wrapper.
        if (_isSidebarItem(item)) return;
        // Drop separators, system notices, or empty nodes.
        if (!_hasMessageText(item)) return;

        // ── Direction detection ────────────────────────────────────────────
        // Priority order: explicit testid → computed flex alignment → aria hint.
        let outgoing =
          !!item.querySelector('[data-testid="outgoing-message"]') ||
          !!item.querySelector('[aria-label*="You sent" i]');

        if (!outgoing) {
          // Instagram right-aligns outgoing bubbles via justify-content: flex-end
          // on the immediate wrapper div inside the listitem.
          const wrapper = item.firstElementChild;
          if (wrapper) {
            const jc = window.getComputedStyle(wrapper).justifyContent;
            outgoing = jc === "flex-end" || jc === "end";
          }
        }

        // ── Text extraction ────────────────────────────────────────────────
        // Prefer the deepest dir="auto" node to avoid capturing ancestor labels.
        const allDirAuto = item.querySelectorAll('[dir="auto"]');
        // The deepest one (last in DOM order) is the message bubble text.
        const textEl = allDirAuto.length
          ? allDirAuto[allDirAuto.length - 1]
          : item.querySelector("span") || item.querySelector("div > div > div");

        if (!textEl) return;
        const text = textEl.innerText?.trim();
        if (!text) return;

        // ── Sender resolution ──────────────────────────────────────────────
        // For incoming messages, the avatar's aria-label holds the contact name.
        // Outgoing messages have no avatar, or an avatar labelled with your name.
        const avatarImg = item.querySelector(
          'img[alt]:not([alt=""]):not([alt="Avatar"])'
        );
        const senderHint = outgoing ? "" : (avatarImg?.getAttribute("alt") || "");
        const user = outgoing ? "You" : (senderHint || "Them");

        messages.push({ user, message: text, timestamp: null });
      });

      return messages;
    }
  }

  window.InstagramAdapter = InstagramAdapter;
})();
