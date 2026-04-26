function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const APP_ALERT_TITLE =
  typeof KANDOR_APP_ALERT_TITLE !== "undefined" && KANDOR_APP_ALERT_TITLE
    ? KANDOR_APP_ALERT_TITLE
    : "kandor alert";
{
  const el = document.getElementById("appBrandTitle");
  if (el) el.textContent = APP_ALERT_TITLE;
  document.title = APP_ALERT_TITLE;
}

function updateResultPill(result) {
  const pill = document.getElementById("resultPill");
  if (!pill) return;

  const rating = Number(result?.danger_rating || 0);
  if (!result) {
    pill.textContent = "Idle";
    pill.className = "pill pillSafe";
    return;
  }

  if (rating >= 40) {
    pill.textContent = `Risk ${rating}`;
    pill.className = "pill pillWarn";
    return;
  }

  pill.textContent = rating > 0 ? `Monitor ${rating}` : "Clear";
  pill.className = "pill pillSafe";
}

function renderList(title, items, mapper) {
  if (!items.length) {
    return `<div><div><b>${escapeHtml(title)}</b></div><div class="mutedLine" style="margin-top:6px;">None</div></div>`;
  }

  return `
    <div>
      <div><b>${escapeHtml(title)}</b></div>
      <div class="listBlock" style="margin-top:8px;">
        ${items.map(mapper).join("")}
      </div>
    </div>
  `;
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
  if (!threats.length) return "None";
  return threats
    .map(
      (threat) =>
        `<span style="display:inline-flex;align-items:center;margin:4px 6px 0 0;padding:5px 9px;border-radius:999px;background:#fff1ef;color:#c4554d;border:1px solid rgba(196,85,77,0.14);font-size:11px;font-weight:700;">${escapeHtml(threatLabel(threat))}</span>`,
    )
    .join("");
}

async function loadView() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    if (!response?.success) return;
    const settings = response.settings;
    document.getElementById("enabled").checked = Boolean(settings.enabled);
    document.getElementById("backendBaseUrl").value =
      settings.backendBaseUrl || "http://127.0.0.1:8000";
    document.getElementById("scanIntervalMinutes").value = String(
      settings.scanIntervalMinutes || 1,
    );
    document.getElementById("warningThreshold").value = String(
      settings.warningThreshold || 40,
    );
  });

  chrome.runtime.sendMessage({ type: "GET_LAST_RESULT" }, (response) => {
    if (!response?.success || !response.result) {
      updateResultPill(null);
      document.getElementById("lastResult").innerHTML =
        `<div class="mutedLine">No saved report for this tab yet.</div>`;
      return;
    }
    const result = response.result;
    const tabId = response.tabId;
    updateResultPill(result);

    const extractedMessages = renderList(
      "Extracted transcript",
      (result.extracted_messages || []).slice(-8),
      (item) => `
        <div class="listItem">
          <div><b>${escapeHtml(item.speaker || "unknown")}</b>: ${escapeHtml(item.text || "")}</div>
          <div class="mutedLine" style="margin-top:4px;">Source: ${escapeHtml(item.source || "generic")}</div>
        </div>
      `,
    );

    const flaggedMessages = renderList(
      "Flagged messages",
      result.flagged_messages || [],
      (item) => `
        <div class="listItem">
          <div><b>${escapeHtml(item.speaker || "unknown")}</b>: ${escapeHtml(item.text || "")}</div>
          <div class="mutedLine" style="margin-top:4px;">Reasons: ${escapeHtml((item.reasons || []).map(threatLabel).join(", ") || "None")}</div>
          <div class="mutedLine" style="margin-top:4px;">Matched: ${escapeHtml((item.phrases || []).join(" | ") || "None")}</div>
        </div>
      `,
    );

    document.getElementById("lastResult").innerHTML = `
      <div><b>Tab report</b>: ${escapeHtml(tabId != null ? `Tab ${tabId}` : "Current tab")}</div>
      <div><b>Page</b>: <span class="mono">${escapeHtml(result.pageUrl || "n/a")}</span></div>
      <div><b>Danger</b>: ${escapeHtml(result.danger_rating)}</div>
      <div><b>Confidence</b>: ${escapeHtml(result.confidence_score)}</div>
      <div><b>Action</b>: ${escapeHtml(result.recommended_action || "monitor")}</div>
      <div><b>Platform</b>: ${escapeHtml(result.platform || "generic")}</div>
      <div><b>Threats</b>: <span>${renderThreatChips(result.threats_detected || [])}</span></div>
      <div><b>Flagged phrases</b>: ${escapeHtml((result.flagged_phrases || []).join(" | ") || "None")}</div>
      <div><b>Messages scanned</b>: ${escapeHtml(result.scanned_messages || 0)}</div>
      <div><b>Endpoint</b>: <span class="mono">${escapeHtml(result.endpoint || "n/a")}</span></div>
      <div><b>Evaluation</b>: ${escapeHtml(result.evaluation || "No evaluation returned.")}</div>
      ${
        result.highest_risk_message
          ? `<div class="listItem"><b>Highest-risk message</b><div style="margin-top:6px;">${escapeHtml(result.highest_risk_message)}</div></div>`
          : ""
      }
      ${extractedMessages}
      ${flaggedMessages}
    `;
  });
}

document.getElementById("save").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    {
      type: "SAVE_SETTINGS",
      settings: {
        enabled: document.getElementById("enabled").checked,
        backendBaseUrl:
          document.getElementById("backendBaseUrl").value.trim() ||
          "http://127.0.0.1:8000",
        scanIntervalMinutes: Math.max(
          1,
          Number(document.getElementById("scanIntervalMinutes").value) || 1,
        ),
        warningThreshold: Math.max(
          0,
          Math.min(
            100,
            Number(document.getElementById("warningThreshold").value) || 40,
          ),
        ),
      },
    },
    () => loadView(),
  );
});

document.getElementById("scanNow").addEventListener("click", () => {
  const btn = document.getElementById("scanNow");
  const resultEl = document.getElementById("lastResult");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  updateResultPill(null);
  resultEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:ht-spin 0.9s linear infinite;flex-shrink:0">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <span class="muted">Scanning page…</span>
    </div>
    <style>@keyframes ht-spin{to{transform:rotate(360deg)}}</style>
  `;

  chrome.runtime.sendMessage({ type: "RUN_MANUAL_SCAN" }, () => {
    let attempts = 0;
    const MAX = 24;
    const poll = () => {
      chrome.runtime.sendMessage({ type: "GET_LAST_RESULT" }, (response) => {
        attempts++;
        const done = response?.success && response?.result;
        if (done || attempts >= MAX) {
          btn.disabled = false;
          btn.textContent = "Scan tab now";
          loadView();
        } else {
          window.setTimeout(poll, 500);
        }
      });
    };
    window.setTimeout(poll, 600);
  });
});

document.getElementById("openDemo").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DEMO_PAGE" });
});

document.getElementById("clearReports").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_ALL_RESULTS" }, () => {
    updateResultPill(null);
    document.getElementById("lastResult").innerHTML =
      `<div class="mutedLine">No saved report for this tab yet.</div>`;
  });
});

loadView();
