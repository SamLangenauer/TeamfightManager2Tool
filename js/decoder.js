// Teamfight Manager 2 save decoder (game v0.7.x).
// The save is a small header, a PNG thumbnail and one gzip stream holding the
// game's Database serialized with Rust bincode (fixed u64 ints, no field names).
// Fields are read in struct order where the layout is known, and re-synced on
// validated byte patterns where it is not. Nothing here writes to the save.

const td = new TextDecoder();

export class Reader {
  constructor(buf, pos = 0) {
    this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    this.p = pos;
  }
  u() { const v = this.q(this.p); this.p += 8; return v; }
  q(at) { // u64 as Number (values here stay far below 2^53)
    const lo = this.dv.getUint32(at, true), hi = this.dv.getUint32(at + 4, true);
    return hi * 4294967296 + lo;
  }
  i64(at) { return Number(this.dv.getBigInt64(at, true)); }
  f() { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  byte() { return this.b[this.p++]; }
  s() {
    const n = this.u();
    if (n > 100000) throw new Error(`bad string length ${n} at ${this.p - 8}`);
    const v = td.decode(this.b.subarray(this.p, this.p + n)); this.p += n; return v;
  }
  vec(fn) {
    const n = this.u();
    if (n > 1000000) throw new Error(`bad vec length ${n} at ${this.p - 8}`);
    const out = new Array(n); for (let i = 0; i < n; i++) out[i] = fn(); return out;
  }
  strAt(at, max = 64) { // string at offset if plausible, else null
    if (at + 8 > this.b.length) return null;
    const n = this.q(at); if (n < 1 || n > max || at + 8 + n > this.b.length) return null;
    return td.decode(this.b.subarray(at + 8, at + 8 + n));
  }
}

// Search raw bytes for a byte pattern.
function indexOf(b, pat, from = 0, to = b.length) {
  const first = pat[0], n = pat.length, end = Math.min(to, b.length) - n;
  outer: for (let i = from; i <= end; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < n; j++) if (b[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}
function u64bytes(...vals) {
  const out = new Uint8Array(vals.length * 8), dv = new DataView(out.buffer);
  vals.forEach((v, i) => { dv.setUint32(i * 8, v % 4294967296, true); dv.setUint32(i * 8 + 4, Math.floor(v / 4294967296), true); });
  return out;
}

// ---------- container ----------
export function readContainer(file) {
  const b = new Uint8Array(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (td.decode(b.subarray(0, 4)) !== 'TFM2') throw new Error('Not a Teamfight Manager 2 save (missing TFM2 magic).');
  // preview header: the team name and manager name are short length-prefixed strings (u8 length)
  const strings = [];
  for (let i = 4; i < 0x80 && strings.length < 6; i++) {
    const n = b[i];
    if (n >= 3 && n <= 40 && i + 1 + n <= 0x80) {
      const t = td.decode(b.subarray(i + 1, i + 1 + n));
      if (/^[\x20-\x7e]+$/.test(t)) { strings.push(t); i += n; }
    }
  }
  const pngLen = Number(dv.getBigUint64(0x80, true));
  const png = b.slice(0x88, 0x88 + pngLen);
  let gz = 0x88 + pngLen;
  while (gz < b.length - 3 && !(b[gz] === 0x1f && b[gz + 1] === 0x8b && b[gz + 2] === 0x08)) gz++;
  return { strings, png, gzipOffset: gz };
}

export async function inflate(file, offset) {
  const blob = new Blob([new Uint8Array(file).subarray(offset)]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- body ----------
export function decodeBody(body, champIds, progress = () => {}) {
  const r = new Reader(body);
  const champSet = new Set(champIds);
  const out = { warnings: [] };

  // header: u64, date, time, u64
  r.u(); const date = r.s(); const time = r.s(); r.u();
  out.date = date; out.time = time;

  // leagues (slotmap: slot, version, id, ...)
  out.leagues = r.vec(() => {
    r.u(); r.u(); const id = r.u(); const name = r.s(); const key = r.s();
    const competitions = r.vec(() => r.u()); const region = r.u(); const division = r.u();
    const prize = r.vec(() => r.f()); const fanPool = r.u();
    return { id, name, key: key.split('.').pop(), competitions, region, division, prize, fanPool };
  });
  progress('Leagues', 0.02);

  // teams: find team 0 as (slot 0, version v, id 0, name, logo, league)
  out.teams = decodeTeams(r, body);
  progress('Teams', 0.05);

  // athletes
  out.athletes = decodeAthletes(r, body, champSet, out.teams.endOffset, out.warnings, (f) => progress('Players', 0.05 + f * 0.5));
  delete out.teams.endOffset;

  // games
  out.games = decodeGames(r, body, champSet, out.athletes, out.warnings, (f) => progress('Matches', 0.55 + f * 0.4));
  progress('Done', 1);
  return out;
}

function decodeTeams(r, b) {
  // locate the teams vec: count, then slot 0, version, id 0, a name and a logo string
  let p = r.p, found = -1;
  for (let i = p; i < Math.min(b.length, p + 4000000); i++) {
    if (b[i + 1] !== 0 || b[i + 8] !== 0) continue;
    const count = r.q(i);
    if (count < 2 || count > 2000) continue;
    if (r.q(i + 8) !== 0 || r.q(i + 24) !== 0) continue;
    const ver = r.q(i + 16); if (ver < 1 || ver > 1000) continue;
    const nm = r.strAt(i + 32, 60); if (!nm || !/^[\x20-\x7e]+$/.test(nm)) continue;
    const logo = r.strAt(i + 40 + nm.length, 80); if (!logo || !/^[\w:/.\-]+$/.test(logo)) continue;
    found = i; break;
  }
  if (found < 0) throw new Error('Could not find the team list in this save.');
  const count = r.q(found), ver = r.q(found + 16);
  const teams = [];
  let at = found + 8;
  for (let k = 0; k < count; k++) {
    if (k > 0) {
      const q = indexOf(b, u64bytes(k, ver, k), at + 40, at + 3000000);
      if (q < 0) break;
      at = q;
    }
    const t = new Reader(b, at + 24);
    const name = t.s(); const logo = t.s(); const league = t.u();
    teams.push({ id: k, name, logo, league });
  }
  teams.endOffset = at;
  return teams;
}

// ---- athletes ----
const STAT_KEYS = ['last_hit', 'skill_avoid', 'skill_hit', 'positioning', 'control_speed', 'concentration', 'mental', 'judgement', 'order', 'roaming', 'aggressive', 'ego'];
const HIDDEN_KEYS = ['potential', 'stamina_recovery_min', 'stamina_recovery_max', 'stamina_cost_min', 'stamina_cost_max', 'stress_sensitivity', 'condition_baseline', 'condition_amplitude', 'condition_period', 'condition_phase', 'match_impact_sensitivity'];
export { STAT_KEYS, HIDDEN_KEYS };

function readAthleteStat(r) { // AthleteStat: u64 tag(=1), 12 stats, 5 positions, like, dislike, languages
  const tag = r.u(); if (tag !== 1) throw new Error('stat tag');
  const stat = []; for (let i = 0; i < 12; i++) stat.push(r.u());
  const pos = []; for (let i = 0; i < 5; i++) pos.push(r.u());
  const like = r.vec(() => r.s()); const dislike = r.vec(() => r.s());
  const lang = r.vec(() => [r.u(), r.u()]);
  return { stat, pos, like, dislike, lang };
}

function decodeAthletes(r, b, champSet, from, warnings, progress) {
  // first athlete: slot 0, version v, id 0, name, then the AthleteStat tag 1 and 12 stats <= 100
  let found = -1, ver = 0;
  for (let i = from; i < b.length - 200; i++) {
    if (b[i] !== 0 || r.q(i) !== 0 || r.q(i + 16) !== 0) continue;
    const v = r.q(i + 8); if (v < 1 || v > 1000) continue;
    const n = r.q(i + 24); if (n < 1 || n > 40) continue;
    const at = i + 32 + n;
    if (r.q(at) !== 1) continue;
    let ok = true; for (let k = 1; k <= 17; k++) if (r.q(at + k * 8) > 100) { ok = false; break; }
    if (!ok) continue;
    found = i; ver = v; break;
  }
  if (found < 0) throw new Error('Could not find the player list in this save.');
  const count = r.q(found - 8);
  const starts = [found];
  for (let k = 1; k < count; k++) {
    const q = indexOf(b, u64bytes(k, ver, k), starts[k - 1] + 64, starts[k - 1] + 2000000);
    if (q < 0) { warnings.push(`Player list stopped early at ${k} of ${count}.`); break; }
    starts.push(q);
  }
  const athletes = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], e = k + 1 < starts.length ? starts[k + 1] : s + 40000;
    try { athletes.push(decodeAthlete(new Reader(b, s), b, s, e, champSet)); }
    catch (err) { warnings.push(`Player ${k}: ${err.message}`); athletes.push({ id: k, name: '?', bad: true }); }
    if (k % 100 === 0) progress(k / starts.length);
  }
  return athletes;
}

function decodeAthlete(r, b, s, e, champSet) {
  r.u(); r.u(); const id = r.u(); const name = r.s();
  const { stat, pos, like, dislike, lang } = readAthleteStat(r);
  r.u(); // constant (3)
  const hidden = []; for (let i = 0; i < 11; i++) hidden.push(r.u());
  // contract: u64, then present flag (u64 0/1), then team, start, end, salary, value, 2 u64
  const contract = {};
  r.u(); const has = r.u();
  if (has === 1) {
    contract.team = r.u(); contract.start = r.s() + ' ' + r.s(); contract.end = r.s() + ' ' + r.s();
    contract.salary = r.f(); contract.value = r.f();
  } else contract.team = -1;
  // re-sync on the face block + age: 9 small u64 (first is 1), a 0 byte, age u64, then u64 2
  let age = null, after = r.p;
  for (let q = r.p; q < Math.min(e, r.p + 6000); q++) {
    if (b[q + 72] !== 0) continue;
    if (r.q(q) !== 1 || r.q(q + 81) !== 2) continue;
    const a = r.q(q + 73); if (a < 13 || a > 50) continue;
    let ok = true; for (let k = 1; k < 9; k++) if (r.q(q + k * 8) > 40) { ok = false; break; }
    if (!ok) continue;
    age = a; after = q + 81; break;
  }
  // champion vectors inside the record
  const recent = findVec(r, b, after, e, champSet, 8, (p) => [r.q(p)]);
  const season = findVec(r, b, after, e, champSet, 56, (p) => { const v = []; for (let i = 0; i < 7; i++) v.push(r.q(p + i * 8)); return v; },
    (items) => items.length > 0 && items.every((it) => it[1] === 0 && it[2] >= it[3] && it[2] < 1000));
  const prof = findVec(r, b, after, e, champSet, 12, (p) => [r.q(p), r.dv.getUint16(p + 8, true), r.dv.getUint16(p + 10, true)],
    (items) => items.length >= 20);
  return {
    id, name, stat, pos, like, dislike, lang, hidden, contract, age,
    recent: recent ? recent.map(([c, n]) => [c, n]) : [],
    season: season ? season.map(([c, , g, w, cs, dmg, tank, heal]) => ({ c, g, w, cs, dmg, tank, heal })) : [],
    prof: prof ? Object.fromEntries(prof.map(([c, , a, base]) => [c, [a, base]])) : {},
  };
}

// Find the first Vec<(champion String, fixed-size tail)> in [s,e) that passes `check`.
function findVec(r, b, s, e, champSet, tail, read, check = (it) => it.length > 0) {
  for (let q = s; q < e - 16; q++) {
    if (b[q + 1] !== 0 || b[q + 7] !== 0) continue;
    const n = r.q(q); if (n < 1 || n > 120) continue;
    const c0 = r.strAt(q + 8, 24); if (!c0 || !champSet.has(c0)) continue;
    let p = q + 8, ok = true; const items = [];
    for (let i = 0; i < n; i++) {
      const c = r.strAt(p, 24);
      if (!c || !champSet.has(c)) { ok = false; break; }
      p += 8 + c.length;
      if (p + tail > e) { ok = false; break; }
      items.push([c, ...read(p)]); p += tail;
    }
    if (ok && check(items)) return items;
  }
  return null;
}

// ---- games ----
// Each pro game record ends with: [team A summary][team B summary][patch "YYYY.x.y"][picks A][picks B]
// and the next record starts with: [game idx, 5, game idx, team A, team B][bans A][bans B]...[10 player blocks].
// So a game = header+bans from anchor i, players from (anchor i, anchor i+1), summaries/patch/picks from anchor i+1.
function decodeGames(r, b, champSet, athletes, warnings, progress) {
  const anchors = [];
  // version strings: u64 8 then "20dd.d.d"
  for (let i = 0; i < b.length - 16; i++) {
    if (b[i] !== 8 || b[i + 8] !== 0x32 || b[i + 9] !== 0x30 || b[i + 12] !== 0x2e || b[i + 14] !== 0x2e) continue;
    if (b[i + 1] | b[i + 2] | b[i + 3] | b[i + 4] | b[i + 5] | b[i + 6] | b[i + 7]) continue;
    const a = parseAnchor(r, i, champSet);
    if (a) anchors.push(a);
    if ((i & 0xfffff) === 0) progress(i / b.length);
  }
  const games = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const h = anchors[k], n = anchors[k + 1];
    if (!h.header || n.off - h.end > 20000) continue;
    const g = {
      idx: h.header.idx, teams: [h.header.a, h.header.b], bans: [h.header.bansA, h.header.bansB],
      patch: n.patch, picks: [n.picksA, n.picksB],
    };
    const sums = readSummaries(r, n.off);
    if (!sums) { warnings.push(`Game ${g.idx}: summary block not recognised.`); continue; }
    g.sum = sums;
    g.winner = sums[0].score === sums[1].score ? (sums[0].kills >= sums[1].kills ? 0 : 1) : (sums[0].score > sums[1].score ? 0 : 1);
    g.players = readPlayers(r, b, h.end, n.off - 492, champSet, g.picks, athletes.length);
    games.push(g);
  }
  progress(1);
  return games;
}

function parseAnchor(r, off, champSet) {
  try {
    const t = new Reader(r.b, off);
    const patch = t.s();
    const picks = () => t.vec(() => { const c = t.s(); if (!champSet.has(c)) throw 0; t.p += 64; return c; });
    const picksA = picks(), picksB = picks();
    if (picksA.length !== 5 || picksB.length !== 5) return null;
    const res = { off, patch, picksA, picksB };
    const save = t.p;
    try {
      const idx = t.u(), five = t.u(), idx2 = t.u(), a = t.u(), bb = t.u();
      if (idx !== idx2 || five !== 5) throw 0;
      const bansA = t.vec(() => t.s()), bansB = t.vec(() => t.s());
      if (![...bansA, ...bansB].every((c) => champSet.has(c))) throw 0;
      res.header = { idx, a, b: bb, bansA, bansB };
      res.end = t.p;
    } catch { t.p = save; res.end = save; }
    return res;
  } catch { return null; }
}

// Team summary: gold[5], cs[5], kills[5], deaths[5], damage[5] (pick order), score, kills, deaths, towers, objectives, 2 flags.
// Team A summary is followed by an extra u64, so A starts 492 bytes before the patch string and B 242 bytes before.
function readSummaries(r, off) {
  const one = (at) => {
    const v = []; for (let i = 0; i < 30; i++) v.push(r.q(at + i * 8));
    return { gold: v.slice(0, 5), cs: v.slice(5, 10), k: v.slice(10, 15), d: v.slice(15, 20), dmg: v.slice(20, 25),
      score: v[25], kills: v[26], deaths: v[27], towers: v[28], objectives: v[29], flags: [r.b[at + 240], r.b[at + 241]] };
  };
  if (off < 500) return null;
  const B = one(off - 242), A = one(off - 492);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  // kills can differ from the other side's deaths (executions), so check each side's own totals
  if (sum(A.k) !== A.kills || sum(B.k) !== B.kills || sum(A.d) !== A.deaths || sum(B.d) !== B.deaths) return null;
  return [A, B];
}

// Player blocks: [u64 4][athlete id][u64 0][slot 0-4][0x01][AthleteStat][champion]...
function readPlayers(r, b, s, e, champSet, picks, nAth) {
  const out = [[null, null, null, null, null], [null, null, null, null, null]];
  const pickIndex = picks.map((side) => new Map(side.map((c, i) => [c, i])));
  for (let q = s + 33; q < e - 200; q++) {
    if (b[q] !== 1 || b[q - 1] !== 1 || r.q(q) !== 1 || r.q(q - 33) !== 4) continue;
    const aid = r.q(q - 25), slot = r.q(q - 9);
    if (aid >= nAth || slot > 4) continue;
    const t = new Reader(b, q);
    let st;
    try { st = readAthleteStat(t); } catch { continue; }
    const champ = t.strAt(t.p, 24);
    if (!champ || !champSet.has(champ)) continue;
    const side = pickIndex[0].has(champ) ? 0 : pickIndex[1].has(champ) ? 1 : -1;
    if (side < 0) continue;
    const pi = pickIndex[side].get(champ);
    if (out[side][pi]) continue;
    out[side][pi] = { aid, slot, stat: st.stat };
    q = t.p;
  }
  return out;
}
