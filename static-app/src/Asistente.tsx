import { useState } from 'react';
import type { ParsedTransaction } from './portfolio';
import { askPortfolioAI, aiConfigured, type ChatMessage } from './ai';
import { buildPortfolioContext } from './aiContext';

const SUGGESTIONS = [
  '¿Le gané al dólar este año?',
  '¿Qué tan diversificada está mi cartera?',
  '¿Cuál fue mi mejor y peor operación?',
  '¿Estoy asumiendo mucho riesgo?',
];

export function Asistente({
  transactions,
  prices,
}: {
  transactions: ParsedTransaction[];
  prices: Record<string, bigint>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setError('');
    const next = [...messages, { role: 'user', text: q } as ChatMessage];
    setMessages(next);
    setBusy(true);
    try {
      const context = buildPortfolioContext(transactions, prices);
      const answer = await askPortfolioAI(q, context, messages);
      setMessages([...next, { role: 'model', text: answer }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!aiConfigured) {
    return (
      <section className="section">
        <h2 className="sectionTitle">Asistente (IA)</h2>
        <p className="hint">
          Falta configurar una clave gratuita de Google Gemini para habilitar esta función.
          Conseguí una sin costo (no pide tarjeta) en{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com/apikey
          </a>{' '}
          y pegala en <code>static-app/src/ai.ts</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2 className="sectionTitle">Asistente (IA)</h2>
      <p className="hint">
        Preguntale en lenguaje natural sobre tu propia cartera. Responde solo con tus datos reales
        — no es asesoramiento financiero.
      </p>

      {messages.length === 0 && (
        <div className="filterRow" style={{ marginBottom: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="aiChat">
          {messages.map((m, i) => (
            <div key={i} className={`aiMsg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="aiMsg model">
              <em>Pensando…</em>
            </div>
          )}
        </div>
      )}

      {error && <p className="message">{error}</p>}

      <div className="importRow">
        <input
          className="aiInput"
          placeholder="Escribí tu pregunta…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          disabled={busy}
        />
        <button className="fileBtn" onClick={() => send(input)} disabled={busy || !input.trim()}>
          Preguntar
        </button>
      </div>
    </section>
  );
}
