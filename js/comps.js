// Team compositions: what a five-champion draft is built to do, worked out from the kits.
//
// Each champion gets fight traits from its kit profile (profile.js) and its buffs and debuffs
// (effects.js): engage, catch, peel, protect, poke, burst, area damage and so on. A draft's
// composition scores add those traits up in the way each style of play needs them:
//   dive      gap closers and burst, with crowd control to follow up
//   poke      long range and zones, with ways to keep enemies off
//   pick      single-target catches and burst to finish the caught target
//   protect   one carry who does steady damage, with heals, shields, buffs and peel around them
//   teamfight area crowd control chained with area damage
//   split     a champion who wins side lanes alone, and a team that can hold four against five
// Scores are standardised against the drafts in the save's pro games, so 0 is an average draft
// and +1 is one spread above it.
import { profilesFor } from './profile.js';
import { allEffects, EFFECTS } from './effects.js';

export const COMPS = {
  dive: { name: 'Dive', blurb: 'jump the backline and kill a carry before it can act' },
  poke: { name: 'Poke and siege', blurb: 'wear enemies down from range, then take towers and objectives' },
  pick: { name: 'Pick', blurb: 'catch one enemy out of position and win the fight 5 against 4' },
  protect: { name: 'Protect the carry', blurb: 'keep one damage dealer alive and let them win the long fight' },
  teamfight: { name: 'Teamfight', blurb: 'chain area crowd control and area damage in one big fight' },
  split: { name: 'Split push', blurb: 'send a strong side laner to pull enemies away while the rest hold' },
};
export const COMP_KEYS = Object.keys(COMPS);

const HARD = new Set(Object.entries(EFFECTS).filter(([, e]) => e.group === 'hard CC').map(([k]) => k));

// fight traits for one champion, each about 0 to 1
export function traitsOf(p, es) {
  if (!p) return null;
  const q = p.pct; const has = (f) => es.some(f);
  const hardOn = (t) => has((e) => HARD.has(e.kind) && e.target === t);
  const dash = has((e) => e.kind === 'dash') || p.mobility > 0;
  const toAllies = (kinds) => es.filter((e) => kinds.includes(e.kind) && (e.target === 'ally' || e.target === 'allies')).length;
  const protect = Math.min(1, 0.35 * toAllies(['heal', 'shield', 'dmgReduce', 'cleanse', 'revive', 'untargetable']) + 0.2 * toAllies(['aspdUp', 'adUp', 'msUp', 'cdrUp']) + q.support * 0.4);
  const soft = es.filter((e) => ['slow', 'knockback', 'aspdDown', 'blind', 'silence'].includes(e.kind)).length;
  const t = {
    frontline: Math.min(1, q.tank * (p.melee ? 1 : 0.5)),
    engage: Math.min(1, (dash ? 0.45 : 0) + (hardOn('enemies') ? 0.45 : hardOn('enemy') ? 0.25 : 0) + (p.melee ? 0.1 : 0) + q.tank * 0.15),
    catch: Math.min(1, (hardOn('enemy') || has((e) => e.kind === 'pull' || e.kind === 'root')) ? 0.5 + q.range * 0.3 + (has((e) => e.kind === 'mark') ? 0.2 : 0) : 0),
    burst: q.burst,
    dps: q.sustained,
    aoe: q.aoe,
    areaCC: hardOn('enemies') ? Math.min(1, 0.6 + 0.2 * es.filter((e) => HARD.has(e.kind) && e.target === 'enemies').length) : 0,
    peel: Math.min(1, 0.2 * soft + (has((e) => e.kind === 'taunt' || e.kind === 'knockback') ? 0.3 : 0) + protect * 0.4),
    protect,
    poke: p.melee ? 0 : Math.min(1, q.range * 0.7 + q.aoe * 0.3 + (has((e) => e.kind === 'zone' || e.kind === 'dot') ? 0.15 : 0)),
    dive: Math.min(1, (dash ? 0.4 : 0) + q.burst * 0.4 + (has((e) => e.kind === 'untargetable' || e.kind === 'stealth') ? 0.2 : 0) + (p.melee ? 0.1 : 0)),
    carry: p.melee ? q.sustained * 0.5 : q.sustained, // wants to be kept alive and fed
    duel: Math.min(1, (p.melee ? 0.3 : 0) + q.sustained * 0.35 + q.tank * 0.25 + (has((e) => e.kind === 'heal' && e.target === 'self' || e.kind === 'lifesteal') ? 0.15 : 0) - protect * 0.3),
    sustain: Math.min(1, toAllies(['heal']) * 0.4 + (has((e) => (e.kind === 'heal' && e.target === 'self') || e.kind === 'lifesteal') ? 0.3 : 0)),
    antiHeal: has((e) => e.kind === 'antiHeal') ? 1 : 0,
    cleanse: has((e) => e.kind === 'cleanse' || e.kind === 'ccImmune') ? 1 : 0,
    evasive: has((e) => e.kind === 'untargetable' || e.kind === 'stealth') ? 1 : 0,
    shred: has((e) => e.kind === 'armorDown' || e.kind === 'mrDown' || e.kind === 'dmgAmp') ? 1 : 0,
    magic: p.magicShare,
  };
  return t;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const top = (xs, n) => xs.slice().sort((a, b) => b - a).slice(0, n);

// raw composition scores for a list of picks (missing champions are skipped)
export function rawComps(T, picks) {
  const ts = picks.map((c) => T[c]).filter(Boolean);
  if (!ts.length) return null;
  const s = (k) => sum(ts.map((t) => t[k]));
  const best = (k, n = 1) => sum(top(ts.map((t) => t[k]), n));
  const carry = best('carry');
  return {
    dive: best('dive', 3) + 0.5 * s('engage') + 0.3 * best('burst', 2),
    poke: best('poke', 3) + 0.4 * s('peel') - 0.3 * s('engage') * 0.3,
    pick: best('catch', 2) + 0.6 * best('burst', 2) + 0.3 * s('evasive'),
    protect: carry * (1 + s('protect') + 0.5 * s('peel')) + 0.3 * s('frontline'),
    teamfight: s('areaCC') * 0.6 + s('aoe') * 0.5 + 0.3 * best('frontline'),
    split: best('duel') * 1.5 + 0.3 * s('peel') + 0.2 * best('poke'),
    // pieces
    frontline: best('frontline'), engage: best('engage'), peel: s('peel'), protectN: s('protect'),
    magic: s('magic') / ts.length, sustain: s('sustain'), antiHeal: s('antiHeal'), cleanse: s('cleanse'), shred: s('shred'),
    diveThreat: sum(top(ts.map((t) => t.dive), 2)), carryN: ts.filter((t) => t.carry > 0.6).length,
  };
}

// Traits for every champion, and the mean and spread of each score over the pro drafts.
export function compModel(m) {
  const P = profilesFor(m); if (!P) return null;
  if (m._comp && m._comp.P === P) return m._comp;
  const E = allEffects(m.kits);
  const T = {}; for (const c of Object.keys(P)) T[c] = traitsOf(P[c], E[c] || []);
  const rows = []; for (const g of m.games || []) for (const s of [0, 1]) { const r = rawComps(T, g.picks[s]); if (r) rows.push(r); }
  const norm = {};
  for (const k of rows.length ? Object.keys(rows[0]) : []) {
    const v = rows.map((r) => r[k]); const mu = sum(v) / v.length; const sd = Math.sqrt(sum(v.map((x) => (x - mu) ** 2)) / v.length) || 1;
    norm[k] = { mu, sd };
  }
  const cm = { P, E, T, norm };
  // pro record of each main style against each other
  const mm = {};
  for (const g of m.games || []) {
    const a = teamComp(cm, g.picks[0]), b = teamComp(cm, g.picks[1]); if (!a || !b || a.main === b.main) continue;
    for (const [x, y, won] of [[a.main, b.main, g.winner === 0], [b.main, a.main, g.winner === 1]]) { const v = (mm[x + '>' + y] ||= { g: 0, w: 0 }); v.g++; if (won) v.w++; }
  }
  cm.mm = mm;
  m._comp = cm;
  return m._comp;
}

// Standardised composition of a draft: { scores: {dive: z, ...}, main, second, raw }
export function teamComp(cm, picks) {
  const raw = rawComps(cm.T, picks); if (!raw) return null;
  const z = (k) => (raw[k] - (cm.norm[k]?.mu ?? 0)) / (cm.norm[k]?.sd || 1);
  const scores = Object.fromEntries(COMP_KEYS.map((k) => [k, z(k)]));
  const order = COMP_KEYS.slice().sort((a, b) => scores[b] - scores[a]);
  return { scores, main: order[0], second: order[1], raw, z };
}

// What a draft is missing, in plain words. them is the enemy teamComp, or null.
export function missingPieces(us, them) {
  if (!us) return [];
  const out = [];
  const r = us.raw;
  if (r.frontline < 0.35) out.push({ key: 'noFront', text: 'No real frontline: nobody to soak damage or hold the line' });
  if (r.engage < 0.55) out.push({ key: 'noEngage', text: 'No reliable way to start a fight' });
  if (r.magic < 0.15) out.push({ key: 'allPhys', text: 'Almost all physical damage, so one armor item stacks well against you' });
  if (r.magic > 0.75) out.push({ key: 'allMagic', text: 'Almost all magic damage, so magic resist stacks well against you' });
  if (them && them.raw.diveThreat > 1.1 && r.peel < 1) out.push({ key: 'noPeel', text: 'Little peel against their divers' });
  if (them && them.raw.sustain > 1 && r.antiHeal === 0) out.push({ key: 'noAntiHeal', text: 'No healing cut against their healing' });
  return out;
}

// One sentence on how a draft wins, from its main style and its timing.
export function winCondition(tc, late = 0) {
  if (!tc) return '';
  const when = late > 0.02 ? ' Your champions do better in long games, so there is no rush.' : late < -0.02 ? ' Your champions do better in short games, so force it before they scale.' : '';
  return `${COMPS[tc.main].name}: ${COMPS[tc.main].blurb}. Backup plan: ${COMPS[tc.second].name.toLowerCase()}.${when}`;
}

// Range matchups. Being out-ranged is a problem when you cannot close the gap: the longer-range
// side hits for free, and the shorter side has to walk in under fire.
// usByRole / themByRole: champion ids in role order (Top, Jungle, Mid, Bottom, Support), null when unknown.
// Returns lanes [{ role, gap, answer, penalty }] and a team-level value.
export const RANGE_GAP = 15; // range units; a melee champion has about 20, a long-range one 60 to 80
export function rangeMatchups(cm, usByRole, themByRole) {
  const P = cm.P, T = cm.T;
  const lane = (r) => {
    const a = usByRole[r], b = themByRole[r]; if (!a || !b || !P[a] || !P[b]) return null;
    const gap = P[b].range - P[a].range; // positive: they out-range you
    const answer = Math.max(T[a].engage, T[a].dive); // can you get onto them?
    const penalty = gap > RANGE_GAP ? Math.min(1, (gap - RANGE_GAP) / 40) * (1 - answer) : 0;
    const edge = -gap > RANGE_GAP ? Math.min(1, (-gap - RANGE_GAP) / 40) * (1 - Math.max(T[b].engage, T[b].dive)) : 0;
    return { role: r, a, b, gap, answer, penalty, edge };
  };
  // the lanes that farm in a 1v1 or 2v2 (jungle is left out)
  const lanes = [0, 2, 3, 4].map(lane).filter(Boolean);
  // team level: their longest reach against how well you can start a fight on them
  const reach = (ids) => top(ids.filter((c) => P[c]).map((c) => P[c].range), 2);
  const usR = reach(usByRole.filter(Boolean)), themR = reach(themByRole.filter(Boolean));
  const usEngage = sum(top(usByRole.filter((c) => T[c]).map((c) => Math.max(T[c].engage, T[c].dive)), 2)) / 2;
  const themEngage = sum(top(themByRole.filter((c) => T[c]).map((c) => Math.max(T[c].engage, T[c].dive)), 2)) / 2;
  const teamGap = (sum(themR) - sum(usR)) / 2;
  const team = (teamGap > RANGE_GAP ? Math.min(1, (teamGap - RANGE_GAP) / 40) * (1 - usEngage) : 0)
    - (-teamGap > RANGE_GAP ? Math.min(1, (-teamGap - RANGE_GAP) / 40) * (1 - themEngage) : 0);
  const laneNet = sum(lanes.map((l) => l.penalty - l.edge));
  return { lanes, team, laneNet, teamGap, usEngage, themEngage };
}

// Finer champion types than the broad patterns: a champion can be several, best fit first.
export const TYPES = {
  engageTank: { name: 'Engage tank', blurb: 'tough, and starts fights by jumping in with crowd control' },
  peelTank: { name: 'Peel tank', blurb: 'tough, and keeps enemies off the backline' },
  juggernaut: { name: 'Juggernaut', blurb: 'tough melee that keeps dealing damage once it reaches you' },
  skirmisher: { name: 'Skirmisher', blurb: 'wins short duels and side lanes on its own' },
  assassin: { name: 'Assassin', blurb: 'gets onto one target and deletes it' },
  hypercarry: { name: 'Hypercarry', blurb: 'steady damage from range that grows with gold and protection' },
  utilityCarry: { name: 'Utility carry', blurb: 'ranged damage that also slows, catches or peels' },
  burstMage: { name: 'Burst mage', blurb: 'big magic damage in one rotation' },
  battleMage: { name: 'Battle mage', blurb: 'magic damage over a long fight up close' },
  artillery: { name: 'Artillery', blurb: 'hits from far away and zones an area' },
  enchanter: { name: 'Enchanter', blurb: 'heals, shields and buffs allies' },
  catcher: { name: 'Catcher', blurb: 'locks down one enemy so the team can collapse' },
  controller: { name: 'Area controller', blurb: 'locks down several enemies at once' },
  summoner: { name: 'Summoner', blurb: 'fights with summoned units' },
  evasive: { name: 'Slippery', blurb: 'can dodge damage by going untargetable or hidden' },
  sustain: { name: 'Self-healer', blurb: 'heals itself through long fights' },
};
export function typesOf(t, es, p) {
  if (!t) return [];
  const melee = p?.melee; const magic = t.magic > 0.45;
  const areaHard = es.filter((e) => HARD.has(e.kind) && e.target === 'enemies').length;
  const s = {
    engageTank: t.frontline > 0.55 && t.engage > 0.6 ? t.frontline + t.engage : 0,
    peelTank: t.frontline > 0.55 && t.peel > 0.35 ? t.frontline + t.peel : 0,
    juggernaut: melee && t.frontline > 0.4 && t.dps > 0.55 ? t.frontline + t.dps : 0,
    skirmisher: t.duel > 0.6 && t.engage > 0.4 && t.frontline < 0.6 ? t.duel + 0.5 : 0,
    assassin: t.dive > 0.7 && t.burst > 0.6 && t.frontline < 0.55 ? t.dive + t.burst : 0,
    hypercarry: !melee && t.carry > 0.7 && t.protect < 0.4 ? t.carry * 2 : 0,
    utilityCarry: !melee && t.carry > 0.45 && (t.catch > 0 || t.peel > 0.3) ? t.carry + t.peel : 0,
    burstMage: magic && !melee && t.burst > 0.6 ? t.burst * 2 : 0,
    battleMage: magic && t.dps > 0.5 && (melee || t.aoe > 0.6) ? t.dps + t.aoe : 0,
    artillery: t.poke > 0.78 ? t.poke * 2 : 0,
    enchanter: t.protect > 0.55 ? t.protect * 2 : 0,
    catcher: t.catch > 0.6 ? t.catch * 2 : 0,
    controller: areaHard >= 2 ? 1 + areaHard * 0.3 : 0,
    summoner: es.some((e) => e.kind === 'summon') ? 1.2 : 0,
    evasive: t.evasive ? 1 : 0,
    sustain: t.sustain > 0.25 && t.protect < 0.4 ? 0.9 + t.sustain : 0,
  };
  const out = Object.entries(s).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  if (!out.length) out.push({ frontline: 'peelTank', diver: 'assassin', backline: 'hypercarry', poke: 'artillery', bruiser: 'skirmisher', enchanter: 'enchanter', control: 'catcher' }[p?.role?.[0]] || 'hypercarry');
  if (melee && (out[0] === 'hypercarry' || out[0] === 'artillery')) out[0] = 'skirmisher';
  return out;
}
