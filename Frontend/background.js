const SETTINGS_KEY = "hacktechSafetySettings";
const RESULT_KEY = "hacktechSafetyLastResult";

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

async function getLastResult() {
  const result = await chrome.storage.local.get({ [RESULT_KEY]: null });
  return result[RESULT_KEY];
}

async function setLastResult(value) {
  await chrome.storage.local.set({ [RESULT_KEY]: value });
}

async function scheduleAlarm(minutes) {
  chrome.alarms.clear("hacktechSafetyScan");
  chrome.alarms.create("hacktechSafetyScan", { periodInMinutes: Math.max(1, Number(minutes) || 1) });
}

async function postHtmlToBackend(html, pageUrl) {
  const pageText = arguments[2];
  const messages = arguments[3];
  const settings = await getSettings();
  const headers = { "Content-Type": "application/json" };

  let lastError = null;
  for (const endpoint of ENDPOINT_CANDIDATES) {
    try {
      console.log("[Hacktech Safety] Posting HTML to", `${settings.backendBaseUrl}${endpoint}`);
      const response = await fetch(`${settings.backendBaseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pageUrl,
          html,
          pageText: String(pageText || ""),
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
                reasons: Array.isArray(item.reasons) ? item.reasons.map((reason) => String(reason)) : []
              }))
          : [],
        recommended_action: String(payload?.recommended_action || "none"),
        highest_risk_message: payload?.highest_risk_message ? String(payload.highest_risk_message) : null,
        scanned_messages: Array.isArray(messages) ? messages.length : 0
      };
      console.log("[Hacktech Safety] Received result", result);
      await setLastResult(result);
      return result;
    } catch (error) {
      console.warn("[Hacktech Safety] Backend request failed", endpoint, error);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings || {}).then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message?.type === "GET_LAST_RESULT") {
    getLastResult().then((result) => sendResponse({ success: true, result }));
    return true;
  }

  if (message?.type === "RUN_MANUAL_SCAN") {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_SCAN" }, () => sendResponse({ success: true }));
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
    console.log("[Hacktech Safety] SCAN_PAGE_HTML received", message?.pageUrl);
    const settings = await getSettings();
    if (!settings.enabled) {
      sendResponse({ success: true, skipped: true, reason: "disabled" });
      return;
    }

    const html = String(message.html || "").trim();
    const pageText = String(message.pageText || "").trim();
    const pageUrl = String(message.pageUrl || "").trim();
    const messages = Array.isArray(message.messages) ? message.messages : [];
    if (!html) {
      sendResponse({ success: false, error: "Missing page HTML" });
      return;
    }

    const result = await postHtmlToBackend(html, pageUrl, pageText, messages);
    sendResponse({ success: true, result, settings });
  })().catch((error) => {
    sendResponse({ success: false, error: error.message });
  });

  return true;
});
