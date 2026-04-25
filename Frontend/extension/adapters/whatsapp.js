/* adapters/whatsapp.js — WhatsApp Web (web.whatsapp.com) */
(function () {
  class WhatsAppAdapter extends BaseAdapter {
    constructor() { super("web.whatsapp.com"); }

    get label() { return "WhatsApp Web"; }

    isActive() {
      return location.hostname === "web.whatsapp.com";
    }

    getConversationRoot() {
      return (
        document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
        document.querySelector("#main") ||
        document.querySelector('[data-testid="msg-container"]')?.closest("div") ||
        document.querySelector('[aria-label*="Messages"]')
      );
    }

    getInputElement() {
      return (
        document.querySelector('[data-testid="conversation-compose-box-input"]') ||
        document.querySelector('[contenteditable="true"][data-tab]') ||
        document.querySelector('[title="Type a message"]') ||
        document.querySelector('[aria-placeholder*="message"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[data-testid="send"]') ||
        document.querySelector('[data-icon="send"]')?.closest("button") ||
        document.querySelector('button[aria-label*="Send"]')
      );
    }

    extractMessages() {
      const messages = [];

      // WhatsApp separates outgoing (.message-out) from incoming (.message-in)
      const outgoingEls = document.querySelectorAll(".message-out");
      const incomingEls = document.querySelectorAll(".message-in");

      const allEls = [];
      // Collect all with a positional sort key from the DOM order
      document.querySelectorAll(".message-in, .message-out").forEach((el) => {
        allEls.push(el);
      });

      allEls.forEach((el) => {
        const isOutgoing = el.classList.contains("message-out");

        // Text is inside span.selectable-text or [data-testid="msg-text"]
        const textEl =
          el.querySelector("[data-testid='msg-text'] span") ||
          el.querySelector("span.selectable-text") ||
          el.querySelector("span[class*='_11JPr']") ||
          el.querySelector('[dir="ltr"]') ||
          el.querySelector("span");

        const text = textEl?.innerText?.trim();
        if (!text || text.length === 0) return;

        // Extract sender name for group chats (shown above incoming messages)
        const senderEl = el.querySelector("[data-testid='author'] span") ||
          el.querySelector("span[aria-label*='contact']") ||
          el.querySelector(".copyable-text span");

        const user = isOutgoing
          ? "You"
          : senderEl?.innerText?.trim() || "Them";

        // Timestamp
        const tsEl = el.querySelector("[data-testid='msg-meta'] span") ||
          el.querySelector(".copyable-text [aria-label]");
        const timestamp = tsEl?.getAttribute("aria-label") || tsEl?.innerText || null;

        messages.push({ user, message: text, timestamp });
      });

      return messages;
    }
  }

  window.WhatsAppAdapter = WhatsAppAdapter;
})();
