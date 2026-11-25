// Champion pictures, cut from the user's own bundle.game_data at runtime (see gamefiles.js).
// Nothing from the game ships with the site. Each champion's first idle frame is cropped
// from its sprite sheet, trimmed to its visible pixels and kept as a small PNG in IndexedDB.
// Without them every view falls back to plain names.

import { esc } from './ui.js';

const urls = {};
export function setPortraits(blobs) {
  for (const u of Object.values(urls)) URL.revokeObjectURL(u);
  for (const k of Object.keys(urls)) delete urls[k];
  for (const [id, b] of Object.entries(blobs || {})) if (b instanceof Blob) urls[id] = URL.createObjectURL(b);
}
export const hasPortraits = () => Object.keys(urls).length > 0;
export const portraitUrl = (id) => urls[id] || null;

// size: 'face' (small square showing the head, for chips and lists), 'full' (whole body),
// 'big' (whole body, larger, for headings).
export function face(id, size = 'face', title = '') {
  const u = urls[id]; if (!u) return '';
  return `<img class="pt pt-${size}" src="${u}" alt="" loading="lazy" decoding="async"${title ? ` title="${esc(title)}"` : ''}>`;
}

// ---- extraction ----
function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const toBlob = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((res) => c.toBlob(res, 'image/png')));

// sheet: Blob of the PNG sprite sheet; anim: the sheet's frame JSON (text).
export async function cutPortrait(sheet, animText) {
  const anims = JSON.parse(animText).anims || {};
  const frames = (anims.idle || anims.run || Object.values(anims)[0])?.frames;
  const d = frames?.[0]?.data; if (!d || !(d.w > 0 && d.h > 0)) return null;
  const bmp = await createImageBitmap(sheet, Math.round(d.x), Math.round(d.y), Math.round(d.w), Math.round(d.h));
  const w = bmp.width, h = bmp.height;
  const c = canvas(w, h); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); bmp.close?.();
  // trim the transparent border so the body fills the frame
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = canvas(tw, th); out.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
  return toBlob(out);
}

export async function cutPortraits(sources, onProgress) {
  const out = {}; const ids = Object.keys(sources); let n = 0;
  for (const id of ids) {
    try { const b = await cutPortrait(sources[id].sheet, sources[id].anim); if (b) out[id] = b; } catch (e) { console.warn('No picture for', id, e); }
    if (onProgress) onProgress(++n / ids.length);
  }
  return out;
}
