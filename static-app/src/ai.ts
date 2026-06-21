// Free-tier AI assistant. Uses Google Gemini's no-cost API tier (no credit
// card required) called directly from the browser — the same trust model
// already used for the Finnhub/Twelve Data keys in this app: the key is
// public, but it only ever reads/writes the user's own portfolio numbers
// that we send as context, nothing sensitive lives server-side anyway.
const GEMINI_API_KEY = 'PASTE_YOUR_FREE_GEMINI_KEY_HERE';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export const aiConfigured = GEMINI_API_KEY.length > 10 && !GEMINI_API_KEY.startsWith('PASTE_');

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
  if (!aiConfigured) throw new Error('Falta configurar la clave gratuita de IA (Gemini).');

  const contents = [
    { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nDatos de la cartera:\n${context}` }] },
    { role: 'model', parts: [{ text: 'Entendido, tengo los datos de la cartera. ¿En qué te puedo ayudar?' }] },
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Respuesta vacía del modelo.');
  return text;
}
