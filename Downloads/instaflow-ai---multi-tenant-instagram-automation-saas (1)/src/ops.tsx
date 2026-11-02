import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { ArrowLeft, Copy, Instagram, LogOut, ShieldCheck } from 'lucide-react';
import { auth } from './firebase';
import { apiFetch } from './api';
import { LanguageProvider, LanguageToggle, useI18n } from './i18n';
import { StaleBuildBanner } from './staleBuild';
import { describeAuthError } from './authErrors';
import OpsConsole from './OpsConsole';
import './index.css';

/**
 * Copies the signed-in uid, so a locked-out owner has something they can paste
 * straight into OWNER_TENANT_IDS. A uid is not readable from anywhere in the UI,
 * which is exactly why the console also accepts an email — but if the host only
 * has the uid list, this is the one line they need to add.
 */
function CopyUidButton({ uid }: { uid: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uid);
    } catch {
      // Clipboard is blocked outside a secure context; the uid is on screen anyway.
    }
    setDone(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  };

  return (
    <div className="flex items-center justify-center gap-2 mb-6 -mt-3">
      <code className="text-[11px] text-slate-400 bg-white/5 border border-white/10 rounded-md px-2 py-1 break-all text-left">
        {uid}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 rounded-md px-2 py-1 transition"
      >
        <Copy className="w-3 h-3" />
        {done ? t('opsApp.uidCopied') : t('opsApp.copyUid')}
      </button>
    </div>
  );
}

/**
 * Owner Ops Console — its own app, mounted at `/ops`.
 *
 * Why a separate entry instead of another dashboard tab: the console is the one
 * screen that reads every customer's account at once. Kept inside the customer
 * app it had to ship in the customer's JavaScript, so anyone could read the
 * cross-tenant table out of the bundle and just needed to be told no. Here the
 * console is only ever downloaded by the page at `/ops`, so a customer's browser
 * never receives it at all.
 *
 * Three gates, and only the last one is real:
 *   1. nobody signed in          → the sign-in screen below;
 *   2. signed in but not on       → "not the owner" panel, no console code run;
 *      OWNER_TENANT_IDS
 *   3. `/api/owner/tenants`       → the server checks the *verified* uid again
 *      and answers 403 to anyone else. 1 and 2 exist so the owner gets a clear
 *      message; 3 is what actually protects the data.
 *
 * Sign-in reuses the platform's Firebase project, so the console stays on
 * already-authorised domains and the owner's session carries between `/app` and
 * `/ops` without a second account.
 */

type Access = 'checking' | 'owner' | 'denied' | 'error';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B0B0F] text-slate-100">
      <StaleBuildBanner />
      {children}
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function OpsApp() {
  const { t } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [access, setAccess] = useState<Access>('checking');
  const [accessError, setAccessError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // The server is the authority on who is an owner, so ask it — with the verified
  // token `apiFetch` attaches — rather than trusting anything the browser knows.
  const checkAccess = useCallback(async () => {
    setAccess('checking');
    setAccessError('');
    try {
      const res = await apiFetch('/api/subscription', { cache: 'no-store' });
      const payload = await res.json().catch(() => null);
      // 401 (bad or expired token) and `isOwner: false` both mean "not you" from
      // the owner's point of view, so they get the same answer.
      if (res.status === 401) return setAccess('denied');
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      setAccess(payload?.isOwner ? 'owner' : 'denied');
    } catch (err: any) {
      setAccessError(err?.message || 'unknown error');
      setAccess('error');
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    void checkAccess();
  }, [authReady, user, checkAccess]);

  const handlePasswordSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setAuthError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (err: any) {
      setAuthError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (busy) return;
    setAuthError('');
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setAuthError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // Already signed out, or offline. The listener will catch up either way.
    }
    setAccess('checking');
  };

  if (!authReady) {
    return (
      <CenteredCard>
        <p className="text-center text-slate-300 text-sm">{t('opsApp.checking')}</p>
      </CenteredCard>
    );
  }

  // ── Gate 1: sign in ───────────────────────────────────────────────────────
  // Deliberately no Demo Mode and no sign-up here: this is an operator screen,
  // not a customer front door, and the only accounts that belong on it already
  // exist.
  if (!user) {
    return (
      <Shell>
        <CenteredCard>
          <div className="flex justify-end mb-4">
            <LanguageToggle variant="dark" />
          </div>
          <div className="flex items-center justify-center mb-5">
            <div className="w-14 h-14 bg-gradient-to-tr from-slate-700 to-slate-900 border border-white/10 rounded-2xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-7 h-7 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">{t('opsApp.title')}</h1>
          <p className="text-slate-300 text-center text-sm mb-6">{t('opsApp.subtitle')}</p>

          {authError && (
            <div className="bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs p-3 rounded-xl mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handlePasswordSignIn} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('opsApp.email')}
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@company.com"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('opsApp.password')}
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="••••••••"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-700 text-white font-medium py-2.5 rounded-xl shadow-lg hover:opacity-95 disabled:opacity-60 transition"
            >
              {busy ? t('opsApp.signingIn') : t('opsApp.signIn')}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-2 text-slate-400">{t('opsApp.or')}</span>
            </div>
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            {t('opsApp.google')}
          </button>

          <p className="mt-6 text-center text-[11px] text-slate-500">{t('opsApp.operatorOnly')}</p>
          <div className="mt-4 text-center">
            <a href="/app" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('opsApp.backToApp')}
            </a>
          </div>
        </CenteredCard>
      </Shell>
    );
  }

  // ── Gate 2: signed in, but is this the owner? ─────────────────────────────
  if (access === 'checking') {
    return (
      <Shell>
        <CenteredCard>
          <p className="text-center text-slate-300 text-sm">{t('opsApp.checking')}</p>
        </CenteredCard>
      </Shell>
    );
  }

  if (access === 'denied' || access === 'error') {
    const denied = access === 'denied';
    return (
      <Shell>
        <CenteredCard>
          <div className="flex items-center justify-center mb-5">
            <div className="w-14 h-14 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-rose-400" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white text-center mb-2">
            {denied ? t('opsApp.denied') : t('opsApp.error')}
          </h1>
          <p className="text-slate-300 text-center text-sm mb-6 break-words">
            {denied ? t('opsApp.deniedBody', { email: user.email || user.uid }) : accessError}
          </p>
          {denied && (
            <>
              <p className="text-slate-400 text-center text-xs mb-4 -mt-3">
                {t('opsApp.deniedOwnerHint')}
              </p>
              <CopyUidButton uid={user.uid} />
            </>
          )}
          <div className="flex flex-col gap-3">
            {!denied && (
              <button
                onClick={() => void checkAccess()}
                className="w-full bg-white/10 border border-white/10 hover:bg-white/20 text-white text-sm font-medium py-2.5 rounded-xl transition"
              >
                {t('opsApp.retry')}
              </button>
            )}
            <button
              onClick={() => void handleSignOut()}
              className="w-full bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm font-medium py-2.5 rounded-xl inline-flex items-center justify-center gap-2 transition"
            >
              <LogOut className="w-4 h-4" />
              {t('opsApp.switchAccount')}
            </button>
            <a
              href="/app"
              className="w-full text-center text-xs text-slate-400 hover:text-white py-1 inline-flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('opsApp.backToApp')}
            </a>
          </div>
        </CenteredCard>
      </Shell>
    );
  }

  // ── Gate 3: the console itself, behind the server's own owner check ───────
  return (
    <Shell>
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-slate-700 to-slate-900 border border-white/10 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">{t('opsApp.title')}</p>
              <p className="text-[11px] text-slate-400 leading-tight">{user.email || user.uid}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle variant="dark" />
            <a
              href="/app"
              className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-1.5"
            >
              <Instagram className="w-3.5 h-3.5" />
              {t('opsApp.backToApp')}
            </a>
            <button
              onClick={() => void handleSignOut()}
              className="text-xs bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t('opsApp.signOut')}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-5 py-6">
        <OpsConsole />
      </main>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <OpsApp />
    </LanguageProvider>
  </StrictMode>,
);
