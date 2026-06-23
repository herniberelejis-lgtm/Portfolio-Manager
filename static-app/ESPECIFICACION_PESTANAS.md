# 📊 Portfolio Manager — Especificación detallada de pestañas

> Documento de referencia: **qué debe contener cada pestaña** del gestor de portfolio.
> Sirve como checklist de implementación y de control de calidad.
> Cada ítem marca `[ ]` lo pendiente y `[x]` lo ya implementado.

**Pestañas:** 📋 Resumen · 📈 Análisis · 🛡️ Riesgo · 🧾 Movimientos · 🤖 Asistente IA

---

## 🧱 Fundamentos comunes a todas las pestañas

- [x] **Cálculo en centavos (BigInt)** para evitar drift de punto flotante en montos.
- [x] **Costo promedio ponderado** como método de valuación de posiciones.
- [x] **Doble moneda**: todo valor se muestra en **ARS** y en **USD (CCL)**.
- [x] **Datos privados por usuario** mediante Row Level Security (RLS) en Supabase.
- [x] **Funciona 100% en el navegador** (SPA Vite + React), sin backend propio de cálculo.
- [ ] **Tooltips explicativos** en cada métrica compleja (TIR, VaR, Beta, Sharpe).
- [ ] **Responsive** completo para mobile (< 768px).
- [ ] **Estados vacíos** claros: qué se ve cuando todavía no hay datos cargados.
- [ ] **Estados de carga** (skeletons) mientras se sincronizan precios o se calcula.

---

## 📋 Pestaña RESUMEN

Vista de entrada: cuánto tengo hoy y cómo se compone.

### Encabezado de cartera
- [x] **Valor total de la cartera** (ARS y USD CCL).
- [x] **P&L total** (realizado + no realizado).
- [ ] **Retorno % total** sobre el capital invertido.
- [ ] **Variación del día** (si hay precio de cierre previo).

### Tabla de tenencias
- [x] Columnas: **Ticker | Cantidad | Precio actual | Valor de mercado | % cartera | P&L**.
- [x] **Fila desplegable** con detalle de la empresa al tocar (estilo Investing).
- [x] **Gráfico de precio** del activo (1S / 1M / 3M / 6M / 1A).
- [x] **Datos clave**: P/E, PEG, Beta, market cap, rango de 52 semanas.
- [x] **Consenso de analistas** y **noticias** del activo.
- [ ] **Orden configurable** (por valor, por % cartera, por P&L).

### Precios
- [x] **Actualización automática** de precios (acciones, CEDEARs, bonos).
- [x] **Edición manual** de precios y botón "Actualizar precios".
- [ ] **Marca de tiempo** de la última actualización por activo.

---

## 📈 Pestaña ANÁLISIS

El "cerebro" de la app: rendimiento, costos, sesgos y benchmarks.

### Resumen ejecutivo
- [x] Valor actual de la cartera (ARS y USD).
- [x] P&L realizado + no realizado.
- [ ] Período cubierto (fecha del primer movimiento → hoy).

### Métricas de rendimiento
- [x] **TIR** (Tasa Interna de Retorno) — anualizada, ajustada por flujos de caja.
- [x] **ROI** — retorno simple sobre lo invertido.
- [x] **Win rate** — % de operaciones ganadoras.
- [ ] **Profit factor** — ganancias totales / pérdidas totales.
- [ ] **Mejor y peor operación** (máx. ganancia / máx. pérdida por trade).

### Concentración
- [x] **Tabla de tenencias** con % de cartera por activo.
- [x] **Alertas de concentración** (warning > 30%, error > 50%).
- [ ] **Gráfico de torta/anillo** de composición.
- [ ] **Score de diversificación** (índice Herfindahl normalizado 0–100).

### Costos
- [x] **Comisiones totales pagadas**.
- [ ] **Costos como % del volumen operado**.
- [ ] **Impacto de los costos sobre el retorno**.

### Sesgos y patrones (behavioral)
- [x] **En qué ganás y en qué perdés** (rendimiento por activo / categoría).
- [ ] **Holding time promedio** (días hasta la venta).
- [ ] **Detector pánico/codicia** (ventas tras caídas vs. tras subidas).

### Resumen fiscal
- [x] **P&L por año impositivo** (enero–diciembre).
- [ ] **Operaciones por tipo y año** (compra/venta/dividendo/comisión).
- [ ] **Ganancias netas realizadas por año** (insumo para declaración).

### Benchmarks (¿le ganaste a…?)
- [x] **Dólar CCL**.
- [x] **Inflación** (IPC Argentina).
- [x] **Bitcoin**.
- [x] **S&P 500**.
- [x] **Acciones argentinas** (panel local).
- [ ] **Gráfico de líneas comparativo** (tu cartera vs. cada benchmark).

---

## 🛡️ Pestaña RIESGO

Cuánto podés perder y qué tan diversificado estás.

### Volatilidad
- [x] **Volatilidad histórica** de la cartera.
- [ ] **Volatilidad por activo** (ordenada de mayor a menor).
- [ ] **Beta de la cartera** vs. S&P 500.
- [ ] **Volatilidad rolling 30d** (gráfico).

### Value at Risk (VaR)
- [x] **VaR** — pérdida máxima esperada en un mes malo.
- [ ] **VaR 95% y 99%** explícitos.
- [ ] **CVaR / Expected Shortfall** (promedio de las peores pérdidas).
- [ ] Indicar método usado (histórico vs. paramétrico).

### Drawdown
- [x] **Máximo drawdown histórico** (peor caída pico→valle).
- [ ] **Drawdown actual** (caída desde el máximo histórico).
- [ ] **Duración del drawdown** (días en caída / recuperación).
- [ ] **Curva de running maximum** vs. valor actual.

### Simulación de escenarios (stress test)
- [x] **Escenario −20%**.
- [x] **Escenario −40%**.
- [x] **Escenario −70%**.
- [x] **Tabla**: valor actual → valor bajo escenario → % de pérdida.
- [ ] **Alerta** si un escenario supera la tolerancia de riesgo configurada.

### Correlación y diversificación
- [x] **Correlación entre activos**.
- [ ] **Heatmap visual** de la matriz de correlación.
- [ ] **Índice de diversificación** (Herfindahl-Hirschman).
- [ ] **Sugerencia de activos no correlacionados** (< 0,3).

### Asset allocation (opcional)
- [ ] **Asignación actual** vs. **target** del perfil.
- [ ] **Rebalanceo sugerido** si la desviación supera el 5%.
- [ ] **Exposición por sector** (si el ticker tiene industria asignada).

---

## 🧾 Pestaña MOVIMIENTOS

Todas tus operaciones, filtrables y exportables.

### Tabla de operaciones
- [x] Columnas: **Fecha | Tipo | Ticker | Cantidad | Precio | Monto | Moneda**.
- [x] **Todas las filas** (compra, venta, dividendo, comisión, depósito, retiro).
- [x] **Etiqueta original del broker** preservada (`rawRow.tipoOperacion`).
- [ ] Columna **P&L realizado** por operación de venta.
- [ ] **Orden configurable** (más reciente arriba / cronológico).

### Filtros
- [x] **Por tipo de operación** (compra, venta, dividendo, etc.).
- [ ] **Por ticker** (multiselect o texto libre).
- [ ] **Por rango de fechas** (desde–hasta).
- [ ] **Por moneda** (ARS, USD…).
- [ ] **Búsqueda de texto libre** (ticker, tipo, broker).

### Visualizaciones (opcional)
- [ ] **Inversión acumulada** por fecha.
- [ ] **Dividendos / comisiones acumuladas** por mes.

### Exportación
- [x] **Descargar CSV** de los datos (respetando filtros).
- [ ] **Encoding UTF-8 con BOM** para abrir bien en Excel/Windows.
- [ ] **Nombre de archivo** con fecha: `movimientos_YYYY-MM-DD.csv`.

### Edición / corrección (recomendado)
- [ ] **Editar fila** (corregir datos mal parseados de un import manual).
- [ ] **Eliminar fila** con confirmación.
- [ ] **Excluir de posiciones** marcas tipo MEP/FCI (hoy es automático por regex).

---

## 🤖 Pestaña ASISTENTE IA

Chat en lenguaje natural sobre tu cartera, con datos reales.

### Interfaz de chat
- [x] **Panel de chat** con entrada de texto y envío.
- [x] **Historial** diferenciando usuario y asistente.
- [x] **Preguntas pre-armadas** (atajos para arrancar).
- [ ] **Indicador "escribiendo…"** mientras espera respuesta.
- [ ] **Timestamp** por mensaje.

### Contexto automático (lo que "ve" el asistente)
- [x] Todas las **transacciones** del usuario.
- [x] **Tenencias actuales** y P&L.
- [x] **Precios** vigentes.
- [x] **Benchmarks** (dólar, inflación, S&P 500, Bitcoin, acciones AR).
- [ ] **Métricas de riesgo** (VaR, volatilidad, correlaciones) en el contexto.

### System prompt (reglas de respuesta)
- [x] **Responder solo con datos reales** de la cartera; no inventar.
- [x] Si falta información: decir explícitamente que **no hay esos datos**.
- [x] Respuestas en **español**, con números cuando corresponda.

### Capacidades (preguntas que debe responder)
- [x] **Análisis de posición** ("¿cuánto gané en GGAL?").
- [x] **Comparativas** ("¿qué activo rindió mejor?").
- [x] **Benchmarks** ("¿le gané al dólar?").
- [ ] **Riesgo** ("¿cuál es mi VaR?", "¿qué pasa si cae 30%?").
- [ ] **Búsqueda histórica** ("¿cuál fue mi peor operación?").

### Robustez y errores
- [x] **Reintento automático** ante sobrecarga de Gemini (503/429) con backoff.
- [x] **Mensaje amigable** cuando el modelo está saturado.
- [x] **Proxy compartido** por defecto (sin pedir clave); clave personal opcional.
- [ ] **Estado sin datos**: invitar a cargar un archivo antes de preguntar.
- [ ] **Rate limiting** por sesión (evitar abuso del proxy).

### Calidad de presentación (recomendado)
- [ ] **Render de Markdown** en las respuestas (negrita, listas, código).
- [ ] **Copiar respuesta** al portapapeles.
- [ ] **Nueva conversación** (limpiar historial).
- [ ] **Feedback 👍/👎** por respuesta.

---

## 🔒 Seguridad y privacidad (transversal)

- [x] **RLS en Supabase**: cada usuario solo ve sus datos.
- [x] **Cifrado en tránsito** (HTTPS).
- [x] A las fuentes de precios **solo se les pide el ticker**, nunca montos.
- [x] **Clave de Gemini** detrás del proxy (no expuesta en el cliente).
- [ ] **Revisar políticas RLS** antes de integrar datos sensibles a otra app.
- [ ] **Rotar la clave de Gemini** tras cualquier migración/handoff.

---

## ✅ Checklist de implementación transversal

- [ ] **Responsive** en las 5 pestañas.
- [ ] **Tooltips** en métricas financieras.
- [ ] **Exportación** (CSV/PDF) donde aplique.
- [ ] **Caching** de cálculos pesados (TIR, VaR) durante la sesión.
- [ ] **Accesibilidad**: ARIA labels, contraste, navegación por teclado.
- [ ] **Tests unitarios** de los cálculos financieros (TIR, correlación, VaR).
- [ ] **Performance**: carga < 3 s en 4G.

---

### Leyenda
- `[x]` Ya implementado en la app actual.
- `[ ]` Pendiente / mejora propuesta.

> Nota: el estado `[x]/[ ]` es una estimación basada en la arquitectura conocida.
> Conviene validar cada ítem contra el código antes de darlo por cerrado.
