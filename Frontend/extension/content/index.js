/* content/index.js — entry point; bootstraps adapter, observer, and in-page UI */
(function () {
  const BANNER_ID = "safechat-guardian-banner";

  // ── In-page warning banner ────────────────────────────────────────────────

  function showBanner(result) {
    removeBanner();
    const { danger_rating, confidence_score, evaluation } = result;

    const colors = {
      low:    { bg: "#fff3cd", border: "#ffc107", text: "#856404" },
      medium: { bg: "#ffe0b2", border: "#fb8c00", text: "#e65100" },
      high:   { bg: "#ffcdd2", border: "#e53935", text: "#b71c1c" },
    };
    const level =
      danger_rating >= 7 ? "high" :
      danger_rating >= 4 ? "medium" : "low";
    const c = colors[level];

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    Object.assign(banner.style, {
      position:     "fixed",
      top:          "12px",
      right:        "12px",
      zIndex:       "2147483647",
      maxWidth:     "340px",
      padding:      "12px 14px",
      borderRadius: "8px",
      border:       `2px solid ${c.border}`,
      background:   c.bg,
      color:        c.text,
      fontSize:     "13px",
      lineHeight:   "1.45",
      boxShadow:    "0 4px 12px rgba(0,0,0,0.18)",
      fontFamily:   "system-ui, sans-serif",
    });

    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:18px">⚠️</span>
        <strong style="font-size:14px;">SafeChat Warning</strong>
        <span style="margin-left:auto;cursor:pointer;font-size:16px;" id="safechat-close">✕</span>
      </div>
      <div><b>Danger rating:</b> ${danger_rating}/10 &nbsp;|&nbsp; <b>Confidence:</b> ${confidence_score.toFixed(1)}%</div>
      <div style="margin-top:6px;">${evaluation}</div>
    `;

    document.body.appendChild(banner);
    document.getElementById("safechat-close")?.addEventListener("click", removeBanner);

    // Auto-dismiss after 20 s for low-level alerts
    if (level === "low") setTimeout(removeBanner, 20000);
  }

  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  // ── Main bootstrap ────────────────────────────────────────────────────────

  async function init() {
    const hostname = location.hostname.replace(/^www\./, "");
    const profile  = await StorageUtils.getProfile(hostname);

    if (!profile.enabled) return;

    const adapter = AdapterRegistry.getActive();
    if (!adapter) return; // not a supported chat page

    // Wire up send-trigger capture (analyzes outgoing draft too)
    adapter.attachSendTrigger(async (draftText) => {
      if (!draftText.trim()) return;
      const draftMessages = [{ user: "You", message: draftText, timestamp: null }];
      const pre = Extractor.preFilter(draftMessages, profile.sensitivity);
      if (pre.flagged) {
        await evaluateAndReport(draftMessages, profile, hostname, "outgoing_draft");
      }
    });

    const observer = new ConversationObserver({
      adapter,
      debounceMs: 600,
      onchange: async (messages, reason) => {
        const tabKey = `${hostname}:${location.pathname}`;
        const hash   = Extractor.hashMessages(messages);

        // Skip already-sent hash (poll fires even when nothing changed
        // if observer missed a mutation — double-check here)
        if (StorageUtils.isSeen(tabKey, hash)) return;
        StorageUtils.markSeen(tabKey, hash);

        // Pre-filter guard
        if (profile.preFilterEnabled) {
          const pre = Extractor.preFilter(messages, profile.sensitivity);
          if (!pre.flagged) return;
        }

        await evaluateAndReport(messages, profile, hostname, reason);
      },
    });

    observer.start(profile.pollInterval);

    // Re-read profile when user changes settings in the options page
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.profiles) {
        StorageUtils.getProfile(hostname).then((updated) => {
          if (!updated.enabled) {
            observer.stop();
          } else {
            observer.updatePollInterval(updated.pollInterval);
          }
        });
      }
    });
  }

  async function evaluateAndReport(messages, profile, hostname, reason) {
    const meta = {
      url:      location.href,
      hostname,
      reason,
      timestamp: Date.now(),
    };

    let result;
    try {
      result = await Messaging.evaluate(messages, meta);
    } catch (err) {
      console.warn("[SafeChat] evaluate failed:", err);
      return;
    }

    if (!result) return;

    const { danger_rating, confidence_score, evaluation } = result;

    if (
      profile.showInPageBanner &&
      danger_rating >= profile.minDangerRating
    ) {
      showBanner(result);
    }

    if (profile.notifyOnDanger && danger_rating >= profile.minDangerRating) {
      chrome.runtime.sendMessage({
        type: "safechat:notify",
        payload: { danger_rating, confidence_score, evaluation, hostname },
      });
    }
  }

  // Delay slightly so SPAs finish rendering the conversation DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1200));
  } else {
    setTimeout(init, 1200);
  }
})();
