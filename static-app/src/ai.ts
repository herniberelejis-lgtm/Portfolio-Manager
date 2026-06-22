// AI assistant for the portfolio. By default it calls a shared serverless
// proxy (deployed on Vercel) that holds ONE Gemini key server-side, so a few
// trusted users can chat with zero setup and without ever seeing the key.
// A user may optionally paste their OWN Gemini key (kept only in this browser's
// localStorage, never in the public source); when present we call Gemini
// directly with it instead of the shared proxy.
const PROXY_URL = 'https://portfolio-manager-ai-blue.vercel.app/api/ask';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const KEY_STORAGE = 'pm_gemini_key';

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    const k = key.trim();
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

// AI is always available thanks to the shared proxy; a personal key is optional.
export function isAiConfigured(): boolean {
  return true;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const SYSTEM_PROMPT = `Sos un asistente financiero que responde preguntas sobre la cartera de inversión de un usuario argentino, basándote EXCLUSIVAMENTE en los datos que se te proveen a continuación. No inventes cifras que no estén en el contexto: si no tenés el dato, decilo. Respondé en español, claro y breve (4-5 oraciones salvo que se pida más detalle). No es asesoramiento financiero profesional.`;

export async function askPortfolioAI(
  question: string,
  context: string,
  history: ChatMessage[],
): Promise<string> {
  const apiKey = getApiKey();

  const contents = [
    { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nDatos de la cartera:\n${context}` }] },
    { role: 'model', parts: [{ text: 'Entendido, tengo los datos de la cartera. ¿En qué te puedo ayudar?' }] },
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];
  const generationConfig = {
    temperature: 0.3,
    maxOutputTokens: 500,
    thinkingConfig: { thinkingBudget: 0 },
  };

  const payload = JSON.stringify({ contents, generationConfig });
  // With a personal key, call Gemini directly; otherwise use the shared proxy
  // (which injects the server-side key and forwards the same request body).
  const doFetch = () =>
    apiKey
      ? fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
      : fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

  // Gemini's free tier intermittently returns 503/429 under load ("high
  // demand"). These are transient, so retry a few times with a short backoff
  // before surfacing the error to the user.
  const RETRYABLE = new Set([429, 500, 503]);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await doFetch();
    if (res.ok || !RETRYABLE.has(res.status) || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }

  if (!res.ok) {
    if (RETRYABLE.has(res.status)) {
      throw new Error(
        'El modelo de IA está sobrecargado en este momento (pico de demanda de Google). Esperá unos segundos y volvé a preguntar.',
      );
    }
    const body = await res.text().catch(() => '');
    throw new Error(`La IA respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Respuesta vacía del modelo.');
  return text;
}
