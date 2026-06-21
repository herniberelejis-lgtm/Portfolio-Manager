import { useEffect, useState } from 'react';
import { coreConclusions, type Conclusion, type ConclusionInput, type Level } from './insights';
import { fetchCCL, fetchInflation, inflationAccum, latestValue, valueAtDate } from './benchmarks';

const ICON: Record<Level, string> = { good: '✅', warn: '⚠️', bad: '🔴' };
const ORDER: Record<Level, number> = { bad: 0, warn: 1, good: 2 };

export function Conclusiones({
  input,
  startDate,
  returnPct,
}: {
  input: ConclusionInput;
  startDate: Date | null;
  returnPct: number | null;
}) {
  const core = coreConclusions(input);
  const [extra, setExtra] = useState<Conclusion[]>([]);

  useEffect(() => {
    if (!startDate || returnPct == null) return;
    let cancelled = false;
    Promise.all([fetchCCL(), fetchInflation()])
      .then(([ccl, infl]) => {
        if (cancelled) return;
        const ex: Conclusion[] = [];
        const cclNow = latestValue(ccl);
        const cclStart = valueAtDate(ccl, startDate);
        if (cclNow && cclStart) {
          const cclRet = (cclNow / cclStart - 1) * 100;
          ex.push(
            returnPct >= cclRet
              ? { level: 'good', title: 'Le ganaste al dólar', detail: `Tu retorno (${returnPct.toFixed(1)}%) superó al dólar CCL (${cclRet.toFixed(1)}%) en el período.` }
              : { level: 'bad', title: 'El dólar te ganó', detail: `El CCL subió ${cclRet.toFixed(1)}% y vos hiciste ${returnPct.toFixed(1)}%: te hubiera convenido dolarizarte.` },
          );
        }
        const inflAcc = inflationAccum(infl, startDate);
        if (inflAcc > 0) {
          ex.push(
            returnPct >= inflAcc
              ? { level: 'good', title: 'Ganancia real positiva', detail: `Le ganaste a la inflación (${inflAcc.toFixed(1)}%): tu poder de compra creció.` }
              : { level: 'bad', title: 'Perdiste contra la inflación', detail: `La inflación acumuló ${inflAcc.toFixed(1)}% y tu retorno fue ${returnPct.toFixed(1)}%: en términos reales perdiste poder de compra.` },
          );
        }
        setExtra(ex);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [startDate, returnPct]);

  const all = [...core, ...extra].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  return (
    <section className="section">
      <h2 className="sectionTitle">Conclusiones</h2>
      <p className="hint">Lectura automática de tus números — qué está bien y qué conviene revisar.</p>
      <div className="conclList">
        {all.map((c, i) => (
          <div className={`conclItem ${c.level}`} key={i}>
            <span className="conclIcon">{ICON[c.level]}</span>
            <div>
              <div className="conclTitle">{c.title}</div>
              <div className="conclDetail">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
