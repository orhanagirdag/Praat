import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API1;

if (!API_KEY) {
  console.warn('⚠️  Geen API1-sleutel gevonden. Zet de omgevingsvariabele voordat je de server start.');
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

const SESSION_COOKIE = 'praat_session';
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 uur
const MAX_TURNS = 20;
const sessions = new Map();

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastUpdated > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

function getSession(req, res) {
  let id = req.cookies[SESSION_COOKIE];
  if (!id) {
    id = uuid();
    res.cookie(SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
  }

  let session = sessions.get(id);
  if (!session) {
    session = {
      history: [],
      level: null,
      lastUpdated: Date.now()
    };
    sessions.set(id, session);
  } else {
    session.lastUpdated = Date.now();
  }

  if (sessions.size % 25 === 0) {
    cleanupSessions();
  }

  return session;
}

function trimHistory(history, limit = MAX_TURNS) {
  if (history.length <= limit) {
    return [...history];
  }
  return history.slice(history.length - limit);
}

async function transcribeAudio(file) {
  if (!API_KEY) {
    throw new Error('API-sleutel ontbreekt.');
  }

  const formData = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
  formData.append('file', blob, file.originalname || 'audio.webm');
  formData.append('model', 'gpt-4o-transcribe');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Transcriberen mislukt.');
  }

  const payload = await response.json();
  return payload.text?.trim() || '';
}

async function generateReply(history, level) {
  if (!API_KEY) {
    throw new Error('API-sleutel ontbreekt.');
  }

  const systemPrompt = `Je bent Praat, een behulpzame taalcoach voor volwassen anderstalige nieuwkomers.\n` +
    `- Houd het volledige gesprek in het Nederlands.\n` +
    `- Stel telkens precies één vraag die aansluit bij de gebruiker.\n` +
    `- Leg moeilijke woorden kort uit als het niveau laag is.\n` +
    `- Beperk je antwoord tot maximaal drie zinnen.\n` +
    `- Schat het CEFR-niveau (A1 t/m C2) op basis van de volledige geschiedenis.\n` +
    `- Antwoord uitsluitend als JSON met de sleutels "reply", "question" en "estimatedLevel".`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimHistory(history)
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Conversatie mislukt.');
  }

  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      throw new Error('Onverwachte antwoordstructuur.');
    }
  }

  if (!content || typeof content.reply !== 'string') {
    throw new Error('Antwoord bevat geen tekst.');
  }

  const baseReply = content.reply.trim();
  const question = content.question ? String(content.question).trim() : '';
  const replyText = question ? `${baseReply} ${question}`.trim() : baseReply;
  const estimatedLevel = content.estimatedLevel ? String(content.estimatedLevel).trim() : level;

  return { replyText, estimatedLevel };
}

async function synthesizeSpeech(text) {
  if (!API_KEY) {
    throw new Error('API-sleutel ontbreekt.');
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: text
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Spraak genereren mislukt.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
}

app.get('/api/state', (req, res) => {
  const session = getSession(req, res);
  res.json({ level: session.level });
});

app.post('/api/ask', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Geen audio ontvangen.' });
  }

  const session = getSession(req, res);

  try {
    const transcript = await transcribeAudio(req.file);
    if (!transcript) {
      throw new Error('Transcript is leeg.');
    }

    const conversation = [...session.history, { role: 'user', content: transcript }];
    const { replyText, estimatedLevel } = await generateReply(conversation, session.level);

    session.level = estimatedLevel || session.level;
    session.history = trimHistory([...conversation, { role: 'assistant', content: replyText }]);
    session.lastUpdated = Date.now();

    let replyAudio = null;
    try {
      replyAudio = await synthesizeSpeech(replyText);
    } catch (error) {
      console.warn('Spraaksynthese mislukt:', error.message);
    }

    res.json({
      transcript,
      replyText,
      replyAudio,
      estimatedLevel: session.level
    });
  } catch (error) {
    console.error('Fout bij /api/ask:', error);
    res.status(500).json({ error: error.message || 'Er is iets misgegaan.' });
  }
});

app.use((err, req, res, next) => {
  console.error('Onverwerkte fout:', err);
  res.status(500).json({ error: 'Interne serverfout.' });
});

app.listen(PORT, () => {
  console.log(`Praat-server draait op http://localhost:${PORT}`);
});
