/* adapters/twitter.js — Twitter / X Direct Messages */
(function () {
  class TwitterAdapter extends BaseAdapter {
    constructor() { super("twitter.com / x.com"); }

    get label() { return "Twitter / X DMs"; }

    isActive() {
      return (
        (location.hostname.includes("twitter.com") ||
         location.hostname === "x.com") &&
        location.pathname.startsWith("/messages")
      );
    }

    getConversationRoot() {
      return (
        document.querySelector('[data-testid="DmScrollerContainer"]') ||
        document.querySelector('[aria-label*="Timeline: Messages"]') ||
        document.querySelector('[data-testid="DMDrawer"]') ||
        document.querySelector('section[role="region"]')
      );
    }

    getInputElement() {
      return (
        document.querySelector('[data-testid="dmComposerTextInput"]') ||
        document.querySelector('[contenteditable="true"][aria-label*="Direct message"]') ||
        document.querySelector('[role="textbox"][data-testid]')
      );
    }

    getSendButton() {
      return (
        document.querySelector('[data-testid="dmComposerSendButton"]') ||
        document.querySelector('button[aria-label*="Send"]')
      );
    }

    extractMessages() {
      const messages = [];

      const entries = document.querySelectorAll(
        '[data-testid="messageEntry"], [data-testid="tweetText"], [data-testid="DmConversationMessage"]'
      );

      entries.forEach((entry) => {
        // Twitter marks outgoing with a specific test id variation
        const cellInner = entry.closest('[data-testid="conversation"]') || entry;
        const isOutgoing =
          entry.getAttribute("data-testid") === "sent" ||
          !!entry.closest('[data-testid$="-sent"]') ||
          cellInner.querySelector('[data-testid="messageEntry-sent"]') !== null ||
          entry.style?.textAlign === "right";

        const textEl =
          entry.querySelector('[data-testid="tweetText"] span') ||
          entry.querySelector("span[dir='ltr']") ||
          entry.querySelector("span[dir='auto']") ||
          entry.querySelector("div[dir='auto']") ||
          entry;

        const text = textEl?.innerText?.trim();
        if (!text || text.length < 2) return;
        if (/^[\d:apm\s,]+$/i.test(text)) return; // skip pure timestamps

        // Sender handle from avatar alt or nearby element
        const avatarImg = entry.querySelector('img[alt]') ||
          entry.closest('[data-testid]')?.querySelector('img[alt]');
        const user = isOutgoing ? "You" : (avatarImg?.alt?.trim() || "Them");

        messages.push({ user, message: text, timestamp: null });
      });

      return messages;
    }
  }

  window.TwitterAdapter = TwitterAdapter;
})();
