/**
 * Quick behavioural check for the owner banner store + video library (run with
 * an isolated DATA_DIR so it never touches real data):
 *   DATA_DIR=.data-verify npx tsx scripts/banner-video-verify.ts
 */
process.env.DATA_DIR = '.data-verify';

const { saveBanner, getPublicBanner, deleteBanner, getOwnerBanner } = await import('../server/bannerStore');
const { addVideo, listVideos, deleteVideo } = await import('../server/videoLibraryStore');

const pngPixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const fail = (msg: string): never => {
  console.error('FAIL: ' + msg);
  process.exit(1);
};

// ── banner ──────────────────────────────────────────────────────────────────
const saved = saveBanner({ dataUrl: pngPixel, mode: 'portrait', filename: 'offer.png' });
if (getPublicBanner()?.dataUrl !== pngPixel) fail('banner not readable publicly');
if (getOwnerBanner()?.mode !== 'portrait') fail('banner mode lost');

let threw = false;
try {
  saveBanner({ dataUrl: 'not-a-data-url', mode: 'landscape', filename: 'x' });
} catch {
  threw = true;
}
if (!threw) fail('store accepted junk dataUrl');
threw = false;
try {
  saveBanner({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', mode: 'landscape', filename: 'x' });
} catch {
  threw = true;
}
if (!threw) fail('store accepted an SVG (must be png/jpeg/webp/gif)');

const perm = saveBanner({ dataUrl: pngPixel, mode: 'landscape', filename: 'offer-2.png' });
if (getOwnerBanner()?.filename !== 'offer-2.png') fail('save did not replace previous banner');

if (!deleteBanner()) fail('delete returned false');
if (getPublicBanner() !== null) fail('banner still public after delete');
if (deleteBanner()) fail('double delete returned true');

// ── video library ────────────────────────────────────────────────────────────
const v1 = addVideo('KB bharne ka tarika', 'https://instaflow-ai.example/demo/1');
addVideo('Setup walkthrough', 'https://instaflow-ai.example/demo/2');
const list = listVideos();
if (list.length !== 2) fail('expected 2 videos');
if (list[0].id === v1.id || list[0].addedAt < list[1].addedAt) fail('newest video is not first');
threw = false;
try {
  addVideo('bad', 'javascript:alert(1)');
} catch {
  threw = true;
}
if (!threw) fail('store accepted a non-http url');
if (!deleteVideo(v1.id)) fail('video delete returned false');
if (listVideos().length !== 1) fail('video not removed');

console.log('banner-video verify: ALL PASS');
