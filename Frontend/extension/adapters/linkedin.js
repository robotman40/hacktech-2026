/* adapters/linkedin.js — LinkedIn Messaging */
(function () {
  class LinkedInAdapter extends BaseAdapter {
    constructor() { super("linkedin.com"); }

    get label() { return "LinkedIn Messaging"; }

    isActive() {
      return (
        location.hostname.includes("linkedin.com") &&
        (location.pathname.startsWith("/messaging") ||
         location.search.includes("msgConversationId") ||
         !!document.querySelector(".msg-overlay-conversation-bubble"))
      );
    }

    getConversationRoot() {
      return (
        document.querySelector(".msg-s-message-list-container") ||
        document.querySelector(".msg-s-message-list") ||
        document.querySelector('[data-test="msg-thread"]') ||
        document.querySelector(".msg-overlay-conversation-bubble")
      );
    }

    getInputElement() {
      return (
        document.querySelector(".msg-form__contenteditable") ||
        document.querySelector('[contenteditable="true"][aria-label*="message"]') ||
        document.querySelector('[role="textbox"][contenteditable="true"]')
      );
    }

    getSendButton() {
      return (
        document.querySelector(".msg-form__send-button") ||
        document.querySelector('button[aria-label*="Send"]') ||
        document.querySelector('[data-test="msg-form-send-button"]')
      );
    }

    extractMessages() {
      const messages = [];

      const events = document.querySelectorAll(
        ".msg-s-event-listitem, .msg-s-message-list__event"
      );

      events.forEach((event) => {
        const senderEl =
          event.querySelector(".msg-s-message-group__name") ||
          event.querySelector(".msg-s-event-listitem__link") ||
          event.querySelector("[href*='/in/']");

        const bodyEls = event.querySelectorAll(
          ".msg-s-event-listitem__body, .msg-s-event-listitem__message-bubble p, [dir='ltr']"
        );

        bodyEls.forEach((body) => {
          const text = body.innerText?.trim();
          if (!text || text.length < 2) return;

          const senderName = senderEl?.innerText?.trim() || "";
          const isYou =
            senderName === "" ||
            event.classList.contains("msg-s-event-listitem--is-me");

          const user = isYou ? "You" : (senderName || "Them");
          messages.push({ user, message: text, timestamp: null });
        });
      });

      return messages;
    }
  }

  window.LinkedInAdapter = LinkedInAdapter;
})();
