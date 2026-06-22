// Serverless proxy for the portfolio AI assistant (deployed on Vercel).
//
// The static site (GitHub Pages) has no backend, so a shared Gemini key can't
// live in its public source. This function holds that key as a server-side
// env var (GEMINI_API_KEY) and forwards a single generateContent call to
// Gemini, so a few trusted users can share one key without ever seeing it.
//
// Set GEMINI_API_KEY in the Vercel project settings (Environment Variables).
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Browsers calling from these origins get CORS access. Not a hard security
// boundary (Origin can be forged by non-browser clients), but it keeps the
// shared endpoint pointed at our own app for casual use.
const ALLOWED_ORIGINS = new Set([
  'https://herniberelejis-lgtm.github.io',
  'http://localhost:5173',
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor.' });
  }

  const { contents, generationConfig } = req.body || {};
  if (!Array.isArray(contents)) {
    return res.status(400).json({ error: 'Body inválido: falta "contents".' });
  }

  try {
    const r = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch {
    return res.status(502).json({ error: 'Error contactando a Gemini.' });
  }
}
