(() => {
  if (window.azurecordDesktop) return;
  const SESSION_KEY = 'azurecord_web_cloud_session_v1';
  window.azurecordDesktop = {
    platform: null,
    version: 'web',
    appVersion: '5.0.7',
    async getBackendInfo() {
      return { available: false, baseUrl: null, host: null, port: 0 };
    },
    async notify(title, body) {
      try {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission !== 'granted') return false;
        new Notification(String(title || 'Azurecord'), { body: String(body || '') });
        return true;
      } catch { return false; }
    },
    async getSecureSession() {
      try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
    },
    async setSecureSession(token) {
      try { localStorage.setItem(SESSION_KEY, String(token || '')); return true; } catch { return false; }
    },
    async deleteSecureSession() {
      try { localStorage.removeItem(SESSION_KEY); return true; } catch { return false; }
    }
  };
})();
