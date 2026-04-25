/* content/extractor.js — extraction strategies + local pre-filter */
(function () {

  // ── Local harm patterns (pre-filter before hitting the API) ───────────────
  const HARM_PATTERNS = {
    manipulation: [
      /\b(you always|you never|after everything i'?ve? done|if you really loved)\b/i,
      /\b(you only care about yourself|you'?re? so selfish|nobody else would)\b/i,
      /\b(you'?re? nothing without me|i made you|you owe me)\b/i,
    ],
    coercion: [
      /\b(if you don'?t|or else|you have (to|no choice)|you must|i'?ll? make you)\b/i,
      /\b(better do (it|this)|you'?re? going to|comply or|no other option)\b/i,
    ],
    threats: [
      /\b(i'?ll? (hurt|kill|destroy|ruin)|you'?ll? regret|make you pay)\b/i,
      /\b(watch your back|coming for you|you'?re? dead|i know where you)\b/i,
      /\b(leak your (nudes?|photos?|pics?|address)|post your|expose you)\b/i,
    ],
    harassment: [
      /\b(stupid|idiot|moron|worthless|pathetic|useless|disgusting|freak)\b/i,
      /\b(kill yourself|kys|go die|nobody likes you|everyone hates you)\b/i,
    ],
    gaslighting: [
      /\b(that never happened|you'?re? imagining|you'?re? crazy|you'?re? overreacting)\b/i,
      /\b(you'?re? too sensitive|it was just a joke|you'?re? being paranoid)\b/i,
      /\b(stop making things up|i never said that|your memory is wrong)\b/i,
    ],
    scams: [
      /\b(send (me )?money|wire transfer|bitcoin|crypto|gift card|investment opportunity)\b/i,
      /\b(click (this |the )?link|verify your account|your account (will be|has been) (suspended|banned))\b/i,
      /\b(nigerian prince|lottery winner|unclaimed inheritance|lucky winner)\b/i,
      /\b(make \$?\d+\s*(a day|per day|weekly|daily)|work from home opportunity)\b/i,
    ],
    impersonation: [
      /\b(i'?m? from (google|facebook|instagram|microsoft|apple|amazon|your bank|paypal))\b/i,
      /\b(official representative|verified (agent|support)|customer (service|support) (team|here))\b/i,
      /\b(this is (an? )?official (notice|message)|on behalf of)\b/i,
    ],
  };

  const SENSITIVITY_THRESHOLDS = {
    low:    3,   // require 3+ pattern hits
    medium: 1,   // any single hit
    high:   1,   // any hit in any category
  };

  const Extractor = {
    // ── Simple hash for dedup ───────────────────────────────────────────────
    hashMessages(messages) {
      return messages.map((m) => `${m.user}\x00${m.message}`).join("\x01");
    },

    // ── Local pre-filter ────────────────────────────────────────────────────
    // Returns { flagged: bool, categories: string[], hitCount: number }
    preFilter(messages, sensitivity = "medium") {
      const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? 1;
      const categories = new Set();
      let hitCount = 0;

      // Only scan incoming messages for harm patterns
      const incoming = messages.filter((m) => m.user !== "You");
      const combined = incoming.map((m) => m.message).join(" ");

      for (const [category, patterns] of Object.entries(HARM_PATTERNS)) {
        for (const re of patterns) {
          if (re.test(combined)) {
            categories.add(category);
            hitCount++;
          }
        }
      }

      return {
        flagged: hitCount >= threshold,
        categories: [...categories],
        hitCount,
      };
    },

    // ── Full extraction via adapter ─────────────────────────────────────────
    extract(adapter) {
      if (!adapter) return [];
      try {
        const raw = adapter.extractMessages();
        // Normalise: trim, drop empty
        return raw
          .map((m) => ({
            user:      (m.user || "Unknown").trim(),
            message:   (m.message || "").trim(),
            timestamp: m.timestamp || null,
          }))
          .filter((m) => m.message.length > 0);
      } catch (err) {
        console.warn("[SafeChat] extractor error:", err);
        return [];
      }
    },

    // ── Input capture (current draft) ───────────────────────────────────────
    extractDraft(adapter) {
      if (!adapter) return "";
      try { return adapter.extractDraftMessage(); }
      catch { return ""; }
    },
  };

  window.Extractor = Extractor;
})();
