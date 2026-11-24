// Draft recommendations. Every score is built from parts that the UI shows,
// so you can see why a champion is suggested.
import { wr, ROLES } from './model.js';

const isFront = (ch) => ch && (ch.cat === 'Tank' || ch.tags.includes('Tank'));
const isAP = (ch) => ch && ch.tags.includes('AP');
const isAD = (ch) => ch && ch.tags.includes('AD');
const isSustain = (ch) => ch && (ch.tags.includes('Heal') || ch.tags.includes('Shield'));
const hasCC = (ch) => ch && ch.tags.includes('CC');

function permutations(n, k) { // all injective maps of k picks to n roles
  const out = [];
  const rec = (cur, used) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let r = 0; r < n; r++) if (!used[r]) { used[r] = 1; cur.push(r); rec(cur, used); cur.pop(); used[r] = 0; }
  };
  rec([], []);
  return out;
}
export const PERMS = Array.from({ length: 6 }, (_, k) => permutations(5, k));

export function compScore(champs, mine, c) {
  const chs = mine.map((x) => champs[x]);
  const ch = champs[c];
  let v = 0;
  const n = chs.length + 1;
  const front = chs.filter(isFront).length, ap = chs.filter(isAP).length, ad = chs.filter((x) => isAD(x) && !isAP(x)).length;
  const sus = chs.filter(isSustain).length, cc = chs.filter(hasCC).length;
  if (isFront(ch)) v += front === 0 ? (n >= 3 ? 8 : 4) : front >= 2 ? -4 : 0;
  else if (front === 0 && n >= 4) v -= 6;
  if (isAP(ch) && ap === 0 && ad >= 2) v += 4;
  if (isAD(ch) && !isAP(ch) && ad >= 3) v -= 4;
  if (isAP(ch) && ap >= 3) v -= 4;
  if (isSustain(ch) && sus === 0 && n >= 3) v += 3;
  if (hasCC(ch) && cc === 0 && n >= 3) v += 2;
  return v;
}


export class DraftEngine {
  constructor(model, { us, them, patches, learner = null }) {
    this.m = model; this.us = us; this.them = them; this.learner = learner;
    let games = model.filterGames({ patches });
    if (games.length < 200) games = model.games; // too few games on this patch: use everything
    this.games = games;
    this.stats = model.champStats(games);
    const { syn, vs } = model.pairStats(games);
    this.syn = syn; this.vs = vs;
    this.tend = { us: model.teamTendencies(us, model.games), them: model.teamTendencies(them, model.games) };
    this.teamGames = { us: model.teamGames.get(us)?.length || 0, them: model.teamGames.get(them)?.length || 0 };
    this.lineup = { us: (model.starters.get(us) || []).slice(), them: (model.starters.get(them) || []).slice() };
    this.comfortCache = new Map();
  }

  aff(c, r) { const s = this.stats[c]; return (s.roles[r] + 0.5) / (s.picks + 2.5); }
  comfort(aid, c) {
    const key = aid + '|' + c;
    if (!this.comfortCache.has(key)) this.comfortCache.set(key, this.m.comfort(this.m.athletes[aid], c));
    return this.comfortCache.get(key);
  }
  fit(side, c, r) {
    const aid = this.lineup[side][r];
    const comfort = aid == null ? 0.4 : this.comfort(aid, c);
    return Math.sqrt(this.aff(c, r)) * (0.3 + 0.7 * comfort);
  }
  // Best role assignment for a list of picks; returns value and roles.
  assign(side, picks) {
    if (picks.length > 5) picks = picks.slice(0, 5);
    const fx = this.fixed?.[side] || {};
    const run = (strict) => {
      let best = null;
      for (const perm of PERMS[picks.length]) {
        if (strict && picks.some((c, i) => fx[c] != null && perm[i] !== fx[c])) continue;
        let v = 0; for (let i = 0; i < picks.length; i++) v += this.fit(side, picks[i], perm[i]);
        if (!best || v > best.v) best = { v, roles: perm };
      }
      return best;
    };
    // roles you set on the board are kept; if they clash, fall back to the best fit
    return run(true) || run(false) || { v: 0, roles: [] };
  }

  meta(c) { const s = this.stats[c]; return { win: s.adjWin, presence: s.presence, picks: s.picks }; }
  pairWr(map, a, b) { const v = map.get(a + '|' + b); return v ? { g: v[0], w: wr(v[1], v[0], 8) } : { g: 0, w: 0.5 }; }

  // Score champion c as a pick for `side` ('us' or 'them') in draft state.
  pickScore(state, side, c) {
    const other = side === 'us' ? 'them' : 'us';
    const mine = state[side].picks, theirs = state[other].picks;
    const ch = this.m.champs[c];
    const base = this.assign(side, mine);
    const withC = this.assign(side, [...mine, c]);
    const role = withC.roles[mine.length];
    const fitGain = withC.v - base.v; // 0..~1
    const player = this.lineup[side][role];
    const s = this.stats[c];

    const parts = {};
    parts.meta = (s.adjWin - 0.5) * 120 + Math.min(s.presence, 0.8) * 10;
    parts.fit = fitGain * 45;
    let syn = 0, synN = 0; for (const x of mine) { const p = this.pairWr(this.syn, c, x); syn += (p.w - 0.5); synN++; }
    parts.synergy = synN ? (syn / synN) * 120 : 0;
    let ctr = 0, ctrN = 0; for (const y of theirs) { const p = this.pairWr(this.vs, c, y); ctr += (p.w - 0.5); ctrN++; }
    parts.counter = ctrN ? (ctr / ctrN) * 120 : 0;
    parts.comp = this.compScore(mine, c);
    const t = this.tend[side]; const tg = this.teamGames[side] || 1;
    parts.habit = Math.min(1, (t.picks[c] || 0) / tg * 3) * 6; // teams lean on what they practice
    const L = this.learner;
    if (L) {
      // weights learned from pro games and your recorded results
      for (const k of ['fit', 'meta', 'synergy', 'counter', 'comp']) if (L.mult[k] != null) parts[k] *= L.mult[k];
      const y = side === 'us' && L.yours[this.us + '|' + c];
      if (y) parts.yours = y.adj * 40;
    }
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { c, total, parts, role, player, picks: s.picks };
  }

  compScore(mine, c) { return compScore(this.m.champs, mine, c); }

  // Champions still open. With fearless series rules, `side` also drops what it may not pick again.
  available(state, side) {
    const taken = new Set([...state.us.picks, ...state.them.picks, ...state.us.bans, ...state.them.bans]);
    const lock = side ? this.locked?.[side] : null;
    return this.m.champIds.filter((c) => !taken.has(c) && this.stats[c] && !(lock && lock.has(c)));
  }
  canPick(side, c) { return !this.locked?.[side]?.has(c); }

  recommendPicks(state, side = 'us', n = 12) {
    const other = side === 'us' ? 'them' : 'us';
    const left = this.seriesLeft || 0;
    const rows = this.available(state, side).map((c) => {
      const r = this.pickScore(state, side, c);
      // deny value: how much the other side would want it
      const theirs = state[other].picks.length < 5 && this.canPick(other, c) ? this.pickScore(state, other, c) : null;
      r.parts.deny = theirs ? Math.max(0, theirs.total) * 0.15 : 0;
      // hard fearless: taking it also keeps it from them for the rest of the series
      if (theirs && left && this.fearless === 'hard') r.parts.denySeries = Math.max(0, theirs.total) * 0.05 * left;
      // fearless: spending a player's best champion now leaves less for later games
      if (left && this.fearless !== 'off' && r.player != null) {
        const comfort = this.comfort(r.player, c);
        if (comfort > 0.5) r.parts.saveForLater = -(comfort - 0.5) * 6 * left;
      }
      r.total = Object.values(r.parts).reduce((a, b) => a + b, 0);
      return r;
    });
    rows.sort((a, b) => b.total - a.total);
    return rows.slice(0, n);
  }

  // Bans for `side`: remove what the other side wants most, minus what we would lose.
  recommendBans(state, side = 'us', n = 12) {
    const other = side === 'us' ? 'them' : 'us';
    // no point banning what they may not pick anyway
    const rows = this.available(state, other).map((c) => {
      const threat = state[other].picks.length < 5 ? this.pickScore(state, other, c) : { total: 0, role: null, player: null };
      const ours = state[side].picks.length < 5 && this.canPick(side, c) ? this.pickScore(state, side, c) : { total: 0 };
      const t = this.tend[other]; const tg = this.teamGames[other] || 1;
      const parts = {
        threat: threat.total,
        comfortPick: Math.min(1, (t.picks[c] || 0) / tg * 3) * 10,
        oftenBannedVsThem: Math.min(1, (this.tend[other].bannedVs[c] || 0) / tg * 3) * 4,
        ownLoss: -Math.max(0, ours.total) * 0.35,
      };
      const total = Object.values(parts).reduce((a, b) => a + b, 0);
      return { c, total, parts, role: threat.role, player: threat.player };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows.slice(0, n);
  }

  // Win estimate for two finished or partial drafts (rough, from the same parts).
  outlook(state) {
    const val = (side) => {
      const picks = state[side].picks; const other = side === 'us' ? 'them' : 'us';
      if (!picks.length) return 0;
      const a = this.assign(side, picks);
      let meta = 0; for (const c of picks) meta += this.stats[c].adjWin - 0.5;
      let syn = 0, sn = 0; for (let i = 0; i < picks.length; i++) for (let j = 0; j < picks.length; j++) if (i !== j) { syn += this.pairWr(this.syn, picks[i], picks[j]).w - 0.5; sn++; }
      let ctr = 0, cn = 0; for (const x of picks) for (const y of state[other].picks) { ctr += this.pairWr(this.vs, x, y).w - 0.5; cn++; }
      return a.v * 0.5 + meta * 1.2 + (sn ? syn / sn : 0) * 2 + (cn ? ctr / cn : 0) * 2;
    };
    const d = val('us') - val('them');
    return 1 / (1 + Math.exp(-d * 2.2));
  }
}

export { ROLES };
