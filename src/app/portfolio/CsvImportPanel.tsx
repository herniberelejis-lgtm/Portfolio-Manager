'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './portfolio.module.css';

type BrokerAccount = {
  id: string;
  broker: string;
  label: string;
};

type ImportResult = {
  imported: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function CsvImportPanel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [newBroker, setNewBroker] = useState('cocos');
  const [newLabel, setNewLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/broker-accounts')
      .then((res) => res.json())
      .then((body) => {
        setAccounts(body.accounts ?? []);
        if (body.accounts?.length > 0) setSelectedAccountId(body.accounts[0].id);
        else setIsCreatingAccount(true);
      });
  }, []);

  async function handleCreateAccount(): Promise<string | null> {
    const res = await fetch('/api/broker-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broker: newBroker, label: newLabel || newBroker }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'No se pudo crear la cuenta');
      return null;
    }
    const body = await res.json();
    setAccounts((prev) => [...prev, body.account]);
    setIsCreatingAccount(false);
    return body.account.id as string;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);

    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setError('Elegí uno o más archivos CSV/Excel');
      return;
    }

    setIsSubmitting(true);

    let brokerAccountId = selectedAccountId;
    if (isCreatingAccount) {
      const createdId = await handleCreateAccount();
      if (!createdId) {
        setIsSubmitting(false);
        return;
      }
      brokerAccountId = createdId;
    }

    const aggregated: ImportResult = { imported: 0, skippedDuplicates: 0, errors: [] };
    let firstErrorMessage = '';

    for (const file of Array.from(files)) {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
      const payload = isXlsx
        ? { brokerAccountId, xlsxBase64: await fileToBase64(file) }
        : { brokerAccountId, csvContent: await file.text() };

      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json();
        firstErrorMessage = firstErrorMessage || `${file.name}: ${body.error ?? 'Error al importar'}`;
        continue;
      }

      const body: ImportResult = await res.json();
      aggregated.imported += body.imported;
      aggregated.skippedDuplicates += body.skippedDuplicates;
      aggregated.errors.push(...body.errors);
    }

    setIsSubmitting(false);

    if (firstErrorMessage) {
      setError(firstErrorMessage);
    }
    setResult(aggregated);
    if (fileInputRef.current) fileInputRef.current.value = '';
    router.refresh();
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Importar transacciones</h2>
      <form className={styles.importForm} onSubmit={handleSubmit}>
        {isCreatingAccount ? (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="broker">Broker</label>
              <select
                id="broker"
                className={styles.select}
                value={newBroker}
                onChange={(e) => setNewBroker(e.target.value)}
              >
                <option value="cocos">Cocos Capital</option>
                <option value="bullmarket">Bull Market</option>
                <option value="ppi">PPI</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="label">Nombre de la cuenta</label>
              <input
                id="label"
                className={styles.input}
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ej: Cuenta principal"
              />
            </div>
            {accounts.length > 0 && (
              <button
                type="button"
                className={styles.newAccountToggle}
                onClick={() => setIsCreatingAccount(false)}
              >
                Usar cuenta existente
              </button>
            )}
          </>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="account">Cuenta</label>
              <select
                id="account"
                className={styles.select}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label} ({a.broker})</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={styles.newAccountToggle}
              onClick={() => setIsCreatingAccount(true)}
            >
              + Nueva cuenta
            </button>
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="file">Archivos CSV o Excel (podés elegir varios)</label>
          <input id="file" className={styles.fileInput} type="file" accept=".csv,.xlsx" multiple ref={fileInputRef} />
        </div>

        <button className={styles.submit} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Importando...' : 'Importar'}
        </button>
      </form>

      {error && <p className={`${styles.message} ${styles.messageError}`} role="alert">{error}</p>}
      {result && (
        <p className={`${styles.message} ${styles.messageSuccess}`}>
          {result.imported} transacciones importadas
          {result.skippedDuplicates > 0 && `, ${result.skippedDuplicates} duplicadas omitidas`}
          {result.errors.length > 0 && `, ${result.errors.length} filas con errores`}
        </p>
      )}
    </div>
  );
}
