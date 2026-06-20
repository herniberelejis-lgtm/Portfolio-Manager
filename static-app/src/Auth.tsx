import { useState } from 'react';
import { supabase } from './supabaseClient';

export function Auth() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signup') {
        const { error } = await supabase!.auth.signUp({ email, password });
        if (error) throw error;
        setMessage(
          'Cuenta creada. Si tu proyecto pide confirmación por email, revisá tu correo; ' +
            'si no, ya podés iniciar sesión.',
        );
        setMode('login');
      } else {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // On success, the onAuthStateChange listener in App takes over.
      }
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authWrap">
      <div className="authCard">
        <h1>📊 Portfolio Manager</h1>
        <p className="subtitle">
          {mode === 'login' ? 'Iniciá sesión para ver tu cartera.' : 'Creá tu cuenta.'}
        </p>
        <form onSubmit={submit} className="authForm">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          <button className="fileBtn" type="submit" disabled={busy}>
            {busy ? 'Procesando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>
        {message && <p className="message">{message}</p>}
        <p className="hint authSwitch">
          {mode === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
          <button
            className="linkBtn"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setMessage('');
            }}
          >
            {mode === 'login' ? 'Registrate' : 'Iniciá sesión'}
          </button>
        </p>
        <p className="footer">Tus datos se guardan en tu cuenta y solo vos podés verlos.</p>
      </div>
    </div>
  );
}
