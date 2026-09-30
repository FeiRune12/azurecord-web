/* Helpers puros para a UI não confundir um perfil salvo com uma sessão autenticada. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AzurecordAuthRecovery = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const emailKey = (email) => String(email || '').trim().toLowerCase();
  const originKey = (info) => info?.host === 'remote' ? String(info.baseUrl || '').replace(/\/+$/, '') : 'local-device';
  const canResume = (state, online, activeOrigin, verifiedUserId) => {
    const id = state?.rememberedAccountId;
    return !!(online && id && state?.backendToken && state?.backendAccountId === id
      && verifiedUserId === id
      && state?.accounts?.some(a => a.id === id && a.backend === true)
      && (!state?.backendOrigin || state.backendOrigin === activeOrigin));
  };
  const isLegacyLocal = (account) => !!(account && account.backend !== true && account.id !== 'user-fei-demo');
  const needsServerRecovery = (account, errorCode) => !!(account?.backend && errorCode === 'user_not_found');
  return { emailKey, originKey, canResume, isLegacyLocal, needsServerRecovery };
});
