(() => {
  const onVercel = /(^|\.)vercel\.app$/i.test(location.hostname);
  window.AZURECORD_CONFIG = {
    apiBaseUrl: onVercel
      ? location.origin + '/azurecord-cloud'
      : 'https://azurecord-api.giovannisilvaalves604.workers.dev',
    realtimeBaseUrl: 'https://azurecord-realtime.giovannisilvaalves604.workers.dev',
    webBaseUrl: location.origin + '/'
  };
})();
