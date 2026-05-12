/**
 * vrstt.js — Server-side speech-to-text.
 *
 * Records on the headset, POSTs the audio blob to the hosting computer at
 * /api/stt, and gets back text. The Mac runs faster-whisper, which is much
 * faster than running Whisper in-browser on a mobile-grade Quest CPU.
 */

let mediaStream = null;
let recorder = null;
let chunks = [];
let inflight = null;   // AbortController for the in-progress upload

export function isSttSupported() {
  return !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

// Kept for API compatibility with vr.js (which calls it after startRecording).
// Nothing to preload server-side; the model warms on first /api/stt call.
export function loadWhisper(/* onProgress */) {
  return Promise.resolve();
}

export async function startRecording(onProgress) {
  if (!isSttSupported()) {
    throw new Error('Speech-to-text not supported in this browser.');
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });

  let mimeType = '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }

  chunks = [];
  recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  onProgress?.('● Recording…');
}

export async function stopRecording(onProgress) {
  if (!recorder) return '';

  const stopped = new Promise((resolve) => { recorder.onstop = () => resolve(); });
  if (recorder.state !== 'inactive') recorder.stop();
  await stopped;

  const usedMime = recorder.mimeType || 'audio/webm';
  recorder = null;

  if (mediaStream) {
    for (const tr of mediaStream.getTracks()) tr.stop();
    mediaStream = null;
  }

  if (!chunks.length) return '';
  const blob = new Blob(chunks, { type: usedMime });
  chunks = [];

  onProgress?.('Sending audio…');

  const form = new FormData();
  const ext = usedMime.includes('ogg') ? 'ogg' : usedMime.includes('mp4') ? 'mp4' : 'webm';
  form.append('file', blob, `clip.${ext}`);

  const ctrl = new AbortController();
  inflight = ctrl;
  const t0 = performance.now();
  let res;
  try {
    res = await fetch('/api/stt', { method: 'POST', body: form, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') return '';
    throw new Error('Network error: ' + (err.message || err));
  } finally {
    if (inflight === ctrl) inflight = null;
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* ignore */ }
    throw new Error(detail || `Server error ${res.status}`);
  }

  const data = await res.json();
  console.log(`[VR STT] /api/stt round-trip ${(performance.now() - t0).toFixed(0)}ms`);
  onProgress?.('Done');
  return (data?.text || '').trim();
}

export function cancelRecording() {
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch { /* ignore */ }
  if (mediaStream) {
    for (const tr of mediaStream.getTracks()) tr.stop();
    mediaStream = null;
  }
  recorder = null;
  chunks = [];
}

export function abortTranscription() {
  if (inflight) {
    try { inflight.abort(); } catch { /* ignore */ }
    inflight = null;
  }
}
