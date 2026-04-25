/* adapters/registry.js — maps the current page to the right adapter */
(function () {
  const ALL_ADAPTERS = [
    new InstagramAdapter(),
    new FacebookAdapter(),
    new WhatsAppAdapter(),
    new TinderAdapter(),
    new LinkedInAdapter(),
    new TwitterAdapter(),
    new DiscordAdapter(),
  ];

  const AdapterRegistry = {
    // Returns the first adapter whose isActive() returns true for this page.
    getActive() {
      return ALL_ADAPTERS.find((a) => {
        try { return a.isActive(); }
        catch { return false; }
      }) || null;
    },

    // Returns all registered adapters (for options UI listing).
    getAll() {
      return ALL_ADAPTERS;
    },

    // Returns the adapter whose hostname matches (used in options page).
    getByHostname(hostname) {
      return ALL_ADAPTERS.find((a) => a.hostname === hostname) || null;
    },
  };

  window.AdapterRegistry = AdapterRegistry;
})();
