const SETTINGS_KEY = "hacktechSafetySettings";
const RESULTS_KEY = "hacktechSafetyTabResults";

const DEFAULT_SETTINGS = {
  enabled: true,
  backendBaseUrl: "http://127.0.0.1:8000",
  scanIntervalMinutes: 1,
  warningThreshold: 40
};

const ENDPOINT_CANDIDATES = ["/v1/evaluate"];

async function getSettings() {
  const result = await chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  await scheduleAlarm(next.scanIntervalMinutes);
  return next;
}

async function getTabResults() {
  const result = await chrome.storage.local.get({ [RESULTS_KEY]: {} });
  return result[RESULTS_KEY] || {};
}

async function getLastResult(tabId) {
  if (!Number.isInteger(tabId)) return null;
  const results = await getTabResults();
  return results[String(tabId)] || null;
}

async function setLastResult(tabId, value) {
  if (!Number.isInteger(tabId)) return;
  const results = await getTabResults();
  results[String(tabId)] = value;
  await chrome.storage.local.set({ [RESULTS_KEY]: results });
}

async function clearLastResult(tabId) {
  if (!Number.isInteger(tabId)) return;
  const results = await getTabResults();
  delete results[String(tabId)];
  await chrome.storage.local.set({ [RESULTS_KEY]: results });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function normalizeComparableUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString();
  } catch {
    return String(value || "").split("#")[0];
  }
}

function samePageUrl(a, b) {
  return normalizeComparableUrl(a) === normalizeComparableUrl(b);
}

async function scheduleAlarm(minutes) {
  chrome.alarms.clear("hacktechSafetyScan");
  chrome.alarms.create("hacktechSafetyScan", { periodInMinutes: Math.max(1, Number(minutes) || 1) });
}

/** @returns {Promise<{ ok: true, isSocial: boolean } | { ok: false, isSocial: null }>} */
async function checkIsSocialPage(pageUrl, backendBaseUrl) {
  const base = String(backendBaseUrl || "").replace(/\/$/, "");
  if (!base || !pageUrl) {
    return { ok: false, isSocial: null };
  }
  const endpoint = `${base}/v1/is-social`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: String(pageUrl) })
    });
    if (!response.ok) {
      console.warn("[kandor] is-social check HTTP", response.status);
      return { ok: false, isSocial: null };
    }
    const data = await response.json();
    const isSocial = data?.is_social === true;
    return { ok: true, isSocial };
  } catch (error) {
    console.warn("[kandor] is-social check failed", error);
    return { ok: false, isSocial: null };
  }
}

async function postHtmlToBackend(html, pageUrl, pageText, messages, platform, tabId) {
  const settings = await getSettings();
  const headers = { "Content-Type": "application/json" };

  let lastError = null;
  for (const endpoint of ENDPOINT_CANDIDATES) {
    try {
      console.log("[kandor] Posting HTML to", `${settings.backendBaseUrl}${endpoint}`);
      const response = await fetch(`${settings.backendBaseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pageUrl,
          html,
          pageText: String(pageText || ""),
          platform: String(arguments[4] || "generic"),
          messages: Array.isArray(messages) ? messages : []
        })
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const result = {
        pageUrl,
        endpoint,
        fetchedAt: new Date().toISOString(),
        danger_rating: Number(payload?.danger_rating || 0),
        confidence_score: Number(payload?.confidence_score ?? payload?.confidence ?? 0),
        evaluation: String(payload?.evaluation || "No evaluation returned."),
        threats_detected: Array.isArray(payload?.threats_detected)
          ? payload.threats_detected.map((item) => String(item))
          : [],
        flagged_phrases: Array.isArray(payload?.flagged_phrases)
          ? payload.flagged_phrases.map((item) => String(item))
          : [],
        flagged_messages: Array.isArray(payload?.flagged_messages)
          ? payload.flagged_messages
              .filter((item) => item && typeof item === "object")
              .map((item) => ({
                speaker: String(item.speaker || "unknown"),
                text: String(item.text || ""),
                reasons: Array.isArray(item.reasons) ? item.reasons.map((reason) => String(reason)) : [],
                phrases: Array.isArray(item.phrases) ? item.phrases.map((phrase) => String(phrase)) : []
              }))
          : [],
        recommended_action: String(payload?.recommended_action || "none"),
        highest_risk_message: payload?.highest_risk_message ? String(payload.highest_risk_message) : null,
        scanned_messages: Array.isArray(messages) ? messages.length : 0,
        platform: String(payload?.platform || platform || "generic"),
        tabId,
        extracted_messages: Array.isArray(messages)
          ? messages.map((item) => ({
              speaker: String(item.speaker || "unknown"),
              text: String(item.text || ""),
              source: String(item.source || "generic")
            }))
          : []
      };
      console.log("[Hacktech Safety] Received result", result);
      await setLastResult(tabId, result);
      return result;
    } catch (error) {
      console.warn("[kandor] Backend request failed", endpoint, error);
      lastError = error;
    }
  }

  throw lastError || new Error("Backend request failed");
}

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings(DEFAULT_SETTINGS);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await scheduleAlarm(settings.scanIntervalMinutes);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "hacktechSafetyScan") return;
  const settings = await getSettings();
  if (!settings.enabled) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_SCAN" });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearLastResult(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    clearLastResult(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {}).then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message?.type === "GET_LAST_RESULT") {
    const explicitTabId = Number.isInteger(message?.tabId) ? message.tabId : null;
    (explicitTabId != null ? chrome.tabs.get(explicitTabId) : getActiveTab()).then(async (tab) => {
      const result = await getLastResult(tab?.id);
      if (!result || !tab?.id) {
        sendResponse({ success: true, result: null, tabId: tab?.id ?? null });
        return;
      }

      if (!samePageUrl(result.pageUrl, tab.url)) {
        await clearLastResult(tab.id);
        sendResponse({ success: true, result: null, tabId: tab.id });
        return;
      }

      sendResponse({ success: true, result, tabId: tab.id });
    });
    return true;
  }

  if (message?.type === "RUN_MANUAL_SCAN") {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_SCAN_NO_SIGNATURE_CHECK" }, () => sendResponse({ success: true }));
      else sendResponse({ success: false, error: "No active tab" });
    });
    return true;
  }

  if (message?.type === "OPEN_DEMO_PAGE") {
    getSettings()
      .then((settings) => chrome.tabs.create({ url: `${settings.backendBaseUrl}/demo` }))
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type !== "SCAN_PAGE_HTML") return;

  (async () => {
    console.log("[kandor] SCAN_PAGE_HTML received", message?.pageUrl);
    const settings = await getSettings();
    const tabId = sender?.tab?.id;
    if (!settings.enabled) {
      await clearLastResult(tabId);
      sendResponse({ success: true, skipped: true, reason: "disabled" });
      return;
    }

    const html = String(message.html || "").trim();
    const pageText = String(message.pageText || "").trim();
    const pageUrl = String(message.pageUrl || "").trim();
    const platform = String(message.platform || "generic").trim() || "generic";
    const messages = Array.isArray(message.messages) ? message.messages : [];
    if (!html) {
      sendResponse({ success: false, error: "Missing page HTML" });
      return;
    }

    const socialCheck = await checkIsSocialPage(pageUrl, settings.backendBaseUrl);
    if (socialCheck.ok && socialCheck.isSocial === false) {
      await clearLastResult(tabId);
      sendResponse({ success: true, skipped: true, reason: "not_social" });
      return;
    }

    const result = await postHtmlToBackend(html, pageUrl, pageText, messages, platform, tabId);
    sendResponse({ success: true, result, settings });
  })().catch((error) => {
    sendResponse({ success: false, error: error.message });
  });

  return true;
});
