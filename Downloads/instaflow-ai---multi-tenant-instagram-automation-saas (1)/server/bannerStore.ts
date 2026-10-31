import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * The public banner the owner publishes on the main page.
 *
 * The owner designs offers/discounts as an image in the Ops console (any size —
 * the image keeps its own proportions), tags it Portrait or Landscape, saves it,
 * and every visitor of the public main page then sees it. Deleting it hides it
 * everywhere at once.
 *
 * Storage is a single JSON record with the image inlined as a data URL: one
 * active banner keeps the code trivial and the save atomic (temp + rename, the
 * same pattern as the other stores). The 4 MB base64 cap keeps banner images
 * reasonable on the wire—it is the browser, not the store, that resizes for
 * display.
 */
export type BannerMode = 'portrait' | 'landscape';

export interface SavedBanner {
  id: string;
  /** data:image/<type>;base64,... — the image exactly as the owner uploaded it. */
  dataUrl: string;
  mode: BannerMode;
  /** Original file name from the upload, shown back in the manager only. */
  filename: string;
  updatedAt: string;
}

interface BannerFile {
  version: 1;
  banner: SavedBanner | null;
}

const FILE = path.join(DATA_DIR, 'banner.json');
/** ~3 MB binary after base64 decoding headroom; keeps the JSON file small. */
const MAX_DATA_URL_CHARS = 4 * 1024 * 1024;

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

let state: BannerFile | null = null;

function load(): BannerFile {
  if (state) return state;
  state = { version: 1, banner: null };
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = { version: 1, banner: parsed?.banner ?? null };
    }
  } catch (err) {
    console.warn('[bannerStore] could not load previous banner (starting empty):', (err as Error).message);
  }
  return state;
}

function persist(next: BannerFile): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[bannerStore] persist failed:', (err as Error).message);
    throw err;
  }
}

/** What the public main page needs — image + mode + when it changed. */
export function getPublicBanner(): { dataUrl: string; mode: BannerMode; updatedAt: string } | null {
  const cur = load().banner;
  if (!cur || !cur.dataUrl) return null;
  return { dataUrl: cur.dataUrl, mode: cur.mode, updatedAt: cur.updatedAt };
}

export interface SaveBannerInput {
  dataUrl: string;
  mode: BannerMode;
  filename: string;
}

export class BannerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BannerInputError';
  }
}

/** Save a new banner (replaces the previous one) and return the stored record. */
export function saveBanner(input: SaveBannerInput): SavedBanner {
  const dataUrl = String(input.dataUrl || '').trim();
  const mode: BannerMode = input.mode === 'portrait' ? 'portrait' : 'landscape';

  if (!dataUrl.startsWith('data:image/') || !dataUrl.includes(';base64,')) {
    throw new BannerInputError('The banner must be an image (PNG/JPEG/WebP/GIF).');
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new BannerInputError('The banner image is too large — keep it under about 3 MB.');
  }
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  if (!ALLOWED_TYPES.includes(mime)) {
    throw new BannerInputError('The banner must be a PNG, JPEG, WebP or GIF image.');
  }

  const record: SavedBanner = {
    id: `banner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    dataUrl,
    mode,
    filename: String(input.filename || '').slice(0, 120) || 'banner',
    updatedAt: new Date().toISOString(),
  };
  const next = { version: 1 as const, banner: record };
  persist(next);
  state = next;
  console.log(`BANNER_SAVED id=${record.id} mode=${record.mode} bytes=${Math.round(dataUrl.length * 0.75)}`);
  return record;
}

/** Remove the banner — it disappears from the public page immediately. */
export function deleteBanner(): boolean {
  const cur = load().banner;
  if (!cur) return false;
  const next: BannerFile = { version: 1, banner: null };
  persist(next);
  state = next;
  console.log('BANNER_DELETED');
  return true;
}

/** Owner manager read-back (includes filename). */
export function getOwnerBanner(): SavedBanner | null {
  return load().banner;
}
