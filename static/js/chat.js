/**
 * chat.js — addMessage, sendMessage, speech bubble, VR chat overlay.
 */
import * as THREE from 'three';
import { camera, chatHistory3D, wsSend, myName } from './state.js';

// ── DOM refs ──
const chatOutput   = document.getElementById('chat-output');
const chatInput    = document.getElementById('chat-input');
const sendBtn      = document.getElementById('send-btn');
const speechBubble = document.getElementById('speech-bubble');

speechBubble.addEventListener('click', () => { speechBubble.style.display = 'none'; });

// ── Speech bubble positioning ──
const bubbleWorldPos = new THREE.Vector3();

function updateSpeechBubblePosition() {
  if (speechBubble.style.display === 'none' || speechBubble.style.display === '') return;
  bubbleWorldPos.set(0, 2.6, 0).project(camera);
  const x = (bubbleWorldPos.x * 0.5 + 0.5) * innerWidth;
  const y = (-bubbleWorldPos.y * 0.5 + 0.5) * innerHeight;
  speechBubble.style.left = x + 'px';
  speechBubble.style.top  = (y - 20) + 'px';
  speechBubble.style.transform = 'translate(-50%, -100%)';
}

export function updateSpeechBubbleFrame() {
  updateSpeechBubblePosition();
}

export function showSpeechBubble(text, dur = 5000) {
  speechBubble.textContent = text.length > 120 ? text.substring(0, 120) + '\u2026' : text;
  speechBubble.style.display = 'block';
  updateSpeechBubblePosition();
  clearTimeout(speechBubble._t);
  speechBubble._t = setTimeout(() => { speechBubble.style.display = 'none'; }, dur);
}

export function showTypingBubble() {
  speechBubble.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
  speechBubble.style.display = 'block';
  updateSpeechBubblePosition();
}

// ── Talking state (consumed by humanoid animation) ──
export let isTalking = false;
export function setTalking(val) { isTalking = val; }

// ── Message display ──
export function addMessage(text, type = 'bot') {
  // Desktop chat panel
  const div = document.createElement('div');
  div.className = `msg msg-${type}`;
  div.textContent = text;
  chatOutput.appendChild(div);
  chatOutput.scrollTop = chatOutput.scrollHeight;

  chatHistory3D.push((type === 'peer' ? '' : (type === 'user' ? 'You: ' : type === 'bot' ? 'AI: ' : '')) + (text.length > 80 ? text.substring(0, 80) + '\u2026' : text));
}

// ── Send message ──
export async function sendMessage(textArg) {
  let text;
  if (typeof textArg === 'string' && textArg.trim()) {
    text = textArg.trim();
  } else {
    text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
  }
  addMessage(text, 'user');
  wsSend({ type: 'chat', chatType: 'user', text, name: myName });
  sendBtn.disabled = true; chatInput.disabled = true;
  showTypingBubble(); setTalking(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (res.ok) {
      addMessage(data.reply, 'bot');
      showSpeechBubble(data.reply, 6000);
      wsSend({ type: 'chat', chatType: 'bot', text: data.reply });
    } else {
      addMessage(data.reply || 'Something went wrong.', 'system');
      speechBubble.style.display = 'none';
    }
  } catch (err) {
    addMessage('Network error. Is the server running?', 'system');
    speechBubble.style.display = 'none';
  } finally {
    sendBtn.disabled = false; chatInput.disabled = false;
    chatInput.focus(); setTalking(false);
  }
}

export function initChat() {
  sendBtn.addEventListener('click', () => sendMessage());
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}
