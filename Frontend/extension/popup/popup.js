/* popup/popup.js */
(async function () {

  let currentHostname = "";
  let currentProfile  = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function send(type, payload) {
    return new Promise((res) => chrome.runtime.sendMessage({ type, payload }, res));
  }

  function dangerLevel(rating) {
    if (rating >= 7) return "high";
    if (rating >= 4) return "medium";
    return "low";
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)   return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  // Get the active tab's hostname
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || "");
    currentHostname = url.hostname.replace(/^www\./, "");
  } catch { currentHostname = ""; }

  document.getElementById("site-label").textContent =
    currentHostname || "No supported page active";
  document.getElementById("profile-scope").textContent =
    currentHostname ? `Profile: ${currentHostname}` : "Global default";

  // Load profile
  currentProfile = await send("safechat:profile_get", { hostname: currentHostname });
  document.getElementById("toggle-enabled").checked = !!currentProfile?.enabled;

  // Load reports
  await renderReports();

  // ── Render reports list ───────────────────────────────────────────────────

  async function renderReports() {
    const reports = await send("safechat:get_reports", { hostname: currentHostname }) || [];
    const list    = document.getElementById("reports-list");

    const total  = reports.length;
    const high   = reports.filter((r) => r.result?.danger_rating >= 7).length;
    const medium = reports.filter((r) => {
      const d = r.result?.danger_rating;
      return d >= 4 && d < 7;
    }).length;

    document.getElementById("stat-total").textContent  = total;
    document.getElementById("stat-high").textContent   = high;
    document.getElementById("stat-medium").textContent = medium;

    if (total === 0) {
      list.innerHTML = '<div class="empty-state">No reports yet for this site</div>';
      return;
    }

    list.innerHTML = reports.slice(0, 12).map((r) => {
      const level = dangerLevel(r.result?.danger_rating ?? 0);
      const score = r.result?.confidence_score?.toFixed(1) ?? "?";
      const eval_ = r.result?.evaluation ?? "";
      return `
        <div class="report-item ${level}">
          <div class="report-meta">
            <span class="badge badge-${level}">${r.result?.danger_rating ?? "?"}/10</span>
            &nbsp;${score}% confidence &nbsp;·&nbsp; ${timeAgo(r.timestamp)}
          </div>
          <div class="report-eval">${eval_.slice(0, 90)}${eval_.length > 90 ? "…" : ""}</div>
        </div>`;
    }).join("");
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  document.getElementById("toggle-enabled").addEventListener("change", async (e) => {
    await send("safechat:profile_set", {
      hostname: currentHostname,
      patch:    { enabled: e.target.checked },
    });
  });

  document.getElementById("btn-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("btn-refresh").addEventListener("click", renderReports);

  document.getElementById("btn-clear").addEventListener("click", async () => {
    if (!confirm(`Clear all reports for ${currentHostname || "all sites"}?`)) return;
    await send("safechat:clear_reports", { hostname: currentHostname });
    await renderReports();
  });

})();
