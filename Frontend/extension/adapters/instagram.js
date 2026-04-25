/* adapters/instagram.js — Instagram Direct Messages */
(function () {
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

    getConversationRoot() {
      // Message thread list — role="list" inside the DM view
      return (
        document.querySelector('[role="list"][class*="x1n2onr6"]') ||
        document.querySelector('div[role="list"]') ||
        document.querySelector('[aria-label*="Messages"]') ||
        document.querySelector("main")
      );
    }

    getInputElement() {
      return (
        document.querySelector('[contenteditable="true"][aria-placeholder]') ||
        document.querySelector('[contenteditable="true"][aria-label*="message"]') ||
        document.querySelector('[role="textbox"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[type="submit"][aria-label*="Send"]') ||
        document.querySelector('button[aria-label*="Send"]') ||
        document.querySelector('[data-testid="send-message-button"]')
      );
    }

    extractMessages() {
      const messages = [];
      // Instagram wraps each message in a listitem
      const items = document.querySelectorAll('[role="listitem"]');

      items.forEach((item) => {
        // Determine direction by checking which side the bubble is on
        const outgoing =
          item.querySelector('[data-testid="outgoing-message"]') !== null ||
          item.classList.contains("x1n2onr6") ||                  // heuristic
          item.style.alignItems === "flex-end" ||
          !!item.querySelector('[aria-label*="You"]');

        // Extract text — Instagram wraps message text in a span/div with dir="auto"
        const textEl =
          item.querySelector('div[dir="auto"]') ||
          item.querySelector("span") ||
          item.querySelector("div > div > div");

        if (!textEl) return;
        const text = textEl.innerText?.trim();
        if (!text || text.length === 0) return;

        // Try to get sender label from avatar aria-label
        const avatar = item.querySelector('[aria-label]');
        const senderHint = avatar?.getAttribute("aria-label") || "";
        const user = outgoing ? "You" : (senderHint || "Them");

        messages.push({ user, message: text, timestamp: null });
      });

      return messages;
    }
  }

  window.InstagramAdapter = InstagramAdapter;
})();
