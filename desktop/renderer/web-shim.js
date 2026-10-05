(() => {
  if (window.azurecordDesktop) return;
  const SESSION_KEY = 'azurecord_web_cloud_session_v1';
  window.azurecordDesktop = {
    platform: null,
    version: 'web',
    appVersion: '6.0.8',
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
      try {
        const nativeValue = window.AzurecordNative?.getSecureSession?.();
        if (nativeValue) return String(nativeValue);
      } catch {}
      try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
    },
    async setSecureSession(token) {
      const value = String(token || '');
      try {
        if (window.AzurecordNative?.setSecureSession?.(value)) {
          try { localStorage.setItem(SESSION_KEY, value); } catch {}
          return true;
        }
      } catch {}
      try { localStorage.setItem(SESSION_KEY, value); return true; } catch { return false; }
    },
    async deleteSecureSession() {
      try { window.AzurecordNative?.deleteSecureSession?.(); } catch {}
      try { localStorage.removeItem(SESSION_KEY); return true; } catch { return false; }
    },
    async getReadyUpdateVersion() {
      try { return String(window.AzurecordNative?.getReadyUpdateVersion?.() || ''); } catch { return ''; }
    },
    async installReadyUpdate() {
      try { return !!window.AzurecordNative?.installReadyUpdate?.(); } catch { return false; }
    }
  };
})();
