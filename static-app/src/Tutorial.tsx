interface Props {
  onClose: () => void;
}

export function Tutorial({ onClose }: Props) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <button className="modalClose" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>

        <h1>📊 Cómo usar Portfolio Manager</h1>
        <p className="subtitle">
          Subís los movimientos de tu broker y la app te calcula <strong>todo</strong>: cuánto
          tenés, cuánto ganaste, tu riesgo, y si le ganaste al dólar, a la inflación y al mercado.
          Corre 100% en tu navegador y tus datos son privados.
        </p>

        <h2 className="tutH">🟣 Paso 1 · Conseguí tus datos del broker</h2>
        <p>Entrá a tu broker y descargá el historial de movimientos:</p>
        <ul className="tutList">
          <li><strong>Cocos Capital:</strong> sección <em>Movimientos</em> → exportar/descargar (<code>.csv</code>).</li>
          <li><strong>Bull Market:</strong> <em>Estado de cuenta / Movimientos</em> → exportar (<code>.csv</code>).</li>
          <li><strong>PPI:</strong> <em>Movimientos / Extracto</em> → exportar a Excel (<code>.xlsx</code>).</li>
        </ul>
        <p className="hint">
          💡 Bajá el historial completo. Podés subir <strong>varios archivos</strong> (ej. uno por año)
          y la app los une y descarta duplicados solo.
        </p>

        <h2 className="tutH">🟣 Paso 2 · Importá (o probá sin tus datos)</h2>
        <p>
          Tocá <strong>"Elegir archivo(s)"</strong> y seleccioná tus CSV/XLSX. La app detecta sola el
          broker. Dos formas de usarla:
        </p>
        <ul className="tutList">
          <li><strong>Movimientos completos</strong> (recomendado): historial de compras/ventas → análisis completo con P&amp;L, ROI, etc.</li>
          <li><strong>Solo tenencias:</strong> ¿solo querés ver tu cartera de hoy? Subí tu <em>reporte de tenencias</em> (posiciones actuales).</li>
          <li><strong>"Cargar ejemplo":</strong> probá la app con datos de muestra, sin subir nada.</li>
        </ul>

        <h2 className="tutH">🟣 Paso 3 · Explorá las 5 pestañas</h2>
        <ul className="tutList">
          <li>
            <strong>📋 Resumen:</strong> valor de tu cartera, P&amp;L, y la tabla de tenencias.
            <strong> Tocá cualquier fila</strong> y se despliega el <strong>gráfico de precio</strong>
            {' '}(1M/3M/6M/1A) y los datos de esa empresa.
          </li>
          <li>
            <strong>📈 Análisis:</strong> el cerebro de la app — resumen ejecutivo, <strong>TIR</strong>,
            ROI, win rate, concentración + alertas, costos, tus <strong>sesgos</strong> (en qué ganás y
            en qué perdés), resumen fiscal por año, y los <strong>benchmarks</strong>: ¿le ganaste al
            <strong> dólar CCL</strong>, a la <strong>inflación</strong>, a <strong>Bitcoin</strong>, al
            <strong> S&amp;P 500</strong> y a las <strong>acciones argentinas</strong>?
          </li>
          <li>
            <strong>🛡️ Riesgo:</strong> volatilidad, <strong>VaR</strong> (cuánto podrías perder en un
            mes malo), drawdown máximo, simulación de escenarios (−20/−40/−70%) y la
            <strong> correlación</strong> entre tus activos (¿estás bien diversificado?).
          </li>
          <li>
            <strong>🏢 Empresas:</strong> análisis fundamental de cada acción/CEDEAR — P/E, PEG,
            distancia del máximo, consenso de analistas, noticias y gráfico de precio.
          </li>
          <li>
            <strong>🧾 Movimientos:</strong> todas tus operaciones con filtros (compras, ventas,
            dividendos…) y exportación a <strong>CSV</strong>.
          </li>
        </ul>

        <h2 className="tutH">🟣 Tips útiles</h2>
        <ul className="tutList">
          <li>Los <strong>precios se actualizan solos</strong> (acciones, CEDEARs y bonos). También podés editarlos a mano o usar "Actualizar precios".</li>
          <li>El valor de tu cartera lo ves en <strong>pesos y en dólares (CCL)</strong>.</li>
          <li>Con "Borrar todo" reseteás tus datos cuando quieras.</li>
        </ul>

        <h2 className="tutH">🔒 Tu información está protegida</h2>
        <ul className="tutList">
          <li><strong>Privada y solo tuya:</strong> tus datos viven en tu cuenta y <strong>solo vos los ves</strong> — lo garantiza la seguridad a nivel de base de datos. Ningún otro usuario accede a tu información.</li>
          <li><strong>Cifrado en tránsito</strong> (HTTPS) y contraseña nunca guardada en texto plano.</li>
          <li><strong>No vendemos ni compartimos</strong> tus datos. A las fuentes de precios solo se les pregunta por el ticker (ej. "GGAL"), nunca por tus montos.</li>
        </ul>

        <button className="fileBtn tutCta" onClick={onClose}>
          ¡Entendido, a invertir! 🚀
        </button>
      </div>
    </div>
  );
}
