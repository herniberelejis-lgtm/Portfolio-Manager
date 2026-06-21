import { CompanyDetail } from './CompanyDetail';

export function Empresas({ tickers }: { tickers: string[] }) {
  if (tickers.length === 0) {
    return (
      <section className="section">
        <p className="hint">No hay acciones o CEDEARs en tu cartera para analizar.</p>
      </section>
    );
  }

  return (
    <div>
      <section className="section">
        <h2 className="sectionTitle">Análisis por empresa</h2>
        <p className="hint">
          Gráfico de precio (Twelve Data) y fundamentals (Finnhub) de tus tenencias. Funciona muy
          bien con CEDEARs y acciones de EEUU; las acciones argentinas pueden tener datos limitados.
        </p>
      </section>
      {tickers.map((t) => (
        <section className="section" key={t}>
          <h3 className="sectionTitle">{t}</h3>
          <CompanyDetail ticker={t} />
        </section>
      ))}
    </div>
  );
}
