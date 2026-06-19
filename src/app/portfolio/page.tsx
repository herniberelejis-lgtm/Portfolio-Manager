import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildPortfolioView } from '@/lib/pnl/buildPortfolioView';
import { CsvImportPanel } from './CsvImportPanel';
import { PortfolioCharts } from './PortfolioCharts';
import styles from './portfolio.module.css';

function formatCents(cents: bigint): string {
  return (Number(cents) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pnlClass(cents: bigint): string {
  if (cents > 0n) return styles.positive;
  if (cents < 0n) return styles.negative;
  return '';
}

export default async function PortfolioPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({ where: { email: session.user!.email! } });
  if (!user) {
    redirect('/login');
  }

  const view = await buildPortfolioView(user.id);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.brandDot} />
          <span className={styles.brandName}>Portfolio Tracker</span>
        </div>
        <h1 className={styles.title}>Mi portfolio</h1>

        <div className={styles.cards}>
          <div className={styles.card}>
            <p className={styles.cardLabel}>Valor de mercado</p>
            <p className={styles.cardValue}>$ {formatCents(view.totals.marketValueCents)}</p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>P&L no realizado</p>
            <p className={`${styles.cardValue} ${pnlClass(view.totals.unrealizedPnlCents)}`}>
              $ {formatCents(view.totals.unrealizedPnlCents)}
            </p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>P&L realizado</p>
            <p className={`${styles.cardValue} ${pnlClass(view.totals.realizedPnlCents)}`}>
              $ {formatCents(view.totals.realizedPnlCents)}
            </p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>Cuentas conectadas</p>
            <p className={styles.cardValue}>{view.accountsCount}</p>
          </div>
        </div>

        <CsvImportPanel />

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Posiciones</h2>
          {view.positions.length === 0 ? (
            <p className={styles.empty}>No hay posiciones todavía. Importá un CSV de tu broker para empezar.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Cantidad</th>
                  <th>Costo prom.</th>
                  <th>Precio actual</th>
                  <th>No realizado</th>
                  <th>Realizado</th>
                  <th>% Cartera</th>
                </tr>
              </thead>
              <tbody>
                {view.positions.map((p) => (
                  <tr key={p.ticker}>
                    <td style={{ fontWeight: 600 }}>{p.ticker}</td>
                    <td>{p.quantity}</td>
                    <td>$ {formatCents(p.avgCostCents)}</td>
                    <td>$ {formatCents(p.currentPriceCents)}</td>
                    <td className={pnlClass(p.unrealizedPnlCents)}>$ {formatCents(p.unrealizedPnlCents)}</td>
                    <td className={pnlClass(p.realizedPnlCents)}>$ {formatCents(p.realizedPnlCents)}</td>
                    <td>{p.pctOfPortfolio.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PortfolioCharts
          positions={view.positions.map((p) => ({
            ticker: p.ticker,
            marketValue: Number(p.marketValueCents) / 100,
            unrealizedPnl: Number(p.unrealizedPnlCents) / 100,
            realizedPnl: Number(p.realizedPnlCents) / 100,
            pctOfPortfolio: p.pctOfPortfolio,
          }))}
          history={view.history.map((h) => ({
            date: h.date.toISOString(),
            investedCost: Number(h.investedCostCents) / 100,
            cumulativeRealizedPnl: Number(h.cumulativeRealizedPnlCents) / 100,
          }))}
        />
      </div>
    </main>
  );
}
