import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from './api';
import { useI18n } from './i18n';

/**
 * Stale-build banner, shared by the customer dashboard and the owner Ops Console.
 *
 * A tab opened before a deploy keeps running the JavaScript it loaded then,
 * however many times the server is redeployed underneath it. That is how a fixed
 * bug appears to "come back": the person is looking at a version of the app that
 * no longer exists. The shell is served with the build id it was built from, so
 * comparing it against the server's current id tells us the tab is stale — and
 * the answer is a reload, not another hour of debugging.
 *
 * It lives outside App.tsx because the owner console is a separate bundle: this
 * is the one piece of dashboard UI the owner-only app also needs, and importing
 * App.tsx into it would drag the whole customer app along.
 */
function useStaleBuild(): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const loaded = (window as any).__BUILD_ID__ as string | undefined;
    // Dev server, or a shell that somehow lost the stamp: nothing to compare.
    if (!loaded) return;

    const check = async () => {
      try {
        const res = await apiFetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.buildId && data.buildId !== loaded) setStale(true);
      } catch {
        // Offline, or the server is mid-restart. Leave the tab as it is.
      }
    };

    const timer = setInterval(() => { void check(); }, 60_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);

  return stale;
}

// Rendered by both the auth gate and the dashboard: a tab that is out of date is
// out of date wherever it happens to be sitting, and the person watching it is
// usually the one who just deployed.
export function StaleBuildBanner() {
  const { t } = useI18n();
  if (!useStaleBuild()) return null;
  return (
    <div className="bg-amber-500 text-white text-xs font-semibold px-6 py-2.5 flex flex-wrap items-center justify-center gap-3">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{t('stale.text')}</span>
      <button
        onClick={() => window.location.reload()}
        className="bg-white text-amber-700 px-3 py-1 rounded-lg font-bold hover:bg-amber-50 transition"
      >
        {t('stale.reload')}
      </button>
    </div>
  );
}
