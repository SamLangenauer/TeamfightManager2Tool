// Item builds worked out from damage and survival math, not from popularity.
//
// For a champion against a known enemy draft, every possible build (four slots, each one
// of the six item lines at full tier, repeats allowed: 126 combinations) is scored by:
//   offense: damage the kit deals in a 10 s fight with the item stats, after the enemy's
//            average armor and magic resist (and penetration); for champions that heal or
//            shield allies, that output counts too.
//   survival: health divided by the share of the enemy's actual damage that gets through:
//            their physical/magic/true split and how much comes from basic attacks vs
//            abilities, against armor, magic resist and the items' damage reductions.
// score = a·ln(offense) + (1 − a)·ln(survival), where a depends on how the champion plays
// (a frontline values survival, a backline carry values damage) and shifts toward survival
// when the enemy has divers that reach the backline or a pick draft, and a little for everyone against poke. Slots are then ordered greedily: each
// slot takes the item that adds the most at that point.
//
// Damage lines are limited first to the ones that fit the champion (offenseFit). The game data
// gives most mages a plain physical basic attack, and the fight math cannot see damage that
// comes from summons or effects the descriptions leave unnumbered, so on its own it can put
// AD and Attack Speed on a champion whose power is its abilities. With enough pro games, the
// damage lines are the ones pros actually build on it (builds barely change pro win rates, so
// their habits are a safe anchor); without them, the ones its kit scales with. Defensive lines
// are always open: matching the enemy's damage is what the math is for.
import { profileOf } from './profile.js';

export const ITEM_LEVEL = 10; // full builds are a late-game question
export const LINE_NAMES = ['AD', 'Attack Speed', 'Defense', 'Magic Resist', 'Magic', 'HP'];
const OFFENSE_WEIGHT = { frontline: 0.3, control: 0.4, enchanter: 0.4, bruiser: 0.5, diver: 0.6, backline: 0.65, poke: 0.65 };

// all multisets of 4 lines from 6, as sorted arrays
const COMBOS = (() => { const out = []; for (let a = 0; a < 6; a++) for (let b = a; b < 6; b++) for (let c = b; c < 6; c++) for (let d = c; d < 6; d++) out.push([a, b, c, d]); return out; })();

function addStats(items, lines) {
  const s = {};
  for (const l of lines) for (const [k, v] of Object.entries(items?.[l]?.tiers?.[4] || {})) s[k] = (s[k] || 0) + v;
  return s;
}

// What the enemy draft throws at you: damage by type and source, and their defenses.
export function enemyThreat(kits, profiles, enemy) {
  const t = { aa: 0, phys: 0, magic: 0, true: 0, armor: 0, mr: 0, n: 0, hardCC: 0, divers: 0 };
  for (const c of enemy) {
    const k = kits[c]; if (!k) continue;
    const { p } = profileWith(k, null, []);
    t.aa += p.aaDmg; t.phys += p.skillDmg.phys; t.magic += p.skillDmg.magic; t.true += p.skillDmg.true;
    t.armor += p.stats.defence; t.mr += p.stats.magic_resistance; t.n++; t.hardCC += p.hardCC;
    if (profiles?.[c]?.role?.includes('diver')) t.divers++;
  }
  if (t.n) { t.armor /= t.n; t.mr /= t.n; }
  t.total = t.aa + t.phys + t.magic + t.true;
  t.physShare = t.total ? (t.aa + t.phys) / t.total : 0.5;
  t.magicShare = t.total ? t.magic / t.total : 0.5;
  t.aaShare = t.total ? t.aa / t.total : 0.3;
  return t;
}

// profiles depend only on the kit and the items, so keep them
const memo = new WeakMap();
function profileWith(kit, items, lines) {
  let m = memo.get(kit); if (!m) { m = new Map(); memo.set(kit, m); }
  const key = (lines.length && items ? '' : 'base') + lines.slice().sort().join('');
  if (m.itemsRef !== items && lines.length) { m.clear(); m.itemsRef = items; }
  if (!m.has(key)) { const bonus = addStats(items, lines); m.set(key, { bonus, p: profileOf(kit, { level: ITEM_LEVEL, bonus, smooth: true, assumeRatio: true }) }); }
  return m.get(key);
}

function evaluate(kit, prof, items, lines, threat, a) {
  const { bonus, p } = profileWith(kit, items, lines);
  const arm = Math.max(0, threat.armor - (bonus.defence_penetration || 0));
  const mr = Math.max(0, threat.mr - (bonus.magic_resistance_penetration || 0));
  const dealt = p.dmg.phys * 100 / (100 + arm) + p.dmg.magic * 100 / (100 + mr) + p.dmg.true;
  const support = prof && (prof.healAllies || prof.shieldAllies) ? p.heal + Math.max(0, p.shield - 1) : 0;
  const ccPressure = Math.min(1, threat.hardCC / 6);
  const offense = (dealt + support) / 10 * (1 + (bonus.toughness || 0) / 100 * ccPressure * 0.5);
  // share of the enemy's damage that gets through
  const st = p.stats; const total = threat.total || 1;
  const baRed = 1 - (bonus.base_attack_damaged_reduce || 0) / 100, skRed = 1 - (bonus.skill_damaged_reduce || 0) / 100;
  const through = (threat.aa * 100 / (100 + st.defence) * baRed
    + threat.phys * 100 / (100 + st.defence) * skRed
    + threat.magic * 100 / (100 + st.magic_resistance) * skRed
    + threat.true * skRed) / total;
  const vampHeal = (bonus.vamp || 0) / 100 * dealt;
  const survival = (st.hp + vampHeal) / Math.max(0.05, through);
  return { score: a * Math.log(Math.max(1, offense)) + (1 - a) * Math.log(Math.max(1, survival)), offense, survival, through };
}

// How much a champion's build leans to damage (a) rather than survival (1 - a). Against divers or a
// pick draft, backline champions lean to survival; against a poke draft, everyone does a little.
function weightFor(prof, threat, enemyComp) {
  let a = OFFENSE_WEIGHT[prof?.role?.[0]] ?? 0.5;
  const back = prof && (prof.role[0] === 'backline' || prof.role[0] === 'poke');
  if (back) a -= 0.05 * threat.divers;
  if (enemyComp) {
    if (back && enemyComp.pick > 0.5) a -= 0.05;
    if (enemyComp.poke > 0.5) a -= 0.03;
  }
  return Math.max(0.2, Math.min(0.8, a));
}

export function buildScore({ kits, items, profiles, enemyComp }, c, lines, threat) {
  const prof = profiles?.[c];
  return evaluate(kits[c], prof, items, lines, threat, weightFor(prof, threat, enemyComp)).score;
}
export { COMBOS };

const OFFENSE = [0, 1, 4]; // AD, Attack Speed, Magic
export const PRO_MIN_BUILDS = 15; // pro builds needed before pro habits decide the damage lines
const PRO_MIN_SHARE = 0.08; // a damage line pros put in fewer slots than this is left out

// Which damage lines suit champion c. pro: { n, slots: [count per line] } from pro builds;
// champ: the champion's row (cat, tags). Returns { lines: Set, source, why }.
export function offenseFit(kit, champ, pro) {
  const lines = new Set([2, 3, 5]);
  if (pro && pro.n >= PRO_MIN_BUILDS) {
    const tot = pro.slots.reduce((a, b) => a + b, 0) || 1;
    const share = pro.slots.map((v) => v / tot);
    for (const l of OFFENSE) if (share[l] >= PRO_MIN_SHARE) lines.add(l);
    const used = OFFENSE.filter((l) => lines.has(l)), cut = OFFENSE.filter((l) => !lines.has(l));
    const pc = (l) => `${LINE_NAMES[l]} ${Math.round(share[l] * 100)}%`;
    // as many damage items as pros usually carry; the math picks which, and the defensive rest
    const offSlots = Math.round(4 * used.reduce((t, l) => t + share[l], 0));
    const why = `Pros put ${offSlots} damage item${offSlots === 1 ? '' : 's'} on it (${pro.n} builds: ${OFFENSE.map(pc).join(', ')} of slots)${cut.length ? `, so no ${cut.map((l) => LINE_NAMES[l]).join(' or ')}` : ''}. The other slots answer their damage.`;
    return { lines, source: 'pro', why, share, offSlots };
  }
  const { p } = profileWith(kit, null, []);
  const tags = champ?.tags || [];
  const apOnly = tags.includes('AP') && !tags.includes('AD');
  const adOnly = tags.includes('AD') && !tags.includes('AP');
  const aaShare = p.aaDmg / Math.max(1, p.aaDmg + p.skillOut);
  const out = p.skillOut || 1;
  const adSkill = p.scale.ad / out >= 0.25 || p.mentions.ad > p.mentions.ap;
  const apSkill = p.scale.ap / out >= 0.25 || (p.mentions.ap > 0 && p.mentions.ap >= p.mentions.ad);
  const autos = !apOnly && (aaShare >= 0.5 || (p.aaBuff && aaShare >= 0.35));
  if (autos) { lines.add(0); lines.add(1); }
  if (adSkill && !apOnly) lines.add(0);
  if (apSkill && !adOnly) lines.add(4);
  if (p.dmg.magic > p.dmg.phys && !adOnly) lines.add(4);
  if (tags.includes('AP')) lines.add(4);
  if (!OFFENSE.some((l) => lines.has(l))) lines.add(apOnly ? 4 : 0);
  const cut = OFFENSE.filter((l) => !lines.has(l));
  const why = `Few pro builds, so damage items follow the kit: basic attacks are about ${Math.round(aaShare * 100)}% of its damage${apSkill ? ', abilities scale with Ability Power' : adSkill ? ', abilities scale with Attack Damage' : ''}${cut.length ? `, so no ${cut.map((l) => LINE_NAMES[l]).join(' or ')}` : ''}.`;
  return { lines, source: 'kit', why, aaShare };
}

// Pro build counts per line for champion c, from planStats(m).champ[c].
export function proLines(x) {
  if (!x?.builds?.size) return null;
  const slots = [0, 0, 0, 0, 0, 0]; let n = 0;
  for (const [key, [g]] of x.builds) { n += g; for (const l of key.split('-')) if (slots[+l] != null) slots[+l] += g; }
  return { n, slots };
}

// Best builds for champion c against the enemy picks.
// Returns { builds: [{ slots, score, steps: [{ line, offenseGain, survivalGain }] }], threat, a, fit }
export function mathBuilds({ kits, items, profiles, enemyComp, champs, pro }, c, enemy, n = 3) {
  const kit = kits?.[c]; if (!kit || !items) return null;
  const prof = profiles?.[c];
  const threat = enemyThreat(kits, profiles, enemy);
  const a = weightFor(prof, threat, enemyComp);
  const fit = offenseFit(kit, champs?.[c], pro?.(c));
  const offCount = (lines) => lines.filter((l) => OFFENSE.includes(l)).length;
  // with pro data, carry as many damage items as pros do; from the kit, at least one unless it is a frontliner
  const minOff = fit.offSlots ?? (prof?.role?.[0] === 'frontline' || !OFFENSE.some((l) => fit.lines.has(l)) ? 0 : 1);
  const ok = (lines) => lines.every((l) => fit.lines.has(l)) && (fit.offSlots != null ? offCount(lines) === fit.offSlots : offCount(lines) >= minOff);
  const scored = COMBOS.filter(ok).map((lines) => ({ lines, ...evaluate(kit, prof, items, lines, threat, a) })).sort((x, y) => y.score - x.score);
  const base = evaluate(kit, prof, items, [], threat, a);
  const builds = scored.slice(0, n).map((b) => {
    // order the slots: each slot takes the remaining item that adds the most now
    const left = b.lines.slice(); const chosen = []; const steps = []; let prev = base;
    while (left.length) {
      let best = null;
      for (const [i, l] of left.entries()) { const e = evaluate(kit, prof, items, [...chosen, l], threat, a); if (!best || e.score > best.e.score) best = { i, l, e }; }
      steps.push({ line: best.l, offenseGain: best.e.offense / prev.offense - 1, survivalGain: best.e.survival / prev.survival - 1 });
      chosen.push(best.l); left.splice(best.i, 1); prev = best.e;
    }
    return { slots: chosen, score: b.score, offense: b.offense, survival: b.survival, steps };
  });
  return { builds, threat, a, base, fit };
}

// One plain sentence for a slot, from what it added at that point.
export function stepReason(step, threat) {
  const pc = (x) => `${Math.round(x * 100)}%`;
  const off = step.offenseGain, sur = step.survivalGain;
  const what = {
    0: 'more damage from Attack Damage scaling, and life steal',
    1: 'more damage from faster basic attacks',
    2: `takes less of their physical damage (${pc(threat.physShare)} of what they deal${threat.aaShare > 0.4 ? ', much of it basic attacks' : ''})`,
    3: `takes less of their magic damage (${pc(threat.magicShare)} of what they deal)`,
    4: 'more damage and ability output from Ability Power',
    5: 'more health against everything they deal',
  }[step.line];
  const nums = [off > 0.005 ? `+${pc(off)} damage` : null, sur > 0.005 ? `+${pc(sur)} survival` : null].filter(Boolean).join(', ');
  return `${LINE_NAMES[step.line]}: ${what}${nums ? ` (${nums})` : ''}`;
}
