/* adapters/facebook.js — Facebook Messenger (messenger.com + facebook.com/messages) */
(function () {
  class FacebookAdapter extends BaseAdapter {
    constructor() { super("facebook.com"); }

    get label() { return "Facebook Messenger"; }

    isActive() {
      return (
        location.hostname.includes("messenger.com") ||
        (location.hostname.includes("facebook.com") &&
          location.pathname.startsWith("/messages"))
      );
    }

    getConversationRoot() {
      // messenger.com conversation thread
      return (
        document.querySelector('[data-scope="messages_table"]') ||
        document.querySelector('[role="main"] [role="log"]') ||
        document.querySelector('[role="log"]') ||
        document.querySelector('[aria-label*="Conversation"]')
      );
    }

    getInputElement() {
      return (
        document.querySelector('[contenteditable="true"][role="textbox"]') ||
        document.querySelector('[aria-label*="message"][contenteditable]') ||
        document.querySelector('[contenteditable="true"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[aria-label="Press enter to send"]') ||
        document.querySelector('[data-testid="send-button"]') ||
        document.querySelector('button[aria-label*="Send"]')
      );
    }

    extractMessages() {
      const messages = [];

      // Messenger uses aria rows or grouped message elements
      const rows =
        document.querySelectorAll('[role="row"]') ||
        document.querySelectorAll('[data-testid="message-container"]');

      rows.forEach((row) => {
        // Outgoing messages are typically right-aligned / have different class
        const isOutgoing =
          row.getAttribute("data-message-owned-by-me") === "true" ||
          row.querySelector('[dir="auto"][style*="right"]') !== null ||
          !!row.querySelector('[aria-label="You"]');

        const textEls = row.querySelectorAll('[dir="auto"]');
        textEls.forEach((el) => {
          const text = el.innerText?.trim();
          if (!text) return;

          // Filter out UI noise (timestamps, reactions)
          if (text.length < 2 || /^\d{1,2}:\d{2}/.test(text)) return;

          const senderEl =
            row.querySelector('[aria-label][class*="actor"]') ||
            row.querySelector("h5 a") ||
            row.querySelector("h6 a");

          const user = isOutgoing ? "You" : (senderEl?.innerText?.trim() || "Them");
          messages.push({ user, message: text, timestamp: null });
        });
      });

      // Deduplicate consecutive identical entries
      return messages.filter(
        (m, i) =>
          i === 0 ||
          m.user !== messages[i - 1].user ||
          m.message !== messages[i - 1].message
      );
    }
  }

  window.FacebookAdapter = FacebookAdapter;
})();
