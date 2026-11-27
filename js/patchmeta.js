// Patch and league aware champion strength.
//
// The game runs its own balance patches. Right after a patch there are only a few pro
// games on it, so treating every game in the save the same mostly shows the old meta.
// Instead each champion's strength on a patch is its record on that patch, pulled toward
// what older patches said (fading by half for each patch back). Champions changed in the
// patch notes start from a prior moved by the size of the buff or nerf, and the prior is
// trusted half as much. Games from your own league, and then your region, count extra.
//
// The numbers were fitted on the pro games in a save with 7 patches, predicting each game
// from games played before it (2,000 games from 2026.2.1 on): accuracy 59% with every
// patch pooled, 62% with this; on the first 103 games of 2027.0.0, 57% against 68%.
// Same-league x3 and same-region x1.5 lowered log loss again (0.6534 to 0.6484).

export const PATCH_DECAY = 0.5;   // an older patch counts half as much as the one after it
export const PRIOR_K = 250;       // how many current-patch picks it takes to outweigh older patches
export const TAG_SHIFT = 0.04;    // win rate change per level of a patch note buff or nerf
export const LEAGUE_W = 3;        // a game in the league in focus counts this many times
export const REGION_W = 1.5;      // a game in the same region (other division) counts this much
const OLD_GAMES = 400;            // older patches together count as this many games for presence, bans and pairs

// A champion's patch note reasons as a direction: + buff, - nerf. "nerf_meta_2" is -2.
export function noteDirection(reasons) {
  if (!reasons) return null;
  let d = 0;
  for (const r of reasons) {
    const m = r.match(/^(nerf|buff)_meta_(\d)/);
    if (m) d += (m[1] === 'buff' ? 1 : -1) * +m[2];
    else if (/^unpicked/.test(r)) d += 1; // buffed because nobody picked it
  }
  return d;
}

// Short words for the reasons the game gives in patch notes.
const REASON = {
  nerf_meta: 'nerfed for the meta', buff_meta: 'buffed for the meta', too_much_damage: 'too much damage', too_tanky: 'too tanky',
  too_much_healing: 'too much healing', too_fragile: 'too fragile', late_game_scaling: 'late game scaling', early_game_dominant: 'early game too strong',
  weak_early_game: 'weak early game', low_damage: 'low damage', unpicked: 'rarely picked', unpicked_long: 'not picked for a long time',
};
export function reasonText(r) {
  const m = r.match(/^(.*?)(?:_(\d))?$/);
  const base = REASON[m[1]] || m[1].replace(/_/g, ' ');
  return m[2] ? `${base} (${m[2]})` : base;
}
const RULE = {
  kill_gold: 'Gold per kill', assist_gold: 'Gold per assist', gold_per_second: 'Passive gold per second', kill_exp: 'Experience per kill',
  tower_hp: 'Tower HP', tower_defence: 'Tower defence',
};
export const ruleName = (k) => RULE[k] || k.replace(/_/g, ' ');

// What the game rules are on each patch (the rule changes carried forward).
export function rulesByPatch(m) {
  const out = {}, cur = {};
  const notes = Object.fromEntries((m.patchNotes || []).map((p) => [p.version, p]));
  for (const p of m.patches) {
    const changes = notes[p]?.rules || [];
    for (const r of changes) { if (!(r.rule in cur)) cur[r.rule] = { base: +r.from }; cur[r.rule].now = +r.to; }
    out[p] = { changes, rules: JSON.parse(JSON.stringify(cur)) };
  }
  return out;
}

export class PatchMeta {
  // patch: the patch to rate champions for (default the latest). league: league id in focus, or null.
  constructor(m, { patch = null, league = null } = {}) {
    this.m = m;
    this.patch = patch || m.patches[m.patches.length - 1];
    this.pi = m.patches.indexOf(this.patch);
    this.league = league;
    this.region = league != null ? m.league(league)?.region ?? null : null;
    this.note = (m.patchNotes || []).find((p) => p.version === this.patch) || null;
    // games on this patch and the ones before it
    const age = new Map(m.patches.map((p, i) => [p, this.pi - i]));
    this.age = (g) => age.get(g.patch);
    this.games = m.games.filter((g) => this.age(g) >= 0);
    this.current = this.games.filter((g) => this.age(g) === 0);
    // older patches as one block worth OLD_GAMES games, recent ones counting most
    let old = 0; for (const g of this.games) { const a = this.age(g); if (a > 0) old += PATCH_DECAY ** (a - 1) * this.lw(g); }
    this.oldScale = old > 0 ? Math.min(1, OLD_GAMES / old) : 0;
    this.weight = (g) => { const a = this.age(g); if (a == null || a < 0) return 0; return (a === 0 ? 1 : PATCH_DECAY ** (a - 1) * this.oldScale) * this.lw(g); };
    this.#strength();
  }

  // league weight of a game
  lw(g) {
    if (this.league == null) return 1;
    if (g.league === this.league) return LEAGUE_W;
    if (this.region != null && g.league != null && this.m.league(g.league)?.region === this.region) return REGION_W;
    return 1;
  }

  #strength() {
    const cur = {}, old = {}, raw = {};
    for (const g of this.current) for (const side of [0, 1]) for (const c of g.picks[side]) { const v = (raw[c] ||= [0, 0]); v[1]++; if (g.winner === side) v[0]++; }
    this.raw = raw;
    for (const g of this.games) {
      const a = this.age(g), w = this.lw(g) * (a === 0 ? 1 : PATCH_DECAY ** (a - 1));
      const t = a === 0 ? cur : old;
      for (const side of [0, 1]) for (const c of g.picks[side]) { const v = (t[c] ||= [0, 0]); v[1] += w; if (g.winner === side) v[0] += w; }
    }
    this.cur = cur; this.old = old;
    this.str = {};
    for (const c of this.m.champIds) this.str[c] = this.rate(c);
  }

  // Strength of champion c: { win, prior, w, g, dir }. ex = { win: 1/0 } removes one current-patch pick (for training).
  rate(c, exW = 0, exG = 0) {
    const o = this.old[c] || [0, 0], t = this.cur[c] || [0, 0];
    let prior = (o[0] + 40) / (o[1] + 80);
    let k = PRIOR_K;
    const dir = noteDirection(this.note?.reasons?.[c]);
    if (dir != null) { prior = Math.min(0.75, Math.max(0.25, prior + TAG_SHIFT * dir)); k *= 0.5; }
    const w = t[0] - exW, g = t[1] - exG;
    return { win: (w + k * prior) / (g + k), prior, w, g, dir };
  }
  win(c) { return this.str[c]?.win ?? 0.5; }

  // Champion table for the draft: weighted counts (recent patches and your league first),
  // with the win rate replaced by the patch-aware strength.
  champStats() {
    const s = this.m.champStats(this.games, this.weight);
    for (const c of this.m.champIds) {
      const x = s[c], r = this.str[c]; if (!x || !r) continue;
      x.adjWin = r.win; x.prior = r.prior; x.patchDir = r.dir; x.curGames = this.raw[c]?.[1] || 0; x.curWins = this.raw[c]?.[0] || 0;
    }
    return s;
  }
  pairStats() { return this.m.pairStats(this.games, this.weight); }

  // What changed on this patch, for display.
  changes() {
    const n = this.note; if (!n) return null;
    const champs = Object.keys({ ...n.champions, ...n.reasons }).map((c) => ({
      c, dir: noteDirection(n.reasons[c]), reasons: (n.reasons[c] || []).map(reasonText), list: n.champions[c] || [],
    })).sort((a, b) => (a.dir ?? 0) - (b.dir ?? 0));
    return { version: n.version, added: n.added, champs, rules: n.rules };
  }
}
