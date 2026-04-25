let lastHtmlSignature = "";
let lastBannerAt = 0;
let lastBannerSignature = "";
const MAX_MESSAGES = 24;
const OPEN_SANS_CSS_URL = "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap";

function currentPageHtml() {
  return document.documentElement?.outerHTML || "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function htmlSignature(html) {
  return `${html.length}:${html.slice(0, 200)}`;
}

function hostname() {
  return window.location.hostname.toLowerCase();
}

function pagePlatform() {
  const host = hostname();
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("discord.com")) return "discord";
  if (host.includes("web.whatsapp.com")) return "whatsapp";
  if (host.includes("messenger.com") || host.includes("facebook.com")) return "messenger";
  return "generic";
}

function inferSpeaker(element) {
  const classText = `${element.className || ""} ${element.parentElement?.className || ""}`.toLowerCase();
  if (classText.includes("adult")) return "sender";
  if (classText.includes("child")) return "receiver";

  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const viewportCenter = window.innerWidth / 2;
  const ariaLabel =
    element.closest("[aria-label]")?.getAttribute("aria-label") ||
    element.getAttribute("aria-label") ||
    "";
  const lowered = ariaLabel.toLowerCase();

  if (lowered.includes("you sent") || lowered.includes("sent by you")) return "sender";
  if (lowered.includes("sent by")) return "receiver";
  if (centerX > viewportCenter + 80) return "sender";
  if (centerX < viewportCenter - 80) return "receiver";
  return "unknown";
}

function buildMessage(node, overrides = {}) {
  const text = normalizeText(node.innerText || node.textContent);
  if (!text || text.length < 2 || text.length > 260) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  return {
    speaker: overrides.speaker || inferSpeaker(node),
    text,
    platform: pagePlatform(),
    timestamp: overrides.timestamp || null,
    source: overrides.source || "generic",
    top: Math.round(rect.top)
  };
}

function collectUniqueMessages(nodes, source) {
  const seen = new Set();
  const messages = [];
  for (const node of nodes) {
    const message = buildMessage(node, { source });
    if (!message) continue;
    const key = `${message.top}:${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(message);
  }
  return messages;
}

function extractInstagramMessages() {
  const results = [];
  const messageContainers = document.querySelectorAll("[role='main'] [role='listitem'], main li, main article div");
  for (const container of messageContainers) {
    const leaves = [...container.querySelectorAll("[dir='auto']")].filter(
      (node) => !node.querySelector("[dir='auto']")
    );
    for (const leaf of leaves) {
      const aria = normalizeText(container.getAttribute("aria-label") || leaf.getAttribute("aria-label") || "");
      let speaker = inferSpeaker(leaf);
      if (aria.toLowerCase().includes("you sent")) speaker = "sender";
      if (aria.toLowerCase().includes("sent by")) speaker = "receiver";
      const message = buildMessage(leaf, { speaker, source: "instagram" });
      if (message) results.push(message);
    }
  }
  return results;
}

function extractGenericMessages() {
  const selectors = [
    ".msg",
    ".chat .msg",
    "[role='listitem'] [dir='auto']",
    "[role='row'] [dir='auto']",
    "main [dir='auto']",
    "article [dir='auto']",
    "div[dir='auto']"
  ];
  const nodes = [...document.querySelectorAll(selectors.join(", "))].filter(
    (node) => !node.querySelector("[dir='auto']")
  );
  return collectUniqueMessages(nodes, "generic");
}

function extractConversationMessages() {
  let messages = [];
  if (pagePlatform() === "instagram") {
    messages = extractInstagramMessages();
  }
  if (!messages.length) {
    messages = extractGenericMessages();
  }

  const deduped = [];
  const seen = new Set();
  for (const message of messages) {
    const key = `${message.top}:${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }

  return deduped.slice(-MAX_MESSAGES).map(({ top, ...message }) => message);
}

function renderFlaggedMessages(result) {
  const items = Array.isArray(result?.flagged_messages) ? result.flagged_messages.slice(0, 3) : [];
  if (!items.length) return "";

  const html = items
    .map(
      (item) => `
        <div style="margin-top:8px;padding:10px 12px;border-radius:12px;background:#fffdfa;border:1px solid rgba(55,53,47,0.12);color:#37352f;">
          <div style="color:#2f7d4f;"><b>${item.speaker || "unknown"}</b>: ${item.text || ""}</div>
          <div style="margin-top:5px;color:#37352f;">Reasons: ${(item.reasons || []).map(threatLabel).join(", ") || "None"}</div>
          <div style="margin-top:5px;color:#6b6a67;">Matched: ${(item.phrases || []).join(" | ") || "None"}</div>
        </div>
      `
    )
    .join("");
  return `<div style="margin-top:10px;font-size:12px;line-height:1.4;"><b>Flagged messages</b>${html}</div>`;
}

function conciseActionLabel(action) {
  const labels = {
    none: "No action",
    monitor: "Monitor",
    warn_user: "Warn user",
    block_and_alert_guardian: "Block and alert guardian"
  };
  return labels[action] || action || "Monitor";
}

function conciseEvaluation(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  const sentence = value.split(/(?<=[.!?])\s+/)[0] || value;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}...` : sentence;
}

function threatLabel(threat) {
  const labels = {
    GROOMING: "Trust grooming",
    SEXUAL_CONTENT: "Sexual content",
    PII_SOLICITATION: "Personal info request",
    PLATFORM_MIGRATION: "Move off-platform",
    THREATS_COERCION: "Threats or coercion",
    SELF_HARM_CONTENT: "Self-harm content",
    HATE_HARASSMENT: "Harassment",
    FINANCIAL_SCAM: "Financial scam",
    OBFUSCATION: "Hidden language"
  };
  return labels[threat] || threat.replaceAll("_", " ").toLowerCase();
}

function renderThreatChips(threats) {
  if (!Array.isArray(threats) || !threats.length) return "None";
  return threats
    .map(
      (threat) =>
        `<span style="display:inline-flex;align-items:center;margin:4px 6px 0 0;padding:5px 9px;border-radius:999px;background:#fff1ef;color:#c4554d;border:1px solid rgba(196,85,77,0.14);font-size:11px;font-weight:700;">${threatLabel(threat)}</span>`
    )
    .join("");
}

function ensureOpenSans() {
  if (document.getElementById("hacktech-open-sans")) return;
  const link = document.createElement("link");
  link.id = "hacktech-open-sans";
  link.rel = "stylesheet";
  link.href = OPEN_SANS_CSS_URL;
  document.head.appendChild(link);
}

function showBanner(result, threshold) {
  if (Number(result?.danger_rating || 0) < Number(threshold || 40)) return;
  ensureOpenSans();

  const now = Date.now();
  const bannerSignature = JSON.stringify({
    danger: Number(result?.danger_rating || 0),
    evaluation: String(result?.evaluation || ""),
    highestRiskMessage: String(result?.highest_risk_message || ""),
    threats: (result?.threats_detected || []).join("|"),
    scanned: Number(result?.scanned_messages || 0)
  });
  if (bannerSignature === lastBannerSignature && now - lastBannerAt < 3000) return;
  lastBannerAt = now;
  lastBannerSignature = bannerSignature;

  const existing = document.getElementById("hacktech-safety-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "hacktech-safety-banner";
  banner.style.position = "fixed";
  banner.style.top = "16px";
  banner.style.right = "16px";
  banner.style.maxWidth = "420px";
  banner.style.zIndex = "2147483647";
  banner.style.padding = "16px";
  banner.style.borderRadius = "18px";
  banner.style.border = "1px solid rgba(55,53,47,0.14)";
  banner.style.borderLeft = "5px solid #c4554d";
  banner.style.background = "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(251,251,250,0.96))";
  banner.style.color = "#37352f";
  banner.style.fontFamily = "'Open Sans', ui-sans-serif, sans-serif";
  banner.style.boxShadow = "0 18px 45px rgba(15,23,42,0.16)";
  banner.style.backdropFilter = "blur(10px)";
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
      <div style="font-weight:700;font-size:15px;">Hacktech Safety Alert</div>
      <div style="padding:4px 8px;border-radius:999px;background:#fff1ef;color:#c4554d;font-size:11px;font-weight:700;">Risk ${result.danger_rating}</div>
    </div>
    <div style="font-size:12px;line-height:1.6;">
      <div><b>${conciseActionLabel(result.recommended_action || "monitor")}</b></div>
      <div style="margin-top:8px;">${renderThreatChips(result.threats_detected || [])}</div>
      ${
        conciseEvaluation(result.evaluation)
          ? `<div style="margin-top:10px;color:#4b5563;">${conciseEvaluation(result.evaluation)}</div>`
          : ""
      }
    </div>
    ${
      result.highest_risk_message
        ? `<div style="margin-top:10px;font-size:12px;line-height:1.5;background:#f7f6f3;border-radius:12px;padding:10px;border:1px solid rgba(55,53,47,0.1);">
            <b>Highest-risk message:</b><br/>${result.highest_risk_message}
          </div>`
        : ""
    }
    <button id="hacktech-safety-close" style="margin-top:12px;background:#fff;color:#37352f;border:1px solid rgba(55,53,47,0.15);border-radius:10px;padding:7px 12px;cursor:pointer;font-weight:600;">Dismiss</button>
  `;

  document.body.appendChild(banner);
  banner.querySelector("#hacktech-safety-close")?.addEventListener("click", () => banner.remove());
}

function scanPage() {
  const html = currentPageHtml();
  const pageText = normalizeText(document.body?.innerText || "");
  const messages = extractConversationMessages();
  const signature = `${htmlSignature(html)}:${JSON.stringify(messages.slice(-6))}`;
  if (signature === lastHtmlSignature) return;
  lastHtmlSignature = signature;
  console.log("[Hacktech Safety] Scanning page", window.location.href, signature);

  chrome.runtime.sendMessage(
    {
      type: "SCAN_PAGE_HTML",
      pageUrl: window.location.href,
      html,
      pageText,
      platform: pagePlatform(),
      messages
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Hacktech Safety] Runtime error", chrome.runtime.lastError.message);
        return;
      }
      if (!response?.success || response?.skipped) {
        console.warn("[Hacktech Safety] Scan skipped or failed", response);
        return;
      }
      console.log("[Hacktech Safety] Scan result", response.result);
      showBanner(response.result, response.settings?.warningThreshold);
    }
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TRIGGER_SCAN") {
    console.log("[Hacktech Safety] Manual or alarm-triggered scan");
    scanPage();
  }
});

console.log("[Hacktech Safety] Content script loaded on", window.location.href);
window.setTimeout(scanPage, 1500);
const observer = new MutationObserver(() => {
  window.setTimeout(scanPage, 1200);
});
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
