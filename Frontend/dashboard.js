const HIGH_RISK_FEED_KEY = "kandorHighRiskFeed";
const HIGH_RISK_SNIPPETS_COOKIE = "kandorHighRiskSnippets";

const GUIDANCE = [
  "Check in calmly about the relationship behind the alert, not just the message itself.",
  "Ask whether the teen felt pressured to share personal details or move the conversation elsewhere.",
  "Use the excerpt reveal only when context is necessary for a supportive conversation.",
  "If risk stays high across repeated scans, discuss blocking or reporting options together.",
];

let alerts = [];

const alertList = document.getElementById("alert-list");
const guidanceList = document.getElementById("guidance-list");

function extensionCookieBaseUrl() {
  return typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("/")
    : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanThreat(t) {
  return String(t).replace(/_/g, " ");
}

/** Rows from `kandorHighRiskFeed` in storage (danger ≥ 70, written by the background). */
function buildAlertsFromHighRiskRows(entries) {
  return (entries || []).map((e, i) => {
    const threats = e.threats || [];
    const category = threats[0] ? humanThreat(threats[0]) : "High risk signal";
    const d = Number(e.danger) || 0;
    const time = e.at
      ? new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "—";
    let page = e.pageUrl || "";
    try {
      const u = new URL(String(page));
      const path = u.pathname && u.pathname !== "/" ? u.pathname.slice(0, 32) : "";
      page = `${u.hostname}${path}`;
    } catch {
      page = String(e.pageUrl || "").slice(0, 80);
    }
    let reason = String(e.evaluation || "").trim();
    if (reason.length > 220) reason = `${reason.slice(0, 217).trim()}…`;
    if (!reason) reason = `Danger score ${d} (saved when score was 70 or higher).`;
    const excerpt = e.snippet ? String(e.snippet) : undefined;
    return {
      id: i + 1,
      category,
      risk: "High",
      time,
      timeRaw: e.at,
      conversation: page || "Scanned page",
      reason,
      excerpt: excerpt && excerpt.trim() ? excerpt.trim() : undefined,
    };
  });
}

function readHighRiskCookie() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.cookies?.get) {
      resolve(null);
      return;
    }
    const url = extensionCookieBaseUrl();
    if (!url) {
      resolve(null);
      return;
    }
    chrome.cookies.get(
      { url, name: HIGH_RISK_SNIPPETS_COOKIE },
      (c) => {
        if (chrome.runtime?.lastError || !c?.value) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(decodeURIComponent(c.value));
          resolve(Array.isArray(data) ? data : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function finishHydrateFromRows(rows) {
  if (Array.isArray(rows) && rows.length) {
    alerts = buildAlertsFromHighRiskRows(rows);
  } else {
    alerts = [];
  }
  renderAll();
}

function hydrateFromExtension() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    alerts = [];
    renderAll();
    return;
  }

  chrome.storage.local.get(HIGH_RISK_FEED_KEY, (data) => {
    if (chrome.runtime?.lastError) {
      alerts = [];
      renderAll();
      return;
    }
    let rows = data[HIGH_RISK_FEED_KEY];
    if (Array.isArray(rows) && rows.length) {
      finishHydrateFromRows(rows);
      return;
    }
    readHighRiskCookie()
      .then((fromCookie) => {
        if (fromCookie && fromCookie.length) {
          return new Promise((resolve) => {
            chrome.storage.local.set(
              { [HIGH_RISK_FEED_KEY]: fromCookie },
              () => resolve(fromCookie),
            );
          });
        }
        return null;
      })
      .then((migrated) => {
        if (migrated) {
          finishHydrateFromRows(migrated);
        } else {
          finishHydrateFromRows([]);
        }
      })
      .catch(() => {
        finishHydrateFromRows([]);
      });
  });
}

function renderAlerts(revealedAlertId = null) {
  if (!alerts.length) {
    alertList.innerHTML = `
      <p class="alert-list-empty">
        No high-risk alerts yet. When a scan scores 70+ on the danger scale, a snippet is saved
        here. Use Clear saved reports in the extension popup to clear this list as well.
      </p>
    `;
    return;
  }

  alertList.innerHTML = alerts
    .map((alert) => {
      const isRevealed = revealedAlertId != null && revealedAlertId === alert.id && Boolean(alert.excerpt);
      const cat = escapeHtml(alert.category);
      const conv = escapeHtml(alert.conversation);
      const time = escapeHtml(alert.time);
      const reason = escapeHtml(alert.reason);
      const exc = alert.excerpt ? escapeHtml(alert.excerpt) : "";
      const risk = escapeHtml(alert.risk);
      const riskClass = (alert.risk || "High").toLowerCase();
      return `
        <article class="alert-item">
          <div class="alert-row">
            <div class="alert-title-wrap">
              <div class="risk-dot risk-${riskClass}"></div>
              <div>
                <div class="alert-title-row">
                  <h3>${cat}</h3>
                  <span class="risk-badge risk-badge-${riskClass}">${risk} risk</span>
                </div>
                <p class="alert-meta">${conv} · ${time}</p>
              </div>
            </div>
            <button
              class="text-button"
              type="button"
              data-alert-id="${alert.id}"
              ${alert.excerpt ? "" : "disabled"}
            >
              <span>${isRevealed ? "Hide excerpt" : "Reveal flagged excerpt"}</span>
              <span class="chevron ${isRevealed ? "chevron-open" : ""}">⌄</span>
            </button>
          </div>
          <p class="alert-reason">${reason}</p>
          ${
            isRevealed
              ? `
                <div class="excerpt-box" role="note">
                  <span class="excerpt-label">Short flagged excerpt</span>
                  <p>${exc}</p>
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");

  alertList.querySelectorAll("[data-alert-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const alertId = Number(button.getAttribute("data-alert-id"));
      const nextId = revealedAlertId === alertId ? null : alertId;
      renderAlerts(nextId);
    });
  });
}

function renderGuidance() {
  guidanceList.innerHTML = GUIDANCE.map(
    (item) => `
        <div class="guidance-item">
          <span class="guidance-item-icon" aria-hidden="true">!</span>
          <p>${escapeHtml(item)}</p>
        </div>
      `,
  ).join("");
}

function renderAll() {
  renderAlerts();
  renderGuidance();
}

alerts = [];
renderAll();
hydrateFromExtension();

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[HIGH_RISK_FEED_KEY]) {
      hydrateFromExtension();
    }
  });
}

if (typeof chrome !== "undefined" && chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((info) => {
    if (info.name === HIGH_RISK_SNIPPETS_COOKIE) {
      hydrateFromExtension();
    }
  });
}
