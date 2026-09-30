(() => {
  if (!('serviceWorker' in navigator)) return;

  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('azurecord:pwa-install-available'));
  });

  window.azurecordInstallPwa = async () => {
    if (!deferredInstallPrompt) return { available: false };
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return { available: true, outcome: choice?.outcome || 'dismissed' };
  };

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('azurecord:pwa-installed'));
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './',
        updateViaCache: 'none'
      });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('[Azurecord PWA] Service Worker não pôde ser registrado.', error);
    }
  });
})();
