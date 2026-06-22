import { useMemo, useState } from 'react';
import type { ParseResult, TransactionType } from '../../src/lib/csv/types';
import {
  type ColumnMapping,
  type GridData,
  buildFromMapping,
  distinctValues,
  guessMapping,
  guessType,
} from './genericImport';

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean; help: string }[] = [
  { key: 'date', label: 'Fecha', required: true, help: 'Cuándo ocurrió el movimiento' },
  { key: 'type', label: 'Tipo de operación', required: true, help: 'Compra, venta, dividendo…' },
  { key: 'amount', label: 'Monto / Importe', required: true, help: 'El total de la operación' },
  { key: 'ticker', label: 'Ticker / Especie', required: false, help: 'Ej. GGAL, AAPL (vacío en depósitos)' },
  { key: 'quantity', label: 'Cantidad', required: false, help: 'Nominales / unidades' },
  { key: 'price', label: 'Precio', required: false, help: 'Precio unitario' },
  { key: 'currency', label: 'Moneda', required: false, help: 'ARS / USD (si no la mapeás, se usa la de abajo)' },
];

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'buy', label: 'Compra' },
  { value: 'sell', label: 'Venta' },
  { value: 'dividend', label: 'Dividendo / Renta' },
  { value: 'deposit', label: 'Ingreso de dinero' },
  { value: 'withdrawal', label: 'Egreso de dinero' },
  { value: 'fee', label: 'Comisión / Impuesto' },
];

interface Props {
  grid: GridData;
  fileName: string;
  onConfirm: (result: ParseResult) => void;
  onCancel: () => void;
}

export function ColumnMapper({ grid, fileName, onConfirm, onCancel }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => guessMapping(grid.headers));

  // Distinct labels in the chosen "type" column, each assigned to one of our
  // types (defaulting to the fuzzy guess) so the user can fix any we got wrong.
  const typeValues = useMemo(() => distinctValues(grid, mapping.type), [grid, mapping.type]);
  const [typeMap, setTypeMap] = useState<Record<string, TransactionType>>({});

  // Effective type map: explicit user choices over fuzzy guesses.
  const effectiveTypeMap = useMemo(() => {
    const out: Record<string, TransactionType> = {};
    for (const v of typeValues) out[v] = typeMap[v] ?? guessType(v) ?? 'buy';
    return out;
  }, [typeValues, typeMap]);

  const preview = useMemo(
    () => buildFromMapping(grid, { ...mapping, typeMap: effectiveTypeMap }),
    [grid, mapping, effectiveTypeMap],
  );

  const missingRequired = FIELDS.filter((f) => f.required && (mapping[f.key] as number) < 0).map(
    (f) => f.label,
  );
  const canImport = missingRequired.length === 0 && preview.transactions.length > 0;

  function setField(key: keyof ColumnMapping, value: number) {
    setMapping((m) => ({ ...m, [key]: value }));
  }

  return (
    <div className="modalOverlay" onClick={onCancel}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <button className="modalClose" onClick={onCancel} aria-label="Cerrar">
          ✕
        </button>

        <h1>🧩 Asociá las columnas de tu archivo</h1>
        <p className="subtitle">
          No reconocimos automáticamente el formato de <strong>{fileName}</strong>. Decinos qué
          columna de tu archivo corresponde a cada dato y lo importamos igual. Sirve para Macro
          Securities, Balanz, IOL o cualquier otro broker.
        </p>

        <div className="mapGrid">
          {FIELDS.map((f) => (
            <label key={f.key} className="mapRow">
              <span className="mapLabel">
                {f.label}
                {f.required && <span className="req"> *</span>}
                <small>{f.help}</small>
              </span>
              <select
                value={mapping[f.key] as number}
                onChange={(e) => setField(f.key, Number(e.target.value))}
              >
                <option value={-1}>{f.required ? '— Elegir columna —' : '— (ninguna) —'}</option>
                {grid.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Columna ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="mapOptions">
          <label>
            Separador decimal
            <select
              value={mapping.decimal}
              onChange={(e) => setMapping((m) => ({ ...m, decimal: e.target.value as 'comma' | 'dot' }))}
            >
              <option value="comma">Argentino — 1.234,56</option>
              <option value="dot">Inglés — 1,234.56</option>
            </select>
          </label>
          <label>
            Moneda por defecto
            <select
              value={mapping.defaultCurrency}
              onChange={(e) => setMapping((m) => ({ ...m, defaultCurrency: e.target.value as 'ARS' | 'USD' }))}
            >
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </label>
        </div>

        {typeValues.length > 0 && (
          <div className="typeMap">
            <h2 className="tutH">Tipos de operación encontrados</h2>
            <p className="hint">
              Revisá que cada operación de tu archivo quede en la categoría correcta.
            </p>
            {typeValues.map((v) => (
              <label key={v} className="mapRow">
                <span className="mapLabel">{v}</span>
                <select
                  value={effectiveTypeMap[v]}
                  onChange={(e) => setTypeMap((t) => ({ ...t, [v]: e.target.value as TransactionType }))}
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        <div className="mapPreview">
          <h2 className="tutH">Vista previa</h2>
          <table>
            <thead>
              <tr>
                {grid.headers.map((h, i) => (
                  <th key={i}>{h || `Col ${i + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.slice(0, 5).map((row, ri) => (
                <tr key={ri}>
                  {grid.headers.map((_, ci) => (
                    <td key={ci}>{row[ci] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {grid.rows.length > 5 && <p className="hint">…y {grid.rows.length - 5} fila(s) más.</p>}
        </div>

        <p className="message">
          Se importarán <strong>{preview.transactions.length}</strong> movimiento(s).
          {preview.errors.length > 0 && ` ${preview.errors.length} fila(s) se omitirán por datos inválidos.`}
        </p>
        {missingRequired.length > 0 && (
          <p className="hint">Falta asignar: {missingRequired.join(', ')}.</p>
        )}

        <div className="importRow">
          <button
            className="fileBtn"
            disabled={!canImport}
            onClick={() => onConfirm({ ...preview })}
          >
            Importar {preview.transactions.length} movimiento(s)
          </button>
          <button className="ghostBtn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
