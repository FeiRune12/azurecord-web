(() => {
  if (window.azurecordDesktop) return;

  const SESSION_KEY = 'azurecord_web_cloud_session_v1';
  const native = window.AzurecordNative || null;
  const isNativeAndroid = !!native && (
    typeof native.isNativeAndroid === 'function' ? native.isNativeAndroid() : /AzurecordAndroid\//i.test(navigator.userAgent || '')
  );

  const localGet = () => {
    try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
  };
  const localSet = (token) => {
    try { localStorage.setItem(SESSION_KEY, String(token || '')); return true; } catch { return false; }
  };
  const localDelete = () => {
    try { localStorage.removeItem(SESSION_KEY); return true; } catch { return false; }
  };

  window.azurecordDesktop = {
    platform: isNativeAndroid ? 'android' : null,
    version: isNativeAndroid ? 'native-android' : 'web',
    appVersion: (() => {
      try { return isNativeAndroid && typeof native.getAppVersion === 'function' ? native.getAppVersion() : '6.0.9'; }
      catch { return '6.0.9'; }
    })(),

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
      if (isNativeAndroid && typeof native.getSecureSession === 'function') {
        try {
          const token = native.getSecureSession();
          if (token) {
            localSet(token);
            return token;
          }
        } catch {}
      }
      return localGet();
    },

    async setSecureSession(token) {
      const value = String(token || '');
      if (!value) return false;
      let nativeSaved = false;
      if (isNativeAndroid && typeof native.setSecureSession === 'function') {
        try { nativeSaved = native.setSecureSession(value) !== false; } catch {}
      }
      const localSaved = localSet(value);
      return isNativeAndroid ? nativeSaved : localSaved;
    },

    async deleteSecureSession() {
      let nativeDeleted = true;
      if (isNativeAndroid && typeof native.deleteSecureSession === 'function') {
        try { nativeDeleted = native.deleteSecureSession() !== false; } catch { nativeDeleted = false; }
      }
      const localDeleted = localDelete();
      return isNativeAndroid ? nativeDeleted : localDeleted;
    },

    async getReadyUpdateVersion() {
      if (!isNativeAndroid || typeof native.getReadyUpdateVersion !== 'function') return '';
      try { return String(native.getReadyUpdateVersion() || ''); } catch { return ''; }
    },

    async installReadyUpdate() {
      if (!isNativeAndroid || typeof native.installReadyUpdate !== 'function') return false;
      try { return native.installReadyUpdate() !== false; } catch { return false; }
    }
  };
})();
