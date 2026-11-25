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
// when the enemy has divers that reach the backline. Slots are then ordered greedily: each
// slot takes the item that adds the most at that point.
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
  if (!m.has(key)) { const bonus = addStats(items, lines); m.set(key, { bonus, p: profileOf(kit, { level: ITEM_LEVEL, bonus, smooth: true }) }); }
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

export function buildScore({ kits, items, profiles }, c, lines, threat) {
  const prof = profiles?.[c];
  let a = OFFENSE_WEIGHT[prof?.role?.[0]] ?? 0.5;
  if (prof && (prof.role[0] === 'backline' || prof.role[0] === 'poke')) a -= 0.05 * threat.divers;
  a = Math.max(0.2, Math.min(0.8, a));
  return evaluate(kits[c], prof, items, lines, threat, a).score;
}
export { COMBOS };

// Best builds for champion c against the enemy picks.
// Returns { builds: [{ slots, score, steps: [{ line, offenseGain, survivalGain }] }], threat, a }
export function mathBuilds({ kits, items, profiles }, c, enemy, n = 3) {
  const kit = kits?.[c]; if (!kit || !items) return null;
  const prof = profiles?.[c];
  const threat = enemyThreat(kits, profiles, enemy);
  let a = OFFENSE_WEIGHT[prof?.role?.[0]] ?? 0.5;
  if (prof && (prof.role[0] === 'backline' || prof.role[0] === 'poke')) a -= 0.05 * threat.divers;
  a = Math.max(0.2, Math.min(0.8, a));
  const scored = COMBOS.map((lines) => ({ lines, ...evaluate(kit, prof, items, lines, threat, a) })).sort((x, y) => y.score - x.score);
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
  return { builds, threat, a, base };
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
