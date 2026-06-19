# Portfolio Tracker — Diseño

Fecha: 2026-06-18

## Objetivo

Aplicación web multi-usuario para seguimiento de inversiones (renta fija y variable) en brokers/exchanges argentinos. Combina la carga de CSV de transacciones del broker con precios de mercado en tiempo real, para mostrar el portafolio consolidado y la ganancia/pérdida neta real (separada de los aportes de capital, es decir de los fondeos/retiros que ya vienen identificados en el propio CSV del broker).

Fuera de alcance: conexión bancaria (Belvo/open banking) y contabilidad de finanzas personales / gastos del día a día. El foco es exclusivamente inversión y portfolio, a partir del CSV del broker.

## Arquitectura

- **Stack**: Next.js (App Router) + TypeScript full-stack, PostgreSQL, NextAuth (credentials provider) para login usuario/clave.
- **Autenticación**: multi-usuario, contraseñas hasheadas con bcrypt, sesión JWT, todas las queries filtradas por `userId`.
- **Parsers de broker**: arquitectura de interfaz (`BrokerParser.parse(file): Transaction[]`) para soportar Cocos Capital y Bull Market al inicio, extensible a otros brokers (IOL, Balanz, etc.) sin tocar el resto del sistema.
- **Datos de mercado**: job periódico (cada 1-5 min en horario de mercado) que consulta una API gratuita tipo data912 (agregador de datos BYMA) para precios de acciones, bonos, CEDEARs y FCI argentinos. Fallback a datos abiertos de CNV cuando data912 no cubre un instrumento (ej. ciertos FCI).
- **Multi-moneda**: cada activo/transacción se registra en su moneda original (ARS/USD); el dashboard consolida usando tipo de cambio (oficial/MEP/CCL) del día, tomado de una API pública, con toggle ARS/USD.

## Modelo de datos

- **User**: cuenta con login.
- **BrokerAccount**: cuenta de broker vinculada a un usuario (tipo: `cocos`, `bullmarket`, ...).
- **Transaction**: modelo unificado de movimientos de broker — `date`, `type` (compra/venta/dividendo/fondeo/retiro/comisión), `asset`, `quantity`, `price`, `currency`, `amount`, `brokerAccountId`, `sourceFileId`, `rawRow` (JSON original para auditoría), `rowHash` (para deduplicar). Los tipos `fondeo`/`retiro` ya vienen identificados en el CSV del broker y se excluyen del cálculo de P&L (son movimiento de capital, no ganancia).
- **Asset**: catálogo de instrumentos — ticker, tipo (acción/CEDEAR/bono/FCI), moneda nativa.
- **PriceSnapshot**: precios de mercado cacheados desde data912/BYMA, con timestamp.
- **ExchangeRate**: tipo de cambio (oficial/MEP/CCL) por fecha.

## Módulos funcionales

1. **Auth**: login usuario/clave, sesión protegida, aislamiento total de datos por usuario.
2. **Importación de CSV de broker**: upload de archivo → detección de broker (por nombre/cabeceras) o selección manual → parser específico normaliza filas a `Transaction` → vista previa con diff antes de confirmar → deduplicación por `rowHash`.
3. **Datos de mercado en tiempo real**: job periódico que actualiza `PriceSnapshot` para todos los `Asset` en portafolios activos. Si la fuente falla, se muestra el último precio válido con indicador de "desactualizado desde...".
4. **Motor de P&L**: costo promedio ponderado por `Asset`/`BrokerAccount`, posición actual, valor de mercado, P&L no realizado y P&L realizado (al vender), excluyendo fondeos/retiros del cálculo de ganancia.
5. **Dashboard/gráficos**: portafolio consolidado (toggle ARS/USD), evolución de valor en el tiempo, breakdown por activo/clase, P&L realizado vs no realizado. Diseño visual cuidado, no genérico (ver estándares de calidad de diseño web del proyecto).

## Manejo de errores

- CSV con formato inesperado: error específico de fila/columna, no rompe el resto del import.
- Duplicados: hash por fila evita reimportar transacciones ya cargadas.
- Falla de data912: se muestra el último `PriceSnapshot` válido con timestamp, nunca un precio vacío.

## Seguridad

- Contraseñas con bcrypt, nunca en texto plano.
- Aislamiento estricto de datos por `userId` en todas las queries.
- Rate limiting y protección CSRF en endpoints de auth y upload.
- Secretos (credenciales de DB, etc.) vía variables de entorno, nunca hardcodeados.

## Testing

- Unit tests de cada parser de broker, usando CSVs de ejemplo reales sanitizados.
- Unit tests del motor de P&L (costo promedio, compra/venta parcial, múltiples lotes).
- E2E del flujo completo: login → subir CSV → ver portfolio → ver P&L.
- Cobertura mínima 80% según estándares del proyecto.
