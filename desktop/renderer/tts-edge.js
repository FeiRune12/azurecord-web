/* Azurecord V14 TTS
   Lola uses a server-side Microsoft Edge Read Aloud voice.
   No browser SpeechSynthesis fallback is used, so the browser default voice
   cannot silently replace Lola's voice.
*/
(() => {
  let currentAudio = null;
  let currentUrl = null;

  function stop() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      try { currentAudio.currentTime = 0; } catch {}
      currentAudio = null;
    }
    if (currentUrl) {
      try { URL.revokeObjectURL(currentUrl); } catch {}
      currentUrl = null;
    }
  }

  async function speak(text) {
    const clean = String(text || '').trim().slice(0, 800);
    if (!clean) return;
    stop();
    const url = `/api/tts?text=${encodeURIComponent(clean)}`;
    const response = await fetch(url, { headers: { 'Accept': 'audio/mpeg' } });
    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch {}
      throw new Error(detail || `TTS HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('O servidor não retornou áudio.');
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    currentAudio = audio;
    audio.playbackRate = 1.0;
    audio.onended = stop;
    await audio.play();
  }

  window.AzurecordTTS = { speak, stop, provider: 'Microsoft Edge Read Aloud / ThalitaMultilingualNeural' };
})();
