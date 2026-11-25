import { cutPortraits } from './portraits.js';

// Reads champion kits from the game's own bundle.game_data, picked by the user from
// their install. Nothing from the game is shipped with this site; what is read stays in
// this browser (IndexedDB) so it only has to be picked once per game update.
//
// Bundle layout: u32 entry count, then per entry three length-prefixed fields
// (u32 length + bytes): type, path, content. Little endian, content stored plain.

const WANT = {
  sheet: 'champion_info_sheet asset/base/setting/champion_info',
  text: 'i18n asset/base/text/champion',
  items: 'item_setting asset/base/setting/item_setting',
};

// Champion sprite sheets (PNG) and their frame lists (JSON) sit next to each other.
const SPRITE = /^asset\/base\/aseprite_resources\/champions\/[^/]+#(sheet|anim)$/;

async function readEntries(file, wanted, onProgress, sprites) {
  const keys = new Set(Object.values(wanted));
  const found = {};
  const dec = new TextDecoder();
  const u32 = async (pos) => new DataView(await file.slice(pos, pos + 4).arrayBuffer()).getUint32(0, true);
  const count = await u32(0);
  if (!count || count > 100000) throw new Error('this does not look like bundle.game_data');
  let pos = 4;
  for (let i = 0; i < count && (keys.size || sprites); i++) {
    // type and path are short, so one read covers both headers
    const head = new DataView(await file.slice(pos, pos + 1024).arrayBuffer());
    const tl = head.getUint32(0, true);
    if (tl > 200) throw new Error('unexpected bundle layout');
    const type = dec.decode(new Uint8Array(head.buffer, 4, tl));
    const pl = head.getUint32(4 + tl, true);
    if (pl > 900) throw new Error('unexpected bundle layout');
    const path = dec.decode(new Uint8Array(head.buffer, 8 + tl, pl));
    const clPos = pos + 8 + tl + pl;
    const cl = head.byteLength >= 12 + tl + pl ? head.getUint32(8 + tl + pl, true) : await u32(clPos);
    const start = clPos + 4;
    const key = type + ' ' + path;
    if (keys.has(key)) { found[key] = await file.slice(start, start + cl).text(); keys.delete(key); }
    else if (sprites && SPRITE.test(path)) sprites[path] = file.slice(start, start + cl); // a lazy slice, read only if used
    pos = start + cl;
    if (onProgress && i % 100 === 0) onProgress(pos / file.size);
  }
  if (keys.size) throw new Error('champion data not found in this file');
  const out = {};
  for (const [k, v] of Object.entries(wanted)) out[k] = found[v];
  return out;
}

// Drop what is only for drawing or sound; keep every number that affects play.
const NOISE = /(Sfx|Vfx|Sound|Effect$|Animation|Camera|Shake|Particle)/;
const DROP = new Set(['sprite', 'name', 'patch_type_name', 'y_offset', 'x_offset', 'z_offset', 'sfx', 'vfx', 'sound', 'animation', 'anim', 'view_effects', 'view_projectiles', 'view_buffs', 'skill_icon']);
function clean(x) {
  if (Array.isArray(x)) return x.map(clean).filter((v) => v != null);
  if (x && typeof x === 'object') {
    if (typeof x.type === 'string' && NOISE.test(x.type) && x.type !== 'RangeEffect') return null;
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (DROP.has(k)) continue;
      const c = clean(v);
      if (c == null || (Array.isArray(c) && !c.length) || (typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) continue;
      o[k] = c;
    }
    const ks = Object.keys(o);
    if (!ks.length || (ks.length === 1 && ks[0] === 'casting_type')) return null;
    return o;
  }
  return x;
}
// The game's colour tags become short words: [phys]…[/], [magic]…[/] and so on.
const COL = { ff9028ff: 'phys', a974ffff: 'magic', ef5350ff: 'cc', e8d44dff: 'shield', '6aff55ff': 'hp', ceff99ff: 'aspd', ffb900ff: 'num', ff86c2ff: 'range', ffdd8eff: 'armor', '88ccffff': 'mr', ffffffff: 'speed', f5f5f5ff: 'num' };
const tags = (s) => s.replace(/<i#[^>]*>/g, '').replace(/<#(\w{8})>(.*?)<>/g, (_, c, t) => `[${COL[c] || 'em'}]${t}[/]`).replace(/<[^>]*>/g, '');

export function buildKits(sheetText, textText) {
  const parse = (t) => JSON.parse(t.replace(/^\uFEFF/, ''));
  const sheet = parse(sheetText); const en = parse(textText).en;
  const champs = {};
  for (const [k, v] of Object.entries(sheet)) if (k !== 'mod_champions') champs[k] = v;
  for (const m of sheet.mod_champions || []) champs[m.id] = m;
  const STD = new Set(['id', 'attaca', 'sprite', 'stat', 'growth', 'attack', 'skill', 'skill2', 'ult', 'category', 'tags']);
  const nz = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v));
  const out = {};
  for (const [id, c] of Object.entries(champs)) {
    const desc = en.description?.[id] || {}; const names = en.skill_name?.[id] || {};
    const k = {
      name: desc.name || id, cat: c.category, tags: c.tags || [], stat: nz(c.stat), growth: nz(c.growth),
      attack: clean(c.attack || c.attaca || {}), // one champion's attack key is spelled "attaca"
      skill: c.skill && typeof c.skill === 'object' ? clean(c.skill) : null,
      skill2: clean(c.skill2 || {}), ult: clean(c.ult || {}),
      names: { skill: names.skill1, skill2: names.skill2, ult: names.ult },
      text: Object.fromEntries(Object.entries(desc).filter(([a]) => a !== 'name').map(([a, b]) => [a, tags(b)])),
    };
    const extra = {};
    for (const [a, b] of Object.entries(c)) if (!STD.has(a)) { const v = clean(b); if (v != null && !(typeof v === 'object' && !Object.keys(v).length)) extra[a] = v; }
    // some champions keep their first ability under another key (skill1, heal_skill)
    if (!k.skill) for (const a of ['skill1', 'heal_skill']) if (extra[a]) { k.skill = extra[a]; delete extra[a]; break; }
    if (Object.keys(extra).length) k.passive = extra;
    out[id] = k;
  }
  return out;
}

// Item lines in the order builds store them (slot value = line * 5 + tier), with each
// tier's stats (only the numbers that are set).
const LINE_CATS = ['AD', 'AttackSpeed', 'Defense', 'MagicResistance', 'Magic', 'Hp'];
export function buildItems(itemText) {
  const d = JSON.parse(itemText.replace(/^\uFEFF/, ''));
  const lines = LINE_CATS.map((cat) => ({ cat, tiers: [] }));
  for (const v of Object.values(d)) {
    if (!v || typeof v !== 'object' || !v.stat) continue;
    const li = LINE_CATS.indexOf(v.category); if (li < 0 || !(v.tier >= 0 && v.tier < 5)) continue;
    lines[li].tiers[v.tier] = Object.fromEntries(Object.entries(v.stat).filter(([, x]) => typeof x === 'number' && x));
  }
  return lines;
}

// Which sprite each champion uses: mod champions name it, base ones use their id.
function spritePaths(sheetText) {
  const sheet = JSON.parse(sheetText.replace(/^\uFEFF/, ''));
  const out = {};
  for (const [k, v] of Object.entries(sheet)) if (k !== 'mod_champions' && v && typeof v === 'object') out[k] = v.sprite || 'asset/base/aseprite_resources/champions/' + k;
  for (const m of sheet.mod_champions || []) if (m?.id) out[m.id] = m.sprite || 'asset/base/aseprite_resources/champions/' + m.id;
  return out;
}

export async function readGameFile(file, onProgress) {
  const sprites = {};
  const e = await readEntries(file, WANT, (f) => onProgress?.(f * 0.9), sprites);
  const sources = {};
  for (const [id, base] of Object.entries(spritePaths(e.sheet))) {
    const sheet = sprites[base + '#sheet'], anim = sprites[base + '#anim'];
    if (sheet && anim) sources[id] = { sheet: new Blob([sheet], { type: 'image/png' }), anim: await anim.text() };
  }
  let portraits = {};
  try { portraits = await cutPortraits(sources, (f) => onProgress?.(0.9 + f * 0.1)); } catch (err) { console.warn('Could not cut champion pictures', err); }
  return { kits: buildKits(e.sheet, e.text), items: buildItems(e.items), portraits, size: file.size, modified: file.lastModified, readAt: Date.now() };
}
