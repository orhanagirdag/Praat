import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { Blob } from 'buffer';

loadEnvFromFile();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const port = process.env.PORT || 3000;
const apiKey = process.env.API1;

if (!apiKey) {
  console.warn('Waarschuwing: API1 niet gevonden in omgevingsvariabelen. De app kan geen verbinding maken met OpenAI.');
}

const sessions = new Map();

app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  let sessionId = req.cookies.praatSession;
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = uuidv4();
    res.cookie('praatSession', sessionId, { httpOnly: false, sameSite: 'lax' });
    sessions.set(sessionId, createInitialState());
  }
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createInitialState());
  }
  req.sessionState = sessions.get(sessionId);
  next();
});

app.get('/api/state', (req, res) => {
  const state = req.sessionState;
  res.json({ level: state.level, conversationTurns: state.history.length });
});

app.post('/api/reset', (req, res) => {
  const sessionId = req.cookies.praatSession;
  if (sessionId) {
    sessions.set(sessionId, createInitialState());
  }
  res.json({ ok: true });
});

app.post('/api/ask', upload.single('audio'), async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: 'API sleutel ontbreekt op de server.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Geen audio ontvangen.' });
  }

  try {
    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    if (!transcript) {
      throw new Error('Transcriberen mislukt.');
    }

    const state = req.sessionState;
    state.history.push({ role: 'user', content: transcript });

    const tutorResult = await generateTutorResponse(state);

    state.history.push({ role: 'assistant', content: tutorResult.reply });
    state.level = tutorResult.estimated_level || state.level;

    res.json({
      transcript,
      replyText: tutorResult.reply,
      replyAudio: tutorResult.audio,
      estimatedLevel: state.level
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Onbekende fout.' });
  }
});

function loadEnvFromFile() {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  const envPath = path.resolve(dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function createInitialState() {
  return {
    level: 'A2',
    history: []
  };
}

async function transcribeAudio(buffer, mimetype = 'audio/webm') {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimetype || 'audio/webm' });
  formData.append('file', blob, 'speech.webm');
  formData.append('model', 'gpt-4o-transcribe');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Transcribe error:', errText);
    throw new Error('OpenAI transcriptie mislukt.');
  }

  const data = await response.json();
  return data.text;
}

async function generateTutorResponse(state) {
  const systemPrompt = `Je bent "Praat", een vriendelijke Nederlandse taaltutor voor nieuwkomers.\n- Houd een boeiende dialoog met interessante, culturele of praktische vragen.\n- Schat steeds het taalniveau (A1 t/m C2) op basis van de volledige geschiedenis.\n- Antwoord in het Nederlands, gebruik eenvoudige uitleg wanneer het niveau laag is en voeg kleine uitdagingen toe wanneer het niveau stijgt.\n- Geef korte feedback op fouten en stel een vervolgvraag.\n- Retourneer ALLEEN geldig JSON met de sleutels reply, estimated_level en tts_instructions.`;

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  for (const entry of state.history) {
    messages.push({ role: entry.role, content: entry.content });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Chat error:', errText);
    throw new Error('OpenAI antwoord mislukt.');
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.error('JSON parse error:', content);
    throw new Error('Antwoord kon niet worden gelezen.');
  }

  const reply = parsed.reply || 'Ik heb even geen antwoord. Kun je dat herhalen?';
  const estimatedLevel = parsed.estimated_level || state.level;
  const ttsInstructions = parsed.tts_instructions || reply;

  const audio = await synthesizeSpeech(ttsInstructions);

  return { reply, estimated_level: estimatedLevel, audio };
}

async function synthesizeSpeech(text) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      format: 'mp3',
      input: text
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('TTS error:', errText);
    throw new Error('OpenAI spraaksynthese mislukt.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString('base64');
  return `data:audio/mpeg;base64,${base64Audio}`;
}

app.listen(port, () => {
  console.log(`Praat server draait op http://localhost:${port}`);
});
