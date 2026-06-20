interface Props {
  onClose: () => void;
}

export function Tutorial({ onClose }: Props) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <button className="modalClose" onClick={onClose} aria-label="Cerrar">✕</button>

        <h1>📊 Cómo usar Portfolio Manager</h1>
        <p className="subtitle">
          Una app para seguir tu cartera de inversiones en brokers argentinos. Subís tus
          movimientos y te calcula todo: tenencias, ganancias, ROI, TIR, riesgo, y comparaciones
          contra el dólar, la inflación y Bitcoin.
        </p>

        <h2 className="tutH">1 · Conseguí tus datos del broker</h2>
        <p>Entrá a tu broker y descargá el historial de movimientos:</p>
        <ul className="tutList">
          <li><strong>Cocos Capital:</strong> sección <em>Movimientos</em> de tu cuenta → descargar/exportar el detalle (archivo <code>.csv</code>).</li>
          <li><strong>Bull Market:</strong> <em>Estado de cuenta / Movimientos</em> → exportar a <code>.csv</code>.</li>
          <li><strong>PPI:</strong> <em>Movimientos / Extracto</em> → exportar a Excel (<code>.xlsx</code>).</li>
        </ul>
        <p className="hint">Tip: bajá el historial completo. Podés subir varios archivos (ej. un CSV por año) y la app los une y descarta duplicados.</p>

        <h2 className="tutH">2 · Importalos</h2>
        <p>
          En la pestaña principal, tocá <strong>“Elegir archivo(s)”</strong> y seleccioná tus CSV/XLSX.
          La app detecta sola el broker y procesa todo. ¿Querés probar sin tus datos? Usá
          <strong> “Cargar ejemplo”</strong>.
        </p>

        <h2 className="tutH">3 · Explorá las 3 pestañas</h2>
        <ul className="tutList">
          <li><strong>Resumen:</strong> valor de mercado, P&amp;L, tabla de tenencias (con precio actual editable) y gráficos.</li>
          <li><strong>Análisis:</strong> el cerebro de la app — resumen ejecutivo, TIR, benchmarks (dólar/inflación/BTC), riesgo, costos, comportamiento y resumen fiscal por año.</li>
          <li><strong>Movimientos:</strong> todas tus operaciones con filtros, y exportación a CSV.</li>
        </ul>

        <h2 className="tutH">Qué vas a recibir</h2>
        <ul className="tutList">
          <li>Costo promedio, P&amp;L realizado y no realizado, ROI y TIR de tu cartera</li>
          <li>Precios actualizados automáticamente (acciones, CEDEARs y bonos)</li>
          <li>¿Le ganaste al dólar CCL, a la inflación y a Bitcoin?</li>
          <li>Concentración y nivel de riesgo, con alertas</li>
          <li>Tu patrón de comportamiento (en qué ganás y en qué perdés)</li>
          <li>Costos totales y resumen fiscal por año</li>
        </ul>

        <h2 className="tutH">🔒 Cómo cuidamos tu información</h2>
        <ul className="tutList">
          <li><strong>Privada y solo tuya:</strong> tus datos se guardan en tu cuenta y <strong>solo vos podés verlos</strong> — lo garantiza la seguridad a nivel de base de datos (Row Level Security). Ningún otro usuario accede a tu información.</li>
          <li><strong>Cifrado en tránsito:</strong> todo viaja por HTTPS.</li>
          <li><strong>No vendemos ni compartimos</strong> tus datos con nadie.</li>
          <li><strong>Contraseña protegida:</strong> nunca se guarda en texto plano (la hashea el proveedor de autenticación).</li>
          <li><strong>Tus números no salen a ningún lado:</strong> a las fuentes de precios solo se les pregunta por tickers (ej. “GGAL”), nunca por tus tenencias ni montos.</li>
          <li>Podés <strong>borrar toda tu data</strong> cuando quieras con el botón “Borrar todo”.</li>
        </ul>

        <button className="fileBtn tutCta" onClick={onClose}>Entendido, ¡a invertir! 🚀</button>
      </div>
    </div>
  );
}
