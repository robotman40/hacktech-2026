async function loadView() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    if (!response?.success) return;
    const settings = response.settings;
    document.getElementById("enabled").checked = Boolean(settings.enabled);
    document.getElementById("backendBaseUrl").value = settings.backendBaseUrl || "http://127.0.0.1:8000";
    document.getElementById("scanIntervalMinutes").value = String(settings.scanIntervalMinutes || 1);
    document.getElementById("warningThreshold").value = String(settings.warningThreshold || 40);
  });

  chrome.runtime.sendMessage({ type: "GET_LAST_RESULT" }, (response) => {
    if (!response?.success || !response.result) return;
    const result = response.result;
    const flaggedMessages = (result.flagged_messages || [])
      .map(
        (item) =>
          `<div style="margin-top:8px;"><b>${item.speaker}</b>: ${item.text}<br/><span class="muted">Reasons: ${(item.reasons || []).join(", ") || "None"}</span></div>`
      )
      .join("");
    document.getElementById("lastResult").innerHTML = `
      <b>Danger:</b> ${result.danger_rating}<br/>
      <b>Confidence:</b> ${result.confidence_score}<br/>
      <b>Action:</b> ${result.recommended_action || "monitor"}<br/>
      <b>Threats:</b> ${(result.threats_detected || []).join(", ") || "None"}<br/>
      <b>Flagged phrases:</b> ${(result.flagged_phrases || []).join(" | ") || "None"}<br/>
      <b>Messages scanned:</b> ${result.scanned_messages || 0}<br/>
      <b>Endpoint:</b> ${result.endpoint}<br/>
      <b>Page:</b> ${result.pageUrl}<br/>
      <b>Evaluation:</b> ${result.evaluation}
      ${
        result.highest_risk_message
          ? `<div style="margin-top:8px;"><b>Highest-risk message:</b> ${result.highest_risk_message}</div>`
          : ""
      }
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
        backendBaseUrl: document.getElementById("backendBaseUrl").value.trim() || "http://127.0.0.1:8000",
        scanIntervalMinutes: Math.max(1, Number(document.getElementById("scanIntervalMinutes").value) || 1),
        warningThreshold: Math.max(0, Math.min(100, Number(document.getElementById("warningThreshold").value) || 40))
      }
    },
    () => loadView()
  );
});

document.getElementById("scanNow").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RUN_MANUAL_SCAN" }, () => {
    window.setTimeout(loadView, 2000);
  });
});

document.getElementById("openDemo").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DEMO_PAGE" });
});

loadView();
