/* background/service-worker.js — API relay + report storage + notifications */

const MSG = {
  EVALUATE:      "safechat:evaluate",
  GET_REPORTS:   "safechat:get_reports",
  CLEAR_REPORTS: "safechat:clear_reports",
  PROFILE_GET:   "safechat:profile_get",
  PROFILE_SET:   "safechat:profile_set",
  NOTIFY:        "safechat:notify",
};

const DEFAULT_PROFILE = {
  enabled:          true,
  pollInterval:     60,
  apiEndpoint:      "http://localhost:8000/v1/evaluate",
  apiKey:           "",
  preFilterEnabled: true,
  minDangerRating:  4,
  sensitivity:      "medium",
  notifyOnDanger:   true,
  showInPageBanner: true,
};

// ── Storage helpers ──────────────────────────────────────────────────────────

async function getProfile(hostname) {
  const key = hostname || "__global__";
  const { profiles = {} } = await chrome.storage.sync.get("profiles");
  return Object.assign({}, DEFAULT_PROFILE, profiles["__global__"] || {}, profiles[key] || {});
}

async function setProfile(hostname, patch) {
  const key = hostname || "__global__";
  const { profiles = {} } = await chrome.storage.sync.get("profiles");
  profiles[key] = Object.assign({}, profiles[key] || {}, patch);
  await chrome.storage.sync.set({ profiles });
}

async function saveReport(report) {
  const { reports = [] } = await chrome.storage.local.get("reports");
  reports.unshift(report);
  if (reports.length > 500) reports.length = 500;
  await chrome.storage.local.set({ reports });
}

async function getReports(hostname) {
  const { reports = [] } = await chrome.storage.local.get("reports");
  return hostname ? reports.filter((r) => r.hostname === hostname) : reports;
}

async function clearReports(hostname) {
  const { reports = [] } = await chrome.storage.local.get("reports");
  const filtered = hostname ? reports.filter((r) => r.hostname !== hostname) : [];
  await chrome.storage.local.set({ reports: filtered });
}

// ── API call ─────────────────────────────────────────────────────────────────

async function callEvaluate(messages, meta, profile) {
  const endpoint = profile.apiEndpoint || DEFAULT_PROFILE.apiEndpoint;
  const headers = {
    "Content-Type": "application/json",
    ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
  };

  const body = JSON.stringify({ messages, meta });

  const response = await fetch(endpoint, {
    method:  "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${await response.text()}`);
  }

  // Expected shape: { danger_rating, confidence_score, evaluation }
  const data = await response.json();

  // Normalise field names defensively
  return {
    danger_rating:    Number(data.danger_rating   ?? data.dangerRating   ?? 0),
    confidence_score: Number(data.confidence_score ?? data.confidenceScore ?? 0),
    evaluation:       String(data.evaluation       ?? data.message         ?? ""),
  };
}

// ── Notification helper ───────────────────────────────────────────────────────

function fireNotification(danger_rating, evaluation, hostname) {
  chrome.notifications.create(`safechat-${Date.now()}`, {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   `⚠️ SafeChat: Danger ${danger_rating}/10`,
    message: `${hostname} — ${evaluation.slice(0, 100)}${evaluation.length > 100 ? "…" : ""}`,
  });
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { type, payload } = msg || {};

  switch (type) {

    case MSG.EVALUATE: {
      const { messages, meta } = payload;
      const hostname = meta?.hostname || "";

      getProfile(hostname)
        .then((profile) => callEvaluate(messages, meta, profile))
        .then(async (result) => {
          // Persist the report regardless of danger level
          const report = {
            id:        crypto.randomUUID(),
            timestamp: Date.now(),
            hostname:  hostname,
            url:       meta?.url || "",
            messages,
            result,
          };
          await saveReport(report);
          sendResponse(result);
        })
        .catch((err) => {
          console.error("[SafeChat SW] evaluate error:", err);
          sendResponse(null);
        });

      return true; // keep message channel open for async response
    }

    case MSG.GET_REPORTS: {
      getReports(payload?.hostname)
        .then((reports) => sendResponse(reports))
        .catch(() => sendResponse([]));
      return true;
    }

    case MSG.CLEAR_REPORTS: {
      clearReports(payload?.hostname)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    case MSG.PROFILE_GET: {
      getProfile(payload?.hostname)
        .then((profile) => sendResponse(profile))
        .catch(() => sendResponse(DEFAULT_PROFILE));
      return true;
    }

    case MSG.PROFILE_SET: {
      const { hostname, patch } = payload || {};
      setProfile(hostname, patch)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    case MSG.NOTIFY: {
      const { danger_rating, evaluation, hostname } = payload || {};
      fireNotification(danger_rating, evaluation, hostname);
      sendResponse({ ok: true });
      return false;
    }

    default:
      return false;
  }
});
