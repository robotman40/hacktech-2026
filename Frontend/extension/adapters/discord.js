/* adapters/discord.js — Discord DMs and server channels */
(function () {
  class DiscordAdapter extends BaseAdapter {
    constructor() { super("discord.com"); }

    get label() { return "Discord"; }

    isActive() {
      return (
        location.hostname.includes("discord.com") &&
        (location.pathname.includes("/channels/") ||
         location.pathname.includes("/@me"))
      );
    }

    getConversationRoot() {
      return (
        document.querySelector('[class*="messagesWrapper"]') ||
        document.querySelector('ol[data-list-id="chat-messages"]') ||
        document.querySelector('[class*="chatContent"]') ||
        document.querySelector('[class*="scrollableContainer"]')
      );
    }

    getInputElement() {
      return (
        document.querySelector('[role="textbox"][data-slate-editor]') ||
        document.querySelector('[contenteditable="true"][role="textbox"]') ||
        document.querySelector('[aria-label*="Message"]')
      );
    }

    getSendButton() {
      // Discord sends on Enter; no visible send button in default layout
      return null;
    }

    extractMessages() {
      const messages = [];

      // Discord renders each message group in an <li> with a consistent structure
      const items = document.querySelectorAll(
        'li[id^="chat-messages-"], li[class*="messageListItem"]'
      );

      items.forEach((li) => {
        // Username is in the header of a message group; subsequent messages in
        // the same group reuse the previous sender — track via data attribute
        const usernameEl =
          li.querySelector('[class*="username"]') ||
          li.querySelector('[class*="headerText"] span') ||
          li.querySelector('h3 span');

        // Message content
        const contentEls = li.querySelectorAll(
          '[class*="messageContent"], [id^="message-content-"]'
        );

        contentEls.forEach((content) => {
          const text = content.innerText?.trim();
          if (!text || text.length < 2) return;

          // Identify "You" by checking if the message has the "replying to yourself" marker
          // or by checking the author's tag against the logged-in user's display
          // (simplest reliable heuristic: Discord adds no class for "own" outside the
          //  accessibility tree, so we fall back to username text)
          const rawUser = usernameEl?.innerText?.trim() || "";

          // Discord stores the viewer's username in the account switcher
          const selfEl =
            document.querySelector('[class*="nameTag"] [class*="username"]') ||
            document.querySelector('[aria-label*="Account switching"] [class*="username"]');
          const selfName = selfEl?.innerText?.trim() || "";

          const user = selfName && rawUser === selfName ? "You" : (rawUser || "Them");
          messages.push({ user, message: text, timestamp: null });
        });
      });

      return messages;
    }
  }

  window.DiscordAdapter = DiscordAdapter;
})();
