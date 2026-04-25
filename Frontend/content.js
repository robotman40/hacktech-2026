let lastConversationSignature = "";
let lastBannerAt = 0;
let lastBannerSignature = "";
let flagHoverPopover = null;
let flagHoverHideTimer = null;
let suppressMutationScan = 0;
const MAX_MESSAGES = 24;
const KANDOR_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap";

const KANDOR_FONT_SERIF =
  "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
const KANDOR_FONT_SANS = "'Inter', ui-sans-serif, system-ui, sans-serif";

const HT_FLAG = "hacktech-flag-highlight";
const HT_UI_SEL = [
  "#hacktech-safety-banner",
  "#hacktech-flag-hover-popover",
  "#hacktech-open-sans",
  ".hacktech-flag-highlight",
].join(", ");

const APP_ALERT_TITLE =
  typeof KANDOR_APP_ALERT_TITLE !== "undefined" && KANDOR_APP_ALERT_TITLE
    ? KANDOR_APP_ALERT_TITLE
    : "kandor alert";

function currentPageHtml() {
  const clone = document.documentElement?.cloneNode(true);
  clone?.querySelector("#hacktech-safety-banner")?.remove();
  clone?.querySelector("#hacktech-open-sans")?.remove();
  clone?.querySelectorAll(`.${HT_FLAG}`).forEach((el) => {
    const t = el.textContent ?? "";
    const p = el.parentNode;
    if (p) p.replaceChild(document.createTextNode(t), el);
  });
  return clone?.outerHTML || "";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Instagram / Meta (and similar sites) inline React "flight" / module config as text in
 * the DOM. It is not user chat, but it appears in dir=auto nodes and in innerText.
 */
function isLikelyNonChatNoise(text) {
  const t = String(text || "").trim();
  if (t.length < 2) return true;
  if (/\{"require"\s*:\s*\[\[/.test(t)) return true;
  if (
    /\bHasteSupportData\b|qplTimingsServerJS|ScheduledServerJS|__bbox\b|clpData/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length > 60) {
    const letters = (t.match(/[a-zA-Z]/g) || []).length;
    const structural = (t.match(/[{}[\]":\\,]/g) || []).length;
    if (structural > 25 && letters < structural) return true;
  }
  return false;
}

function skipBalancedJsonObject(s, start) {
  if (start >= s.length || s[start] !== "{") return -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

function stripFrameworkNoiseFromVisibleText(s) {
  if (!s) return "";
  let t = String(s);
  for (;;) {
    const j = t.indexOf('{"require"');
    if (j < 0) break;
    const end = skipBalancedJsonObject(t, j);
    if (end < 0) {
      t = `${t.slice(0, j)} ${t.slice(j + 1)}`;
      continue;
    }
    t = `${t.slice(0, j)} ${t.slice(end)}`;
  }
  for (;;) {
    const h = t.indexOf("HasteSupportData");
    if (h < 0) break;
    let start = t.lastIndexOf("{", h);
    if (start < 0) {
      t = `${t.slice(0, h)} ${t.slice(h + 16)}`;
      break;
    }
    const end = skipBalancedJsonObject(t, start);
    if (end < 0) break;
    t = `${t.slice(0, start)} ${t.slice(end)}`;
  }
  return normalizeText(t);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Stable fingerprint of extracted chat lines only. Ignores unrelated DOM / HTML churn.
 * Includes `href` so different threads on the same host do not share a signature.
 */
function conversationSignature(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return JSON.stringify({
    href: String(window.location.href || "").split("#")[0] || "",
    messages: list.map((m) => ({
      speaker: String(m.speaker || "unknown"),
      text: normalizeText(m.text || ""),
    })),
  });
}

function hostname() {
  return window.location.hostname.toLowerCase();
}

function pagePlatform() {
  const host = hostname();
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("discord.com")) return "discord";
  if (host.includes("web.whatsapp.com")) return "whatsapp";
  if (host.includes("messenger.com") || host.includes("facebook.com"))
    return "messenger";
  return "generic";
}

function inferSpeaker(element) {
  const classText =
    `${element.className || ""} ${element.parentElement?.className || ""}`.toLowerCase();
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

  if (lowered.includes("you sent") || lowered.includes("sent by you"))
    return "sender";
  if (lowered.includes("sent by")) return "receiver";
  if (centerX > viewportCenter + 80) return "sender";
  if (centerX < viewportCenter - 80) return "receiver";
  return "unknown";
}

function buildMessage(node, overrides = {}) {
  const text = normalizeText(node.innerText || node.textContent);
  if (!text || text.length < 2 || text.length > 260) return null;
  if (isLikelyNonChatNoise(text)) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  return {
    speaker: overrides.speaker || inferSpeaker(node),
    text,
    platform: pagePlatform(),
    timestamp: overrides.timestamp || null,
    source: overrides.source || "generic",
    top: Math.round(rect.top),
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
  const messageContainers = document.querySelectorAll(
    "[role='main'] [role='listitem'], main li, main article div",
  );
  for (const container of messageContainers) {
    const leaves = [...container.querySelectorAll("[dir='auto']")].filter(
      (node) => !node.querySelector("[dir='auto']"),
    );
    for (const leaf of leaves) {
      const aria = normalizeText(
        container.getAttribute("aria-label") ||
          leaf.getAttribute("aria-label") ||
          "",
      );
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
    "div[dir='auto']",
  ];
  const nodes = [...document.querySelectorAll(selectors.join(", "))].filter(
    (node) => !node.querySelector("[dir='auto']"),
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
  const items = Array.isArray(result?.flagged_messages)
    ? result.flagged_messages
    : [];

  const reasonChip = (label) =>
    `<span style="display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:rgba(254,242,242,0.9);color:#b91c1c;border:1px solid rgba(252,165,165,0.5);font-size:11px;font-weight:600;backdrop-filter:blur(8px)">${escapeHtml(label)}</span>`;

  const reasonsBlock = (reasons) => {
    const list = (reasons || []).map((r) => threatLabel(r)).filter(Boolean);
    if (!list.length) {
      return `<div style="margin-top:6px;color:#6b6a67;font-size:11px;">No reasons listed.</div>`;
    }
    const chips = list.map((r) => reasonChip(r)).join("");
    return `<div style="margin-top:6px;">
      <div style="font-size:12px;font-weight:600;font-family:${KANDOR_FONT_SERIF};color:#9f1239;margin-bottom:6px;">Why it was flagged</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;column-gap:6px;row-gap:6px;">${chips}</div>
    </div>`;
  };

  const cardGlass = [
    "box-sizing:border-box",
    "width:100%",
    "margin-top:8px",
    "padding:16px 18px",
    "border-radius:20px",
    "background:linear-gradient(135deg, rgba(255,255,255, 0.6), rgba(255,255,255, 0.35))",
    "border:1px solid rgba(255,255,255,0.55)",
    "box-shadow:0 20px 50px -12px rgba(99,102,241,0.18), 0 8px 24px rgba(15,23,42,0.08), inset 0 1px 0 0 rgba(255,255,255,0.45)",
    "backdrop-filter:blur(20px) saturate(180%)",
    "-webkit-backdrop-filter:blur(20px) saturate(180%)",
    "color:#1f2937",
  ].join(";");

  const html = items
    .map(
      (item) => `
        <div style="${cardGlass}">
          <div style="color:#15803d;font-family:${KANDOR_FONT_SANS}"><b style="font-family:${KANDOR_FONT_SANS};font-weight:600">${escapeHtml(item.speaker || "unknown")}</b>: ${escapeHtml(item.text || "")}</div>
          ${reasonsBlock(item.reasons)}
          <div style="margin-top:6px;color:#6b6a67;font-size:11px;">Matched phrases: ${escapeHtml((item.phrases || []).join(" | ") || "None")}</div>
        </div>
      `,
    )
    .join("");

  const sectionHeading = `<b style="display:block;box-sizing:border-box;padding:0 0 6px;font-family:${KANDOR_FONT_SERIF};font-size:13px;font-weight:600;color:#111827">Flagged messages</b>`;

  const outerFlagged = (inner) =>
    `<div style="box-sizing:border-box;width:100%;margin-top:10px;padding:0;background:transparent;border:0;box-shadow:none;font-size:12px;line-height:1.4;font-family:${KANDOR_FONT_SANS}">${inner}</div>`;

  if (items.length) {
    return outerFlagged(`${sectionHeading}${html}`);
  }

  const fallback = normalizeText(result?.highest_risk_message);
  if (!fallback) return "";
  return outerFlagged(
    `${sectionHeading}
    <div style="${cardGlass}">
      <div style="color:#15803d;font-family:${KANDOR_FONT_SANS};font-weight:600">Highest-risk excerpt</div>
      <div style="margin-top:6px;">${escapeHtml(fallback)}</div>
    </div>`,
  );
}

function conciseActionLabel(action) {
  const labels = {
    none: "No action",
    monitor: "Monitor",
    warn_user: "Warn user",
    block_and_alert_guardian: "Block and alert guardian",
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
    OBFUSCATION: "Hidden language",
  };
  return labels[threat] || threat.replaceAll("_", " ").toLowerCase();
}

function renderThreatChips(threats) {
  if (!Array.isArray(threats) || !threats.length) return "None";
  return threats
    .map(
      (threat) =>
        `<span style="display:inline-flex;align-items:center;margin:4px 6px 0 0;padding:5px 9px;border-radius:999px;background:rgba(254,242,242,0.85);color:#b91c1c;border:1px solid rgba(252,165,165,0.45);font-size:11px;font-weight:600;backdrop-filter:blur(6px)">${escapeHtml(threatLabel(threat))}</span>`,
    )
    .join("");
}

function escapeRegExp(s) {
  return String(s).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function findMatchInString(hay, needle) {
  const n = String(needle || "");
  if (!n || n.length < 2) return null;
  const h = String(hay);
  let i = h.indexOf(n);
  if (i >= 0)
    return { start: i, end: i + n.length, text: h.slice(i, i + n.length) };
  const lo = h.toLowerCase();
  const nl = n.toLowerCase();
  i = lo.indexOf(nl);
  if (i >= 0)
    return { start: i, end: i + n.length, text: h.slice(i, i + n.length) };
  const words = normalizeText(n)
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(words.map((w) => escapeRegExp(w)).join("\\s+"), "i");
  const m = re.exec(h);
  if (m) return { start: m.index, end: m.index + m[0].length, text: m[0] };
  return null;
}

function shouldSkipTextNode(node) {
  if (!node?.parentElement) return true;
  const p = node.parentElement;
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "IFRAME"].includes(p.tagName))
    return true;
  if (p.closest(HT_UI_SEL)) return true;
  return false;
}

function collectTextNodes(root) {
  const out = [];
  if (!root) return out;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipTextNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = w.nextNode();
  while (n) {
    if (n.data && n.data.length) out.push(n);
    n = w.nextNode();
  }
  return out;
}

function tryHighlightInTextNode(textNode, pattern, reasonCodes) {
  const match = findMatchInString(textNode.data, pattern);
  if (!match) return false;
  const { start, end, text: matchedText } = match;
  const before = textNode.data.slice(0, start);
  const after = textNode.data.slice(end);
  const parent = textNode.parentNode;
  if (!parent) return false;

  const span = document.createElement("span");
  span.className = HT_FLAG;
  span.setAttribute(
    "data-hacktech-reasons",
    JSON.stringify(Array.isArray(reasonCodes) ? reasonCodes : []),
  );
  span.setAttribute("tabindex", "0");
  span.setAttribute("role", "button");
  span.setAttribute(
    "aria-label",
    `${APP_ALERT_TITLE}: flagged message. Hover for why it was flagged.`,
  );
  span.appendChild(document.createTextNode(matchedText));
  span.style.cssText = [
    "outline:2px solid #c4554d",
    "outline-offset:1px",
    "box-decoration-break:clone",
    "-webkit-box-decoration-break:clone",
  ].join(";");

  const afterNode = document.createTextNode(after);
  const beforeNode = document.createTextNode(before);
  parent.replaceChild(afterNode, textNode);
  parent.insertBefore(span, afterNode);
  parent.insertBefore(beforeNode, span);
  return true;
}

function buildFlagPatterns(flagged) {
  const byPattern = new Map();
  for (const item of flagged) {
    const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
    const parts = [
      item?.text,
      ...(Array.isArray(item?.phrases) ? item.phrases : []),
    ]
      .map((p) => String(p).trim())
      .filter((p) => p.length >= 2);
    for (const p of parts) {
      if (!byPattern.has(p)) byPattern.set(p, new Set());
      for (const r of reasons) {
        if (r != null && String(r).length) byPattern.get(p).add(String(r));
      }
    }
  }
  return [...byPattern.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([text, rset]) => ({ text, reasons: [...rset] }));
}

/**
 * Restores the DOM: unwraps every span we added (hacktech-flag-highlight) and removes
 * the hover popover. In-page red-outline marks are only those spans; no separate list
 * is required to tear them down.
 */
function clearFlaggedHighlights() {
  if (flagHoverHideTimer) {
    window.clearTimeout(flagHoverHideTimer);
    flagHoverHideTimer = null;
  }
  if (flagHoverPopover) {
    flagHoverPopover.remove();
    flagHoverPopover = null;
  }
  const spans = document.querySelectorAll(`.${HT_FLAG}`);
  spans.forEach((span) => {
    const p = span.parentNode;
    if (!p) return;
    while (span.firstChild) p.insertBefore(span.firstChild, span);
    p.removeChild(span);
    p.normalize();
  });
}

function getOrCreateFlagPopover() {
  if (flagHoverPopover) return flagHoverPopover;
  const el = document.createElement("div");
  el.id = "hacktech-flag-hover-popover";
  el.style.cssText = [
    "position:fixed",
    "z-index:2147483646",
    "display:none",
    "max-width:min(90vw,320px)",
    "padding:12px 14px",
    "border-radius:16px",
    "border:0",
    "outline:0",
    "box-shadow:0 20px 50px -12px rgba(99,102,241,0.2),0 8px 24px rgba(15,23,42,0.1)",
    "background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 45%,#faf5ff 100%)",
    `font-family:${KANDOR_FONT_SANS}`,
    "font-size:11px",
    "pointer-events:auto",
  ].join(";");
  el.innerHTML = `<div class="ht-popover-brand" style="font-weight:600;font-size:14px;margin-bottom:4px;font-family:${KANDOR_FONT_SERIF};background:linear-gradient(135deg,#111827,#4b5563);-webkit-background-clip:text;background-clip:text;color:transparent;">${escapeHtml(APP_ALERT_TITLE)}</div><div class="ht-popover-title" style="font-weight:600;margin-bottom:8px;font-family:${KANDOR_FONT_SERIF};color:#4b5563;font-size:12px">Why it was flagged</div><div class="ht-popover-chips" style="display:flex;flex-wrap:wrap;gap:6px"></div>`;
  el.addEventListener("pointerenter", () => cancelHideFlagPopover());
  el.addEventListener("pointerleave", () => scheduleHideFlagPopover());
  document.body.appendChild(el);
  flagHoverPopover = el;
  return el;
}

function showFlagHoverPopover(rect, reasonCodes) {
  ensureOpenSans();
  const pop = getOrCreateFlagPopover();
  const chips = pop.querySelector(".ht-popover-chips");
  chips.textContent = "";
  const list = (reasonCodes || []).map((r) => threatLabel(r)).filter(Boolean);
  if (!list.length) {
    const none = document.createElement("span");
    none.className = "muted";
    none.style.cssText = "color:#6b6a67;font-size:12px";
    none.textContent = "No threat labels.";
    chips.appendChild(none);
  } else {
    for (const label of list) {
      const s = document.createElement("span");
      s.textContent = label;
      s.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "padding:5px 9px",
        "border-radius:999px",
        "background:rgba(254,242,242,0.9)",
        "color:#b91c1c",
        "border:1px solid rgba(252,165,165,0.5)",
        "font-size:11px",
        "font-weight:600",
        "backdrop-filter:blur(6px)",
      ].join(";");
      chips.appendChild(s);
    }
  }
  const pad = 6;
  pop.style.display = "block";
  const ph = pop.offsetHeight;
  const pw = pop.offsetWidth;
  let top = rect.bottom + pad;
  let left = Math.min(Math.max(8, rect.left), window.innerWidth - pw - 8);
  if (left + pw > window.innerWidth - 8)
    left = Math.max(8, window.innerWidth - pw - 8);
  if (top + ph > window.innerHeight - 8) {
    top = rect.top - ph - pad;
  }
  top = Math.max(8, Math.min(window.innerHeight - ph - 8, top));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function scheduleHideFlagPopover() {
  if (flagHoverHideTimer) window.clearTimeout(flagHoverHideTimer);
  flagHoverHideTimer = window.setTimeout(() => {
    if (flagHoverPopover) flagHoverPopover.style.display = "none";
    flagHoverHideTimer = null;
  }, 200);
}

function cancelHideFlagPopover() {
  if (flagHoverHideTimer) {
    window.clearTimeout(flagHoverHideTimer);
    flagHoverHideTimer = null;
  }
}

let flagPointerBound = false;
function ensureFlagPointerListeners() {
  if (flagPointerBound) return;
  flagPointerBound = true;
  document.addEventListener(
    "pointerenter",
    (e) => {
      const raw = e.target;
      const t =
        raw?.nodeType === 3
          ? raw.parentElement
          : raw instanceof Element
            ? raw
            : raw?.parentElement;
      if (!(t instanceof Element)) return;
      const span = t.closest?.(`.${HT_FLAG}`);
      if (!span) return;
      const reasonsJson = span.getAttribute("data-hacktech-reasons");
      let reasonCodes = [];
      try {
        const parsed = reasonsJson ? JSON.parse(reasonsJson) : [];
        if (Array.isArray(parsed)) reasonCodes = parsed;
      } catch {
        /* ignore */
      }
      cancelHideFlagPopover();
      showFlagHoverPopover(span.getBoundingClientRect(), reasonCodes);
    },
    true,
  );
  document.addEventListener(
    "pointerleave",
    (e) => {
      const raw = e.target;
      const t =
        raw?.nodeType === 3
          ? raw.parentElement
          : raw instanceof Element
            ? raw
            : raw?.parentElement;
      if (!(t instanceof Element)) return;
      if (t.classList?.contains(HT_FLAG)) scheduleHideFlagPopover();
    },
    true,
  );
  window.addEventListener(
    "scroll",
    () => {
      if (flagHoverPopover?.style.display === "block")
        scheduleHideFlagPopover();
    },
    { capture: true, passive: true },
  );
}

function applyFlaggedTextHighlights(result) {
  suppressMutationScan++;
  try {
    const flagged = Array.isArray(result?.flagged_messages)
      ? result.flagged_messages
      : [];
    if (!flagged.length) {
      clearFlaggedHighlights();
      return;
    }
    clearFlaggedHighlights();
    const patterns = buildFlagPatterns(flagged);
    for (const { text, reasons } of patterns) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const textNode of collectTextNodes(document.body)) {
          if (tryHighlightInTextNode(textNode, text, reasons)) {
            progress = true;
            break;
          }
        }
      }
    }
    if (document.querySelector(`.${HT_FLAG}`)) {
      ensureFlagPointerListeners();
    }
  } finally {
    window.setTimeout(() => {
      suppressMutationScan = Math.max(0, suppressMutationScan - 1);
    }, 0);
  }
}

function ensureOpenSans() {
  if (document.getElementById("hacktech-open-sans")) return;
  const link = document.createElement("link");
  link.id = "hacktech-open-sans";
  link.rel = "stylesheet";
  link.href = KANDOR_FONTS_CSS_URL;
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
    scanned: Number(result?.scanned_messages || 0),
    flagged: (result?.flagged_messages || []).map((m) => ({
      t: m?.text,
      r: m?.reasons,
    })),
  });
  if (bannerSignature === lastBannerSignature && now - lastBannerAt < 3000)
    return;
  lastBannerAt = now;
  lastBannerSignature = bannerSignature;

  const existing = document.getElementById("hacktech-safety-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "hacktech-safety-banner";
  banner.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "max-width:420px",
    "z-index:2147483647",
    "padding:18px 18px 16px",
    "border-radius:20px",
    "border:0",
    "outline:0",
    "box-shadow:0 20px 50px -12px rgba(99,102,241,0.2),0 8px 24px rgba(15,23,42,0.1)",
    "background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 45%,#faf5ff 100%)",
    `color:#1f2937`,
    `font-family:${KANDOR_FONT_SANS}`,
  ].join(";");
  const flaggedSection = renderFlaggedMessages(result);
  const evaluation = conciseEvaluation(result.evaluation);
  const riskDisplay = Math.round(Number(result?.danger_rating || 0));
  const confDisplay = Math.round(
    Number(result?.confidence_score ?? result?.confidence ?? 0),
  );
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="font-weight:600;font-size:1.15rem;line-height:1.2;letter-spacing:-0.02em;max-width:14rem;font-family:${KANDOR_FONT_SERIF},serif;background:linear-gradient(135deg,#111827,#4b5563);-webkit-background-clip:text;background-clip:text;color:transparent">${escapeHtml(APP_ALERT_TITLE)}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
        <div style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(254,242,242,0.9);color:#b91c1c;border:1px solid rgba(252,165,165,0.5);backdrop-filter:blur(8px)">Risk ${riskDisplay}</div>
        <div style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,255,255,0.5);color:#111827;border:1px solid rgba(255,255,255,0.5);backdrop-filter:blur(8px)">Confidence ${confDisplay}</div>
      </div>
    </div>
    <div style="font-size:12px;line-height:1.65;color:#374151">
      <div>${renderThreatChips(result.threats_detected || [])}</div>
      ${
        evaluation
          ? `<div style="margin-top:10px;">${escapeHtml(evaluation)}</div>`
          : ""
      }
    </div>
    ${
      flaggedSection
        ? `<div style="box-sizing:border-box;width:100%;margin-top:12px;font-size:12px;line-height:1.5;max-height:min(50vh,320px);overflow:auto;padding:0;background:transparent;border:0;box-shadow:none">
            ${flaggedSection}
          </div>`
        : ""
    }
    <div style="margin-top:12px;font-size:12px;line-height:1.45;color:#4b5563">
      <span style="font-family:${KANDOR_FONT_SANS};font-weight:600">Recommended action</span>: ${escapeHtml(conciseActionLabel(result.recommended_action || "monitor"))}
    </div>
    <button id="hacktech-safety-close" type="button" style="margin-top:12px;width:100%;padding:9px 14px;cursor:pointer;font-weight:600;font-size:13px;border-radius:12px;border:none;color:#fff;background:linear-gradient(90deg,#2563eb,#4f46e5);box-shadow:0 4px 14px rgba(79,70,229,0.35);font-family:${KANDOR_FONT_SANS}">I Understand</button>
  `;

  document.body.appendChild(banner);
  banner
    .querySelector("#hacktech-safety-close")
    ?.addEventListener("click", () => {
      clearFlaggedHighlights();
      banner.remove();
    });
}

function pageTextForScanning() {
  const clone = document.body?.cloneNode(true);
  clone?.querySelector("#hacktech-safety-banner")?.remove();
  const raw = normalizeText(clone?.innerText || clone?.textContent || "");
  return stripFrameworkNoiseFromVisibleText(raw);
}

function scanPage(noSignatureCheck = false) {
  const html = currentPageHtml();
  const pageText = pageTextForScanning();
  const messages = extractConversationMessages();
  const signature = conversationSignature(messages);
  if (signature === lastConversationSignature && !noSignatureCheck) return;
  lastConversationSignature = signature;
  console.log("[kandor] Scanning page", window.location.href, signature);

  chrome.runtime.sendMessage(
    {
      type: "SCAN_PAGE_HTML",
      pageUrl: window.location.href,
      html,
      pageText,
      platform: pagePlatform(),
      messages,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[kandor] Runtime error",
          chrome.runtime.lastError.message,
        );
        return;
      }
      if (!response?.success) {
        console.warn("[kandor] Scan failed", response);
        return;
      }
      if (response?.skipped) {
        if (response?.reason === "not_social") {
          console.log("[kandor] Not a supported social page; scan skipped");
        } else {
          console.warn("[kandor] Scan skipped", response);
        }
        return;
      }
      console.log("[kandor] Scan result", response.result);
      applyFlaggedTextHighlights(response.result);
      showBanner(response.result, response.settings?.warningThreshold);
      setLastResult(response.result);
    },
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TRIGGER_SCAN") {
    console.log("[kandor] Manual or alarm-triggered scan");
    scanPage();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TRIGGER_SCAN_NO_SIGNATURE_CHECK") {
    console.log(
      "[kandor] Manual or alarm-triggered scan without signature check",
    );
    scanPage((noSignatureCheck = true));
  }
});

console.log("[kandor] Content script loaded on", window.location.href);
window.setTimeout(scanPage, 1500);
const observer = new MutationObserver((mutations) => {
  if (suppressMutationScan > 0) return;
  const onlyExtensionUiChanges = mutations.every((mutation) => {
    const target =
      mutation.target instanceof Element
        ? mutation.target
        : mutation.target?.parentElement;
    if (target?.closest?.(HT_UI_SEL)) return true;
    if (target?.id === "hacktech-open-sans") return true;
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        if (
          node.id === "hacktech-flag-hover-popover" ||
          node.classList?.contains(HT_FLAG)
        )
          return true;
        if (node.querySelector?.(`.${HT_FLAG},#hacktech-flag-hover-popover`))
          return true;
      }
    }
    return false;
  });
  if (onlyExtensionUiChanges) return;
  window.setTimeout(scanPage, 1200);
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
});
