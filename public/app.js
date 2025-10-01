const micButton = document.getElementById('micButton');
const conversation = document.getElementById('conversation');
const levelEl = document.getElementById('level');
const errorEl = document.getElementById('error');

let mediaRecorder;
let chunks = [];
let isRecording = false;
let busy = false;

async function initialise() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    mediaRecorder.addEventListener('stop', onStopRecording);
    micButton.disabled = false;
    await updateState();
  } catch (error) {
    handleError('Microfoon kon niet worden gestart. Controleer je instellingen.');
    console.error(error);
  }
}

function handleError(message) {
  errorEl.textContent = message;
  setTimeout(() => (errorEl.textContent = ''), 6000);
}

async function updateState() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) return;
    const data = await response.json();
    updateLevel(data.level);
  } catch (error) {
    console.warn('Kon status niet ophalen', error);
  }
}

function updateLevel(level) {
  levelEl.textContent = `Taalniveau: ${level ?? 'onbekend'}`;
}

function addTurn(role, text) {
  const turn = document.createElement('article');
  turn.className = `turn ${role}`;

  const roleEl = document.createElement('span');
  roleEl.className = 'role';
  roleEl.textContent = role === 'user' ? 'Jij' : 'Praat';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  turn.appendChild(roleEl);
  turn.appendChild(bubble);
  conversation.appendChild(turn);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

function setBusy(state) {
  busy = state;
  micButton.classList.toggle('loading', state);
  micButton.disabled = state || !mediaRecorder;
}

function startRecording() {
  if (!mediaRecorder || isRecording || busy) return;
  chunks = [];
  mediaRecorder.start();
  isRecording = true;
  micButton.classList.add('recording');
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  isRecording = false;
  mediaRecorder.stop();
  micButton.classList.remove('recording');
}

async function onStopRecording() {
  if (chunks.length === 0) return;
  const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
  chunks = [];
  const placeholder = addTurn('user', '…');
  setBusy(true);
  try {
    const formData = new FormData();
    formData.append('audio', blob, 'speech.webm');

    const response = await fetch('/api/ask', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Onbekende fout.' }));
      throw new Error(err.error || 'Serverfout.');
    }

    const data = await response.json();
    placeholder.textContent = data.transcript;
    addTurn('assistant', data.replyText);
    if (data.replyAudio) {
      const audio = new Audio(data.replyAudio);
      audio.play().catch((err) => console.warn('Audio afspelen mislukt', err));
    }
    if (data.estimatedLevel) {
      updateLevel(data.estimatedLevel);
    }
  } catch (error) {
    console.error(error);
    placeholder.textContent = '❗ Opname mislukt';
    handleError(error.message || 'Er is iets misgegaan.');
  } finally {
    setBusy(false);
  }
}

micButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  startRecording();
});

micButton.addEventListener('pointerup', () => {
  stopRecording();
});

micButton.addEventListener('pointerleave', () => {
  if (isRecording) {
    stopRecording();
  }
});

micButton.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'Enter') {
    startRecording();
  }
});

micButton.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.code === 'Enter') {
    stopRecording();
  }
});

window.addEventListener('DOMContentLoaded', initialise);
