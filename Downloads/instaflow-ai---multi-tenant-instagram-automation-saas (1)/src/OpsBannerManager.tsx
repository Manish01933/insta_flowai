import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Minus, Save, Trash2 } from 'lucide-react';
import { apiFetch } from './api';

/**
 * OPS banner manager (owner-only "window").
 *
 * The owner designs offers/discounts as ONE image — any size, keeping its own
 * proportions — marks it Portrait or Landscape, previews it live in this
 * window, and saves it. Saving publishes the banner on the public main page
 * (`GET /api/banner` serves it to everyone) and MINIMIZES this window — the
 * save is the whole workflow, so the console goes back to a slim bar with a
 * "saved ✓ / show again" button. Delete removes the banner from the public
 * page immediately.
 */

interface SavedBanner {
  dataUrl: string;
  mode: 'portrait' | 'landscape';
  filename: string;
  updatedAt: string;
}

const MAX_FILE_BYTES = 3 * 1024 * 1024;

export default function OpsBannerManager() {
  const [minimized, setMinimized] = useState(false);
  const [saved, setSaved] = useState<SavedBanner | null>(null);
  const [file, setFile] = useState<{ dataUrl: string; filename: string } | null>(null);
  const [mode, setMode] = useState<'portrait' | 'landscape'>('landscape');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/banner');
      const data = await res.json().catch(() => null);
      const banner = (data?.banner ?? null) as SavedBanner | null;
      setSaved(banner);
      if (banner) {
        setMode(banner.mode);
        setFile({ dataUrl: banner.dataUrl, filename: banner.filename });
      }
    } catch {
      // The manager still opens; a failed read just starts empty.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickFile = (chosen: File | null) => {
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setNotice({ tone: 'err', text: 'Image is larger than 3 MB — compress it and pick again.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:image/')) {
        setNotice({ tone: 'err', text: 'Only PNG / JPEG / WebP / GIF images work.' });
        return;
      }
      setFile({ dataUrl, filename: chosen.name });
      setNotice(null);
    };
    reader.readAsDataURL(chosen);
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/owner/banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: file.dataUrl, mode, filename: file.filename }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setNotice({ tone: 'err', text: String(data?.error || `Save failed (${res.status})`) });
        return;
      }
      await load();
      setNotice({ tone: 'ok', text: 'Banner saved — it is live on the public main page now.' });
      setMinimized(true); // saving is the whole workflow — the window steps aside
    } catch (err: any) {
      setNotice({ tone: 'err', text: String(err?.message || 'Save failed.') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!file && !saved) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/owner/banner', { method: 'DELETE' });
      if (res.ok) {
        setFile(null);
        setSaved(null);
        setNotice({ tone: 'ok', text: 'Banner removed — the public main page shows nothing there now.' });
      } else {
        setNotice({ tone: 'err', text: `Delete failed (${res.status}).` });
      }
    } finally {
      setBusy(false);
    }
  };

  if (minimized) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2">
        <span className="text-xs font-semibold text-emerald-800">Banner saved ✓ — live on the public main page.</span>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="ml-auto rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          Show banner window again
        </button>
      </div>
    );
  }

  const preview = file?.dataUrl || null;

  return (
    <div className="mb-6 rounded-2xl border border-slate-300 bg-white shadow-md overflow-hidden">
      {/* Window chrome: title bar + minimize */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="text-xs font-bold text-slate-800">Banner manager — public main page</span>
        <span className="text-[10px] text-slate-400">koi bhi size · Portrait / Landscape</span>
        <button
          type="button"
          title="Minimize"
          onClick={() => setMinimized(true)}
          className="ml-auto rounded-md border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {notice && (
          <p className={`text-[11px] font-semibold ${notice.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {notice.text}
          </p>
        )}

        {saved && !file && (
          <p className="text-[11px] text-slate-500">
            Abhi live: {saved.filename} ({saved.mode}, {new Date(saved.updatedAt).toLocaleString()})
          </p>
        )}

        {/* Mode choice */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-600">Show style:</span>
          {(
            [
              ['landscape', 'Landscape mode (poori chaudai)'],
              ['portrait', 'Portrait mode (patli column)'],
            ] as Array<['portrait' | 'landscape', string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-1 text-[11px] font-semibold ${
                mode === value
                  ? 'border-purple-500 bg-purple-50 text-purple-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Live preview — the image keeps its own proportions inside the chosen shape */}
        {preview ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Live preview</p>
            <div className="mx-auto overflow-hidden rounded-lg bg-white shadow-inner" style={{ maxWidth: mode === 'portrait' ? 340 : '100%' }}>
              {/* Same behaviour as the public page: koi bhi size ka image fit ho
                  jata hai — width fill karti hai, height 45vh par rukti hai aur
                  proportion bani rehti hai, isliye bahut lambi image window ko
                  gher nahi leti. */}
              <img
                src={preview}
                alt="Banner preview"
                className="block h-auto w-full max-h-[45vh] object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <p className="text-xs text-slate-500">Koi banner selected nahi hai — neeche se image uthao.</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            <ImagePlus className="h-3.5 w-3.5" />
            Image uthao
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !file}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {busy ? 'Saving…' : 'Save banner'}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy || (!file && !saved)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete banner
          </button>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[11px] font-semibold text-purple-700 hover:text-purple-900"
          >
            Public page kholo ↗
          </a>
        </div>
      </div>
    </div>
  );
}
