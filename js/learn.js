// Learned win model. A logistic regression on a few draft features, trained on
// every pro game in the save and on the results you record yourself. What it
// learns feeds back into the draft suggestions as weights on each part.
import { wr } from './model.js';
import { PERMS, compScore } from './draft.js';
import { local } from './store.js';

export const FEATURES = [
  { key: 'fit', label: 'Player and role fit' },
  { key: 'meta', label: 'Champion strength' },
  { key: 'synergy', label: 'Synergy' },
  { key: 'counter', label: 'Matchups' },
  { key: 'comp', label: 'Team composition' },
  { key: 'rating', label: 'Player strength' },
  { key: 'side', label: 'Side A (first pick)' },
];
// How much each feature counts in the hand-made suggestion scores, in log-odds per unit.
// The learned weight divided by this becomes a multiplier on that part of a suggestion.
const HAND = { fit: 1, meta: 2.67, synergy: 2.67, counter: 1.33, comp: 0.22 };
export const YOUR_WEIGHT = 5; // one of your recorded games counts as this many pro games

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const results = {
  all() { return local.get('results', []); },
  save(list) { local.set('results', list); },
};

export class Learner {
  constructor(m) {
    this.m = m;
    this.stats = m.champStats(m.games);
    const { syn, vs } = m.pairStats(m.games);
    this.syn = syn; this.vs = vs;
    this.comfortCache = new Map();
    this.pro = [];
    for (const g of m.games) {
      const lineup = g.players.map((side) => { const l = [null, null, null, null, null]; side.forEach((p) => { if (p && p.slot < 5) l[p.slot] = p.aid; }); return l; });
      const x = this.features({ picks: [g.picks[0], g.picks[1]], lineup, sideA: true, exclude: g });
      this.pro.push({ x, y: g.winner === 0 ? 1 : 0 });
    }
    // standardise on pro games
    const k = FEATURES.length;
    this.mu = Array(k).fill(0); this.sd = Array(k).fill(1);
    for (let j = 0; j < k; j++) {
      if (FEATURES[j].key === 'side') continue; // already ±1, keep it centred at 0
      const v = this.pro.map((r) => r.x[j]);
      const mean = 0; // features are differences between sides, so 0 is the neutral point
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
      this.sd[j] = sd;
    }
    this.evaluate();
    this.retrain();
  }

  // Same formula as Model.comfort, but able to leave one game out so the
  // player's result in that game does not leak into its own prediction.
  comfort(aid, c, ex) {
    const key = aid + '|' + c;
    let base = this.comfortCache.get(key);
    if (!base) {
      const a = this.m.athletes[aid];
      let g = 0, w = 0; const games = new Map();
      for (const l of a?.log || []) if (l.champ === c) { g++; if (l.win) w++; games.set(l.g, l.win); }
      base = { prof: a?.prof?.[c]?.[0] ?? 50, g, w, games, ok: !!a };
      this.comfortCache.set(key, base);
    }
    if (!base.ok) return 0;
    let { g, w } = base;
    if (ex && base.games.has(ex)) { g--; if (base.games.get(ex)) w--; }
    const profScore = Math.max(0, Math.min(1, (base.prof - 60) / 500));
    const exp = Math.min(1, g / 8);
    const form = g ? wr(w, g, 6) - 0.5 : 0;
    return Math.max(0, Math.min(1, 0.65 * profScore + 0.25 * exp + 0.5 * form + 0.1));
  }

  // Champion win rate, leaving out one game's result when training on it.
  champWin(c, ex, side) {
    const s = this.stats[c]; if (!s) return 0.5;
    let w = s.wins, g = s.picks;
    if (ex && ex.picks[side].includes(c)) { g--; if (ex.winner === side) w--; }
    return wr(w, g);
  }
  pair(map, a, b, ex, side, sameTeam) {
    const v = map.get(a + '|' + b); let g = v ? v[0] : 0, w = v ? v[1] : 0;
    if (ex && ex.picks[side].includes(a) && ex.picks[sameTeam ? side : 1 - side].includes(b)) { g--; if (ex.winner === side) w--; }
    return g > 0 ? wr(w, g, 8) : 0.5;
  }
  fitValue(picks, lineup, ex) {
    if (!picks.length) return 0;
    let best = -1;
    for (const perm of PERMS[Math.min(5, picks.length)]) {
      let v = 0;
      for (let i = 0; i < perm.length; i++) {
        const c = picks[i], r = perm[i], s = this.stats[c];
        const aff = s ? (s.roles[r] + 0.5) / (s.picks + 2.5) : 0.2;
        const aid = lineup?.[r];
        const comfort = aid == null ? 0.4 : this.comfort(aid, c, ex);
        v += Math.sqrt(aff) * (0.3 + 0.7 * comfort);
      }
      if (v > best) best = v;
    }
    return best;
  }
  sideValue(i, { picks, lineup, exclude }) {
    const mine = picks[i].filter(Boolean), theirs = picks[1 - i].filter(Boolean);
    let meta = 0; for (const c of mine) meta += this.champWin(c, exclude, i) - 0.5;
    let syn = 0, sn = 0;
    for (const a of mine) for (const b of mine) if (a !== b) { syn += this.pair(this.syn, a, b, exclude, i, true) - 0.5; sn++; }
    let ctr = 0, cn = 0;
    for (const a of mine) for (const b of theirs) { ctr += this.pair(this.vs, a, b, exclude, i, false) - 0.5; cn++; }
    let comp = 0; for (let k = 0; k < mine.length; k++) comp += compScore(this.m.champs, mine.slice(0, k), mine[k]);
    const l = lineup?.[i] || [];
    const ratings = l.map((aid) => (aid == null ? null : this.m.athletes[aid]?.rating)).filter((v) => v != null);
    return {
      fit: this.fitValue(mine, l, exclude), meta, synergy: sn ? syn / sn : 0, counter: cn ? ctr / cn : 0, comp: comp / 10,
      rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    };
  }
  // Feature vector from side 0's point of view. sideA: whether side 0 picks first.
  features(d) {
    const a = this.sideValue(0, d), b = this.sideValue(1, d);
    return FEATURES.map(({ key }) => {
      if (key === 'side') return d.sideA ? 1 : -1;
      if (key === 'rating') return a.rating != null && b.rating != null ? (a.rating - b.rating) / 10 : 0;
      return a[key] - b[key];
    });
  }

  fit(rows, iters = 400) {
    const k = FEATURES.length, w = Array(k).fill(0), lam = 0.002;
    const z = rows.map((r) => ({ x: r.x.map((v, j) => v / this.sd[j]), y: r.y, wt: r.wt || 1 }));
    // add the mirror of every row so the model has no built-in favourite
    const all = [...z, ...z.map((r) => ({ x: r.x.map((v) => -v), y: 1 - r.y, wt: r.wt }))];
    const W = all.reduce((a, r) => a + r.wt, 0);
    for (let it = 0; it < iters; it++) {
      const grad = Array(k).fill(0);
      for (const r of all) {
        let s = 0; for (let j = 0; j < k; j++) s += w[j] * r.x[j];
        const e = (sigmoid(s) - r.y) * r.wt;
        for (let j = 0; j < k; j++) grad[j] += e * r.x[j];
      }
      for (let j = 0; j < k; j++) w[j] -= 1.0 * (grad[j] / W + lam * w[j]);
    }
    return w;
  }
  prob(w, x) { let s = 0; for (let j = 0; j < x.length; j++) s += w[j] * x[j] / this.sd[j]; return sigmoid(s); }

  // Honest check: train on the older 80% of pro games and test on the newest 20%.
  evaluate() {
    const cut = Math.floor(this.pro.length * 0.8);
    const train = this.pro.slice(0, cut), test = this.pro.slice(cut);
    const w = this.fit(train, 250);
    const score = (p) => {
      let hit = 0, ll = 0;
      test.forEach((r, i) => { const q = Math.min(0.99, Math.max(0.01, p(r, i))); hit += (q > 0.5) === (r.y === 1) ? 1 : 0; ll -= r.y ? Math.log(q) : Math.log(1 - q); });
      return { acc: hit / test.length, logloss: ll / test.length };
    };
    const iFit = 0, iMeta = 1, iSyn = 2, iCtr = 3;
    const hand = (r) => sigmoid(2.2 * (0.5 * r.x[iFit] + 1.2 * r.x[iMeta] + 2 * r.x[iSyn] + 2 * r.x[iCtr]));
    this.eval = { n: test.length, learned: score((r) => this.prob(w, r.x)), hand: score(hand), coin: { acc: 0.5, logloss: Math.log(2) } };
  }

  retrain() {
    this.records = results.all();
    this.mine = [];
    for (const r of this.records) {
      if (r.won == null) continue;
      try { this.mine.push({ x: this.recordFeatures(r), y: r.won ? 1 : 0, wt: YOUR_WEIGHT, r }); } catch (e) { console.warn('Skipping a recorded game', e); }
    }
    this.w = this.fit([...this.pro, ...this.mine]);
    this.wPro = this.mine.length ? this.fit(this.pro) : this.w;
    // multipliers for the suggestion parts
    this.mult = {};
    FEATURES.forEach(({ key }, j) => {
      if (!(key in HAND)) return;
      const raw = this.w[j] / this.sd[j];
      this.mult[key] = Math.max(0.25, Math.min(3, raw / HAND[key]));
    });
    // per-champion surprise in your own games: won more (or less) than the model expected
    this.yours = {};
    for (const row of this.mine) {
      const p = this.prob(this.w, row.x), res = row.y - p;
      for (const c of row.r.picks.us) { const key = row.r.us + '|' + c; const v = this.yours[key] || { s: 0, n: 0 }; v.s += res; v.n++; this.yours[key] = v; }
    }
    for (const v of Object.values(this.yours)) v.adj = v.s / (v.n + 4);
  }

  recordFeatures(r) {
    return this.features({ picks: [r.picks.us, r.picks.them], lineup: [r.lineup.us, r.lineup.them], sideA: r.side === 'A' });
  }
  // Win chance for us from a (partial) draft.
  predict({ us, them, lineupUs, lineupThem, sideA }) {
    return this.prob(this.w, this.features({ picks: [us, them], lineup: [lineupUs, lineupThem], sideA }));
  }
  weights() {
    return FEATURES.map((f, j) => ({ ...f, w: this.w[j], wPro: this.wPro[j], mult: this.mult[f.key] }));
  }
}

let cached = null;
export function learner(m) {
  if (!cached || cached.m !== m) cached = new Learner(m);
  return cached;
}
