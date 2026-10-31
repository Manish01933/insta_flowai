import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * The owner's help-video library (Step 6 demo walkthroughs).
 *
 * Every entry is a link the owner recorded or uploaded — hosted on their own
 * InstaFlow pages or anywhere public. The Ops console lists them; every stale
 * `guide.step{n}' … copy into WhatsApp` flow reads the freshest link from here,
 * so a video never has to be re-pasted into ten places.
 *
 * Kept simple on purpose: an ordered list with the newest at the top, persisted
 * to a single JSON file with the same temp + rename pattern the other stores
 * use. Plain HTTP(S) URLs only; whatever is typed is stored verbatim.
 */
export interface VideoEntry {
  id: string;
  label: string;
  url: string;
  addedAt: string;
}

interface VideoFile {
  version: 1;
  videos: VideoEntry[];
}

const FILE = path.join(DATA_DIR, 'video-library.json');
const MAX_VIDEOS = 50;
const URL_RE = /^https?:\/\/\S+$/i;

let state: VideoFile | null = null;

function load(): VideoFile {
  if (state) return state;
  state = { version: 1, videos: [] };
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = { version: 1, videos: (Array.isArray(parsed?.videos) ? parsed.videos : []).slice(0, MAX_VIDEOS) };
    }
  } catch (err) {
    console.warn('[videoLibrary] could not load previous videos (starting empty):', (err as Error).message);
  }
  return state;
}

function persist(next: VideoFile): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[videoLibrary] persist failed:', (err as Error).message);
    throw err;
  }
}

/** Newest first — the owner just added the setup video? It shows on top. */
export function listVideos(): VideoEntry[] {
  return [...load().videos].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export class VideoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoInputError';
  }
}

export function addVideo(label: string, url: string): VideoEntry {
  const cleanUrl = String(url || '').trim();
  if (!URL_RE.test(cleanUrl)) throw new VideoInputError('Enter a full video link (https://…).');
  const cleanLabel = String(label || '').trim().slice(0, 80) || 'Video';

  const entry: VideoEntry = {
    id: `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: cleanLabel,
    url: cleanUrl,
    addedAt: new Date().toISOString(),
  };
  const videos = [entry, ...load().videos].slice(0, MAX_VIDEOS);
  const next = { version: 1 as const, videos };
  persist(next);
  state = next;
  return entry;
}

export function deleteVideo(id: string): boolean {
  const videos = load().videos;
  const idx = videos.findIndex((v) => v.id === id);
  if (idx === -1) return false;
  videos.splice(idx, 1);
  const next = { version: 1 as const, videos };
  persist(next);
  state = next;
  return true;
}
