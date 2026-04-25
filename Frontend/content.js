let lastHtmlSignature = "";
let lastBannerAt = 0;

function currentPageHtml() {
  return document.documentElement?.outerHTML || "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function htmlSignature(html) {
  return `${html.length}:${html.slice(0, 200)}`;
}

function inferSpeaker(element) {
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

function extractConversationMessages() {
  const selectors = [
    "[role='listitem'] [dir='auto']",
    "[role='row'] [dir='auto']",
    "main [dir='auto']",
    "article [dir='auto']",
    "div[dir='auto']"
  ];

  const nodes = document.querySelectorAll(selectors.join(", "));
  const seen = new Set();
  const messages = [];

  for (const node of nodes) {
    if (node.querySelector("[dir='auto']")) continue;

    const text = normalizeText(node.innerText || node.textContent);
    if (!text || text.length < 2 || text.length > 220) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const key = `${Math.round(rect.top)}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    messages.push({
      speaker: inferSpeaker(node),
      text
    });
  }

  return messages.slice(-20);
}

function showBanner(result, threshold) {
  if (Number(result?.danger_rating || 0) < Number(threshold || 40)) return;

  const now = Date.now();
  if (now - lastBannerAt < 8000) return;
  lastBannerAt = now;

  const existing = document.getElementById("hacktech-safety-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "hacktech-safety-banner";
  banner.style.position = "fixed";
  banner.style.top = "16px";
  banner.style.right = "16px";
  banner.style.maxWidth = "380px";
  banner.style.zIndex = "2147483647";
  banner.style.padding = "14px";
  banner.style.borderRadius = "12px";
  banner.style.border = "1px solid #7f1d1d";
  banner.style.borderLeft = "5px solid #ef4444";
  banner.style.background = "#111827";
  banner.style.color = "#f9fafb";
  banner.style.fontFamily = "Arial, sans-serif";
  banner.style.boxShadow = "0 12px 28px rgba(0,0,0,0.35)";
  banner.innerHTML = `
    <div style="font-weight:700;font-size:14px;margin-bottom:6px;">Hacktech Safety Alert</div>
    <div style="font-size:12px;line-height:1.5;">
      <b>Danger rating:</b> ${result.danger_rating}<br/>
      <b>Confidence:</b> ${result.confidence_score}<br/>
      <b>Action:</b> ${result.recommended_action || "monitor"}<br/>
      <b>Threats:</b> ${(result.threats_detected || []).join(", ") || "None"}<br/>
      <b>Flagged phrases:</b> ${(result.flagged_phrases || []).join(" | ") || "None"}<br/>
      <b>Evaluation:</b> ${result.evaluation}
    </div>
    ${
      result.highest_risk_message
        ? `<div style="margin-top:10px;font-size:12px;line-height:1.4;background:#1f2937;border-radius:8px;padding:8px;">
            <b>Highest-risk message:</b><br/>${result.highest_risk_message}
          </div>`
        : ""
    }
    <button id="hacktech-safety-close" style="margin-top:10px;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:6px 10px;cursor:pointer;">Dismiss</button>
  `;

  document.body.appendChild(banner);
  banner.querySelector("#hacktech-safety-close")?.addEventListener("click", () => banner.remove());
}

function scanPage() {
  const html = currentPageHtml();
  const pageText = normalizeText(document.body?.innerText || "");
  const messages = extractConversationMessages();
  const signature = htmlSignature(html);
  if (signature === lastHtmlSignature) return;
  lastHtmlSignature = signature;
  console.log("[Hacktech Safety] Scanning page", window.location.href, signature);

  chrome.runtime.sendMessage(
    {
      type: "SCAN_PAGE_HTML",
      pageUrl: window.location.href,
      html,
      pageText,
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
