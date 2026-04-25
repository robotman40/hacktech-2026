/* adapters/tinder.js — Tinder web messages (tinder.com/app/messages) */
(function () {
  class TinderAdapter extends BaseAdapter {
    constructor() { super("tinder.com"); }

    get label() { return "Tinder"; }

    isActive() {
      return (
        location.hostname.includes("tinder.com") &&
        (location.pathname.includes("/messages") ||
         location.pathname.includes("/app/messages") ||
         location.pathname.includes("/app/chat"))
      );
    }

    getConversationRoot() {
      // Tinder uses React with obfuscated class names — target by role/structure
      return (
        document.querySelector('[class*="messageList"]') ||
        document.querySelector('[data-qa="chat-list"]') ||
        document.querySelector('[class*="chat"]') ||
        document.querySelector("main") ||
        document.querySelector('[class*="messages"]')
      );
    }

    getInputElement() {
      return (
        document.querySelector('[data-qa="chat-input"]') ||
        document.querySelector('textarea[placeholder*="message"]') ||
        document.querySelector('textarea[placeholder*="Say something"]') ||
        document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[data-qa="send-chat-button"]') ||
        document.querySelector('button[aria-label*="Send"]') ||
        document.querySelector('button[type="submit"]')
      );
    }

    extractMessages() {
      const messages = [];

      // Tinder alternates outgoing/incoming with distinct wrappers
      // Common: .msg--you (outgoing) .msg--them (incoming)
      // Fallback: look for chat bubbles by structural alignment
      const allBubbles =
        document.querySelectorAll('[class*="msg"]') ||
        document.querySelectorAll('[class*="message"]') ||
        document.querySelectorAll('[class*="chat"]');

      allBubbles.forEach((el) => {
        const cls = el.className || "";
        // Skip containers that hold multiple messages
        if (el.children.length > 3) return;

        const text = el.innerText?.trim();
        if (!text || text.length < 2) return;
        // Filter timestamps / icons
        if (/^[\d:apm\s]+$/i.test(text)) return;

        const isOutgoing =
          cls.includes("you") ||
          cls.includes("You") ||
          cls.includes("sent") ||
          cls.includes("outgoing") ||
          cls.includes("mine");

        const isIncoming =
          cls.includes("them") ||
          cls.includes("received") ||
          cls.includes("incoming") ||
          cls.includes("match");

        if (!isOutgoing && !isIncoming) return;

        // Try to get match name from header
        const matchNameEl = document.querySelector('[data-qa="match-name"]') ||
          document.querySelector('[class*="matchName"]') ||
          document.querySelector('[class*="userName"]');

        const user = isOutgoing ? "You" : (matchNameEl?.innerText?.trim() || "Them");
        messages.push({ user, message: text, timestamp: null });
      });

      return messages;
    }
  }

  window.TinderAdapter = TinderAdapter;
})();
