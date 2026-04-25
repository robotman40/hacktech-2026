/* utils/messaging.js — typed message passing between content ↔ background */
(function () {
  const MSG = {
    EVALUATE:      "safechat:evaluate",
    EVALUATE_RESP: "safechat:evaluate:resp",
    REPORT_SAVED:  "safechat:report_saved",
    GET_REPORTS:   "safechat:get_reports",
    CLEAR_REPORTS: "safechat:clear_reports",
    PROFILE_GET:   "safechat:profile_get",
    PROFILE_SET:   "safechat:profile_set",
  };

  function sendToBackground(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Convenience wrappers used by content scripts
  const Messaging = {
    MSG,

    evaluate(messages, meta) {
      return sendToBackground(MSG.EVALUATE, { messages, meta });
    },

    getReports(hostname) {
      return sendToBackground(MSG.GET_REPORTS, { hostname });
    },

    clearReports(hostname) {
      return sendToBackground(MSG.CLEAR_REPORTS, { hostname });
    },

    getProfile(hostname) {
      return sendToBackground(MSG.PROFILE_GET, { hostname });
    },

    setProfile(hostname, patch) {
      return sendToBackground(MSG.PROFILE_SET, { hostname, patch });
    },
  };

  window.Messaging = Messaging;
})();
