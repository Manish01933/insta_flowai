import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from './api';

/**
 * OPS video library (owner-only).
 *
 * The owner records help/setup videos and keeps their links here. One "Copy"
 * press grabs the link (ready to paste straight into a customer's WhatsApp
 * chat), a row's "WhatsApp link" opens wa.me with the video link pre-filled.
 * Added links outlive restarts (server-side JSON); removing one removes it
 * everywhere at once.
 */

interface VideoEntry {
  id: string;
  label: string;
  url: string;
  addedAt: string;
}

export default function OpsVideosPanel() {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/owner/videos');
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) setVideos(data.videos as VideoEntry[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (entry: VideoEntry) => {
    try {
      await navigator.clipboard.writeText(entry.url);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard can fail without https/user gesture — the link stays visible to copy manually.
    }
  };

  const add = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/owner/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(String(data?.error || `Save failed (${res.status})`));
        return;
      }
      setLabel('');
      setUrl('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/owner/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  const waHref = (entry: VideoEntry) =>
    `https://wa.me/?text=${encodeURIComponent(`Video: ${entry.label}\n${entry.url}`)}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">
          Video library — customer ko bhejne wale setup / demo videos
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Naam (e.g. 'KB bharne ka tarika')"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-56"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… video link"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {error && <p className="mb-2 text-[11px] font-semibold text-rose-700">{error}</p>}

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : videos.length === 0 ? (
        <p className="text-xs text-slate-400">Abhi koi video nahi. Upar form se link add karo — copy karke WhatsApp par bhejoge.</p>
      ) : (
        <div className="space-y-1.5">
          {videos.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-purple-600" />
              <span className="text-xs font-semibold text-slate-800">{entry.label}</span>
              <span className="min-w-[120px] flex-1 truncate text-[11px] text-slate-500">{entry.url}</span>
              <button
                type="button"
                onClick={() => void copy(entry)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {copiedId === entry.id ? <Check className="h-3 w-3 text-emerald-600" /> : null}
                {copiedId === entry.id ? 'Copied' : 'Copy'}
              </button>
              <a
                href={waHref(entry)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <ExternalLink className="h-3 w-3" /> WhatsApp
              </a>
              <button
                type="button"
                onClick={() => void remove(entry.id)}
                disabled={busy}
                className="rounded-md border border-rose-200 bg-white p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
