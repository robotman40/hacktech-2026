/* options/options.js */
(async function () {

  const PLATFORMS = [
    { hostname: "instagram.com",  label: "Instagram DMs" },
    { hostname: "facebook.com",   label: "Facebook Messenger" },
    { hostname: "messenger.com",  label: "Messenger.com" },
    { hostname: "web.whatsapp.com", label: "WhatsApp Web" },
    { hostname: "tinder.com",     label: "Tinder" },
    { hostname: "linkedin.com",   label: "LinkedIn Messaging" },
    { hostname: "twitter.com",    label: "Twitter / X" },
    { hostname: "x.com",          label: "X.com" },
    { hostname: "discord.com",    label: "Discord" },
    { hostname: "snapchat.com",   label: "Snapchat" },
  ];

  const GLOBAL_KEY = "__global__";

  // ── Helpers ─────────────────────────────────────────────────────────────

  function send(type, payload) {
    return new Promise((res) => chrome.runtime.sendMessage({ type, payload }, res));
  }

  function showToast() {
    const t = document.getElementById("save-toast");
    t.style.display = "block";
    setTimeout(() => { t.style.display = "none"; }, 2200);
  }

  function val(id)         { return document.getElementById(id).value.trim(); }
  function checked(id)     { return document.getElementById(id).checked; }
  function setVal(id, v)   { if (v !== undefined && v !== null) document.getElementById(id).value = v; }
  function setChk(id, v)   { document.getElementById(id).checked = !!v; }

  function timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60)    return "just now";
    if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b)   => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

      if (btn.dataset.tab === "reports")  renderReports();
      if (btn.dataset.tab === "sites")    renderSiteList();
    });
  });

  // ── Global settings ───────────────────────────────────────────────────────

  async function loadGlobal() {
    const p = await send("safechat:profile_get", { hostname: GLOBAL_KEY });
    setVal("g-endpoint",    p.apiEndpoint   || "");
    setVal("g-apikey",      p.apiKey        || "");
    setChk("g-enabled",     p.enabled       ?? true);
    setVal("g-interval",    p.pollInterval  || 60);
    setVal("g-sensitivity", p.sensitivity   || "medium");
    setVal("g-minrating",   p.minDangerRating || 4);
    setChk("g-notify",      p.notifyOnDanger  ?? true);
    setChk("g-banner",      p.showInPageBanner ?? true);
    setChk("g-prefilter",   p.preFilterEnabled ?? true);
  }

  document.getElementById("save-global").addEventListener("click", async () => {
    const patch = {
      apiEndpoint:       val("g-endpoint")    || "http://localhost:8000/v1/evaluate",
      apiKey:            val("g-apikey"),
      enabled:           checked("g-enabled"),
      pollInterval:      Math.max(10, parseInt(val("g-interval")) || 60),
      sensitivity:       val("g-sensitivity") || "medium",
      minDangerRating:   parseInt(val("g-minrating")) || 4,
      notifyOnDanger:    checked("g-notify"),
      showInPageBanner:  checked("g-banner"),
      preFilterEnabled:  checked("g-prefilter"),
    };
    await send("safechat:profile_set", { hostname: GLOBAL_KEY, patch });
    showToast();
  });

  // ── Per-site list ─────────────────────────────────────────────────────────

  async function renderSiteList() {
    const { profiles = {} } = await chrome.storage.sync.get("profiles");
    const container = document.getElementById("site-list");
    container.innerHTML = "";

    PLATFORMS.forEach(({ hostname, label }) => {
      const hasOverride = !!profiles[hostname];
      const enabled = profiles[hostname]?.enabled ??
                      profiles[GLOBAL_KEY]?.enabled ?? true;

      const row = document.createElement("div");
      row.className = "site-row";
      row.innerHTML = `
        <span class="site-name">${label}</span>
        <span class="site-status">${hasOverride ? "Custom profile" : "Using global"} · ${enabled ? "On" : "Off"}</span>
        <button data-host="${hostname}">Configure</button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll("button[data-host]").forEach((btn) => {
      btn.addEventListener("click", () => openSiteEditor(btn.dataset.host));
    });
  }

  let _editingHost = "";

  async function openSiteEditor(hostname) {
    _editingHost = hostname;
    const platform = PLATFORMS.find((p) => p.hostname === hostname);
    document.getElementById("site-editor-title").textContent =
      `Configure: ${platform?.label || hostname}`;

    const p = await send("safechat:profile_get", { hostname });
    setChk("s-enabled",      p.enabled ?? true);
    setVal("s-endpoint",     p.apiEndpoint   || "");
    setVal("s-interval",     p.pollInterval  || "");
    setVal("s-sensitivity",  p.sensitivity   || "");
    setVal("s-minrating",    p.minDangerRating || "");

    document.getElementById("site-editor").style.display = "block";
    document.getElementById("site-editor").scrollIntoView({ behavior: "smooth" });
  }

  document.getElementById("save-site").addEventListener("click", async () => {
    const patch = {
      enabled:          checked("s-enabled"),
      ...(val("s-endpoint")   ? { apiEndpoint:     val("s-endpoint") }                           : {}),
      ...(val("s-interval")   ? { pollInterval:    Math.max(10, parseInt(val("s-interval"))) }    : {}),
      ...(val("s-sensitivity")? { sensitivity:     val("s-sensitivity") }                         : {}),
      ...(val("s-minrating")  ? { minDangerRating: parseInt(val("s-minrating")) }                 : {}),
    };
    await send("safechat:profile_set", { hostname: _editingHost, patch });
    document.getElementById("site-editor").style.display = "none";
    await renderSiteList();
    showToast();
  });

  document.getElementById("cancel-site").addEventListener("click", () => {
    document.getElementById("site-editor").style.display = "none";
  });

  document.getElementById("delete-site").addEventListener("click", async () => {
    const { profiles = {} } = await chrome.storage.sync.get("profiles");
    delete profiles[_editingHost];
    await chrome.storage.sync.set({ profiles });
    document.getElementById("site-editor").style.display = "none";
    await renderSiteList();
    showToast();
  });

  // ── Reports ───────────────────────────────────────────────────────────────

  async function renderReports() {
    const filterSel  = document.getElementById("filter-site");
    const hostname   = filterSel.value || undefined;
    const reports    = await send("safechat:get_reports", { hostname }) || [];

    // Populate filter dropdown (once)
    if (filterSel.options.length === 1) {
      const hosts = [...new Set(reports.map((r) => r.hostname))].sort();
      hosts.forEach((h) => {
        const opt = document.createElement("option");
        opt.value = h;
        opt.textContent = h;
        filterSel.appendChild(opt);
      });
    }

    const tbody = document.getElementById("reports-tbody");
    if (reports.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">No reports</td></tr>`;
      return;
    }

    tbody.innerHTML = reports.slice(0, 100).map((r) => {
      const dr = r.result?.danger_score ?? r.result?.danger_rating ?? 0;
      const cls = dr >= 7 ? "rating-high" : dr >= 4 ? "rating-medium" : "rating-low";
      const cs  = (r.result?.confidence_score ?? 0).toFixed(1);
      const ev  = (r.result?.evaluation || "").slice(0, 120);
      return `
        <tr>
          <td>${r.hostname}</td>
          <td class="${cls}">${dr}/10</td>
          <td>${cs}%</td>
          <td>${ev}${r.result?.evaluation?.length > 120 ? "…" : ""}</td>
          <td>${timeAgo(r.timestamp)}</td>
        </tr>`;
    }).join("");
  }

  document.getElementById("filter-site").addEventListener("change", renderReports);

  document.getElementById("clear-reports").addEventListener("click", async () => {
    const hostname = document.getElementById("filter-site").value || undefined;
    if (!confirm(`Clear reports for ${hostname || "all sites"}?`)) return;
    await send("safechat:clear_reports", { hostname });
    document.getElementById("filter-site").value = "";
    await renderReports();
    showToast();
  });

  // ── Init ─────────────────────────────────────────────────────────────────

  await loadGlobal();
  await renderSiteList();

})();
