// Champion combos: pairs (and trios) whose kits work together, ranked by how they did in the pro games.
//
// Kit links come from each champion's buffs and debuffs (effects.js) and fight traits (comps.js),
// for example one champion's attack speed buff on another's basic attacks, or area crowd control
// that sets up area damage. The pro record of each pair is compared with what the two champions
// win apart: a pair is only a real combo if it wins more together than each does without the other.
import { compModel } from './comps.js';
import { wr } from './model.js';

const ALLY = (e) => e.target === 'ally' || e.target === 'allies';
const HARD = new Set(['stun', 'airborne', 'knockback', 'pull', 'root', 'taunt', 'fear', 'sleep']);

export const LINKS = {
  aaBuff: { name: 'Attack buffs on an auto-attacker', text: (a, b) => `${a}'s attack buffs on ${b}'s basic attacks` },
  stackBuff: { name: 'Buffs that stack', text: (a, b) => `${a}'s attack buffs stack with ${b}'s own` },
  protectCarry: { name: 'Keeps the carry alive', text: (a, b) => `${a} keeps ${b} alive (heals, shields or protection)` },
  peelCarry: { name: 'Peel for the carry', text: (a, b) => `${a} keeps divers off ${b}` },
  ccChain: { name: 'Crowd control into area damage', text: (a, b) => `${a}'s area crowd control sets up ${b}'s area damage` },
  ccLock: { name: 'Chained crowd control', text: (a, b) => `${a} and ${b} chain crowd control` },
  engageFollow: { name: 'Engage and follow-up', text: (a, b) => `${a} starts the fight and ${b} follows up` },
  catchBurst: { name: 'Catch and burst', text: (a, b) => `${a} catches a target and ${b} bursts it` },
  shred: { name: 'Shred for a carry', text: (a, b) => `${a} lowers resistances for ${b}'s damage` },
  cooldowns: { name: 'Cooldowns for a caster', text: (a, b) => `${a} cuts ${b}'s cooldowns` },
  speedDive: { name: 'Speed into a dive', text: (a, b) => `${a} speeds ${b} into the fight` },
};

// links from a (the enabler) to b
function linksFrom(cm, a, b) {
  const Ea = cm.E[a] || [], Eb = cm.E[b] || [], Ta = cm.T[a], Tb = cm.T[b], Pb = cm.P[b];
  if (!Ta || !Tb || a === b) return [];
  const gives = (kinds) => Ea.some((e) => kinds.includes(e.kind) && ALLY(e));
  const aa = Pb.dmgTotal ? Pb.aaDmg / Pb.dmgTotal : 0;
  const selfBuff = Eb.some((e) => ['aspdUp', 'adUp'].includes(e.kind) && e.target === 'self');
  const out = [];
  const add = (key, s) => { if (s > 0.25) out.push({ key, s: Math.min(1.5, s) }); };
  if (gives(['aspdUp', 'adUp', 'rangeUp']) && Tb.protect < 0.5) { add('aaBuff', aa * (0.3 + Tb.dps)); if (selfBuff && aa > 0.35) add('stackBuff', 0.5 + aa * 0.5); }
  if (gives(['shield', 'heal', 'dmgReduce', 'revive', 'untargetable', 'cleanse'])) add('protectCarry', Tb.carry * Ta.protect * 1.6);
  if (Ta.peel > 0.45 && Tb.frontline < 0.45) add('peelCarry', Tb.carry * Ta.peel);
  const areaHard = Ea.some((e) => HARD.has(e.kind) && e.target === 'enemies');
  if (areaHard) add('ccChain', Tb.aoe > 0.6 ? Tb.aoe : 0);
  if (areaHard && Eb.some((e) => HARD.has(e.kind) && e.target === 'enemies')) add('ccLock', 0.5);
  if (Ta.engage > 0.7) add('engageFollow', Math.max(Tb.dive, Tb.burst) > 0.65 ? Math.max(Tb.dive, Tb.burst) * 0.8 : 0);
  if (Ta.catch > 0.5) add('catchBurst', Tb.burst > 0.7 ? Tb.burst * Ta.catch : 0);
  if (Ea.some((e) => e.kind === 'armorDown' || e.kind === 'dmgAmp') && Tb.magic < 0.3) add('shred', Tb.dps);
  if (Ea.some((e) => e.kind === 'mrDown' || e.kind === 'dmgAmp') && Tb.magic > 0.6) add('shred', Tb.dps);
  if (gives(['cdrUp'])) add('cooldowns', 1 - aa);
  if (gives(['msUp'])) add('speedDive', Tb.dive > 0.6 ? Tb.dive * 0.6 : 0);
  return out;
}

// Kit links between two champions, both directions, strongest first.
export function kitLinks(cm, a, b) {
  return [...linksFrom(cm, a, b).map((l) => ({ ...l, from: a, to: b })), ...linksFrom(cm, b, a).map((l) => ({ ...l, from: b, to: a }))].sort((x, y) => y.s - x.s);
}
export const kitScore = (links) => links.reduce((s, l) => s + l.s, 0);

const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));

// Pro record of every pair and trio that played on the same team, against what the champions win apart.
// Returns { pairs: Map("a|b" -> row), trios: [row] }, row = { ids, g, w, exp, lift, z }.
export function comboStats(m, games = m.games) {
  const key = games.length + ':' + (games[games.length - 1]?.idx ?? '');
  if (m._combo?.key === key) return m._combo;
  const solo = {}; const pair = new Map(); const trio = new Map();
  const bump = (map, k, win) => { const v = map.get(k) || [0, 0]; v[0]++; if (win) v[1]++; map.set(k, v); };
  for (const g of games) for (const s of [0, 1]) {
    const p = g.picks[s].slice().sort(); const win = g.winner === s;
    for (const c of p) { const v = (solo[c] ||= [0, 0]); v[0]++; if (win) v[1]++; }
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      bump(pair, p[i] + '|' + p[j], win);
      for (let k = j + 1; k < p.length; k++) bump(trio, p[i] + '|' + p[j] + '|' + p[k], win);
    }
  }
  // a champion's win rate in games without the other(s), shrunk toward 50%
  const apart = (c, together) => { const [n, w] = solo[c] || [0, 0]; return wr(w - together[1], n - together[0], 20); };
  const row = (ids, v) => {
    const parts = ids.map((c) => logit(Math.min(0.9, Math.max(0.1, apart(c, v)))));
    const exp = sig(parts.reduce((a, b) => a + b, 0));
    const shrunk = (v[1] + 10 * exp) / (v[0] + 10);
    return { ids, g: v[0], w: v[1], exp, lift: shrunk - exp, z: (v[1] - v[0] * exp) / Math.sqrt(v[0] * exp * (1 - exp) || 1) };
  };
  const pairs = new Map(); for (const [k, v] of pair) pairs.set(k, row(k.split('|'), v));
  const trios = []; for (const [k, v] of trio) if (v[0] >= 12) trios.push(row(k.split('|'), v));
  m._combo = { key, pairs, trios, solo };
  return m._combo;
}
export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// Every pair with a kit link or a pro record worth showing, best first.
// score mixes the kit links with the pro lift, so a kit combo the pros never tried still shows.
export function allCombos(m) {
  const cm = compModel(m); if (!cm) return [];
  const st = comboStats(m);
  if (m._allCombos?.cm === cm && m._allCombos.st === st) return m._allCombos.list;
  const ids = Object.keys(cm.T);
  const out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const links = kitLinks(cm, a, b); const pro = st.pairs.get(pairKey(a, b)) || null;
    const ks = kitScore(links);
    if (!links.length && !(pro && pro.g >= 10 && pro.lift > 0.04)) continue;
    out.push({ a, b, links, kit: ks, pro, score: ks * 0.5 + (pro ? pro.lift * Math.min(1, pro.g / 30) * 10 : 0) });
  }
  out.sort((x, y) => y.score - x.score);
  m._allCombos = { cm, st, list: out };
  return out;
}

// Best partners for c among a list of champions already on the team.
export function partnersOf(m, c, team) {
  const cm = compModel(m); if (!cm) return [];
  const st = comboStats(m);
  return team.filter((x) => x && x !== c).map((x) => {
    const links = kitLinks(cm, c, x); const pro = st.pairs.get(pairKey(c, x)) || null;
    return { with: x, links, kit: kitScore(links), pro };
  }).filter((r) => r.kit > 0.5 || (r.pro && r.pro.g >= 10 && r.pro.lift > 0.03))
    .sort((p, q) => (q.kit * 0.5 + (q.pro?.lift || 0) * 10) - (p.kit * 0.5 + (p.pro?.lift || 0) * 10));
}
