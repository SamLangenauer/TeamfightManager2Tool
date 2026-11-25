// Kit profiles: what each champion's abilities actually do, read from its kit.
// Every number here comes from the kit (base values, before balance patches) at a
// reference level, so champions can be compared on the same footing.
import { fillText, actionFor } from './kits.js';

export const REF_LEVEL = 6; // compare champions mid-game: base stats plus 5 levels of growth
const SLOTS = ['skill', 'skill2', 'ult'];
const HARD = { stun: 'stun', sleep: 'sleep', airborne: 'airborne', knock: 'knockback', taunt: 'taunt', root: 'root', bind: 'root', pull: 'pull', fear: 'fear', charm: 'charm', silence: 'silence', suppress: 'suppress', freez: 'stun' };

// Stats at a level, plus any bonus (items): attack, magic_power, hp, defence, magic_resistance.
export function statsAt(kit, level = REF_LEVEL, bonus = {}) {
  const s = {}; const g = kit.growth || {};
  for (const k of ['attack', 'magic_power', 'hp', 'defence', 'magic_resistance', 'move_speed']) s[k] = (kit.stat?.[k] || 0) + (g[k] || 0) * (level - 1) + (bonus[k] || 0);
  return s;
}
export const AOE_TARGETS = 1; // enemies an area ability is counted as hitting; season damage stats fit best at 1
export const CRIT_MULT = 1.5; // the game files do not give the critical hit multiplier; 1.5 is assumed
const words = { two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6 };

// Damage, heal and shield amounts written as "[type]flat[/] + [type]ratio% Stat[/]",
// or a ratio alone ("[phys]200% Attack Damage[/] as physical damage").
const STAT = '(?:of )?(Attack Damage|AD|Attack|Ability Power|AP|Magic Power|maximum health)';
const statBase = (name, st) => (/^(Attack Damage|AD|Attack)$/.test(name) ? st.attack : /^(Ability Power|AP|Magic Power)$/.test(name) ? st.magic_power : st.hp);
function amounts(text, st) {
  const out = [];
  const classify = (kind, after) => {
    if (kind !== 'phys' && kind !== 'magic' && kind !== 'hp' && kind !== 'shield') {
      kind = /physical damage/.test(after) ? 'phys' : /magic damage/.test(after) ? 'magic' : /true damage/i.test(after) ? 'true' : kind;
    }
    if (kind === 'hp' && !/damage/.test(after.slice(0, 25))) kind = 'heal';
    if ((kind === 'phys' || kind === 'magic') && /^\s*\[hp\]health/.test(after)) kind = 'heal';
    return kind;
  };
  const pair = new RegExp(String.raw`\[(\w+)\](?:[a-z]+ )?([\d.]+)\[\/\]\s*\+\s*\[(\w+)\](?:([\d.]+)|\{\?\w+\})% ${STAT}\[\/\]`, 'g');
  let m; let masked = text;
  while ((m = pair.exec(text))) {
    const after = text.slice(pair.lastIndex, pair.lastIndex + 60);
    out.push({ kind: classify(m[1], after), value: +m[2] + (m[4] != null ? +m[4] : 0) / 100 * statBase(m[5], st), at: m.index });
    masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  }
  const lone = new RegExp(String.raw`\[(phys|magic)\]([\d.]+)% ${STAT}\[\/\](?=\s*(?:as\s*)?\[(?:phys|magic)\](?:physical|magic) damage)`, 'g');
  while ((m = lone.exec(masked))) out.push({ kind: m[1], value: +m[2] / 100 * statBase(m[3], st), at: m.index });
  // flat heals written in words: "[hp]restoring 60 health[/]"
  const flatHeal = /\[hp\](?:restor\w*|heal\w*|recover\w*) (?:for )?([\d.]+) health\[\/\]/g;
  while ((m = flatHeal.exec(masked))) out.push({ kind: 'heal', value: +m[1], at: m.index });
  return out;
}

// How many times an ability's damage lands per cast.
function hits(text, action) {
  const n = action?.attack_count || action?.hit_count || action?.shot_count || action?.projectile_count;
  if (n > 1 && n < 20) return n;
  const w = text.match(/\b(two|twice|three|four|five|six) (times|consecutive|shots|hits|attacks)/);
  if (w) return words[w[1]];
  const k = text.match(/(?:\[num\])?(\d+)(?:\[\/\])? (shells|projectiles|arrows|bullets|missiles|strikes|hits|times|blades|daggers|bolts)/);
  if (k && +k[1] > 1 && +k[1] < 20) return +k[1];
  const every = text.match(/for (?:\[\w+\])?([\d.]+)s(?:\[\/\])?[^.]*every ([\d.]+)s/) || text.match(/every ([\d.]+)s[^.]*for (?:\[\w+\])?([\d.]+)s/);
  if (every) {
    const [a, b] = text.indexOf('every') < text.indexOf('for ') ? [+every[2], +every[1]] : [+every[1], +every[2]];
    if (a > 0 && b > 0) return Math.min(20, Math.max(1, Math.round(a / b)));
  }
  return 1;
}

function basicAttack(kit, st, bonus = {}) {
  const a = kit.attack || {};
  const dmg = { phys: 0, magic: 0 };
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (x.type === 'Attack') dmg.phys += (x.damage || 0) + (x.attack_ratio || 0) / 100 * st.attack;
    else if (x.type === 'ApAttack') dmg.magic += (x.damage || 0) + (x.attack_ratio || 0) / 100 * st.magic_power;
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  };
  walk(a.effect);
  // simple attacks put their numbers on the action itself; in this game they are physical
  if (!dmg.phys && !dmg.magic) dmg.phys = (a.attack || 0) + (a.attack_ratio ?? 100) / 100 * st.attack;
  const cd = (a.cooltime || 60) / 60 / (1 + (bonus.attack_speed_mult || 0) / 100);
  const crit = 1 + (bonus.crit_chance || 0) / 100 * (CRIT_MULT - 1);
  return { phys: dmg.phys * crit / cd, magic: dmg.magic * crit / cd, dps: (dmg.phys + dmg.magic) * crit / cd, range: (a.range || 0) / 1000 };
}

// opts.level and opts.bonus (item stats, including attack_speed_mult, crit_chance and
// skill_cooldown_mult) let the item math reuse this; opts.smooth counts partial casts.
export function profileOf(kit, opts = {}) {
  const bonus = opts.bonus || {};
  const st = statsAt(kit, opts.level || REF_LEVEL, bonus);
  const aa = basicAttack(kit, st, bonus);
  const cdMult = 1 - Math.min(40, bonus.skill_cooldown_mult || 0) / 100;
  const p = {
    dmg: { phys: 0, magic: 0, true: 0 }, // estimated damage over a 10 s fight
    burst: 0, sustained: 0, heal: 0, healAllies: false, shield: 0, shieldAllies: false, buffAllies: false,
    cc: {}, hardCC: 0, mobility: 0, aoe: 0, untargetable: false, stealth: false, range: aa.range,
    ehpPhys: st.hp * (1 + st.defence / 100), ehpMagic: st.hp * (1 + st.magic_resistance / 100),
    abilities: {}, stats: st, aaDmg: aa.dps * 10, skillDmg: { phys: 0, magic: 0, true: 0 },
  };
  // basic attacks over 10 s, as a share of the fight they keep landing
  p.sustained += aa.dps; p.dmg.phys += aa.phys * 10; p.dmg.magic += aa.magic * 10;
  for (const slot of SLOTS) {
    const text = fillText(kit, slot); const action = actionFor(kit, slot);
    if (!text && !action) continue;
    const cd = (action?.cooltime || 0) / 60 * cdMult;
    const am = amounts(text, st); const n = hits(text, action);
    const plain = text.replace(/\[\/?\w*\]/g, '').toLowerCase();
    // area abilities usually catch more than one enemy in a teamfight
    const targets = /\b(all enemies|enemies within|enemies in|enemies hit|nearby enemies|in a cone|area|field)\b/.test(plain) && !/split between/.test(plain) ? AOE_TARGETS : 1;
    // casts in a 10 s fight: at least one, more for short cooldowns (ultimates once)
    const casts = slot === 'ult' || !cd ? 1 : opts.smooth ? Math.max(1, 10 / cd) : Math.max(1, Math.floor(10 / cd));
    let dmg = 0; const ab = { cd, dmg: 0, kind: null };
    for (const x of am) {
      if (x.kind === 'phys' || x.kind === 'magic' || x.kind === 'true') {
        const v = x.value * n; dmg += v; ab.kind = ab.kind && ab.kind !== x.kind ? 'mixed' : x.kind;
        p.dmg[x.kind] += v * casts * targets; p.skillDmg[x.kind] += v * casts * targets;
      } else if (x.kind === 'heal') p.heal += x.value * (/every/.test(text) ? n : 1) * casts;
      else if (x.kind === 'shield') p.shield += x.value;
    }
    // life steal on the ability: "healing for 10% of the damage dealt"
    const ls = text.match(/heal\w* (?:for )?([\d.]+)% of (?:the )?damage/);
    if (ls) p.heal += +ls[1] / 100 * dmg * casts;
    ab.dmg = dmg; p.burst += dmg;
    if (cd && slot !== 'ult') p.sustained += dmg / cd;
    const lower = text.replace(/\[\/?\w*\]/g, '').toLowerCase();
    if (/all(y|ies)\b/.test(lower) && /\bheal(s|ing|ed)?\b|restor/.test(lower)) p.healAllies = true;
    if (/all(y|ies)\b/.test(lower) && /shield/.test(lower)) p.shieldAllies = true;
    if (/all(y|ies|ied)\b/.test(lower) && /(increas|grant|gain|boost)\w*[^.]*(attack|ability power|speed|damage|range|armor|resist)/.test(lower)) p.buffAllies = true;
    if (/\[shield\]/.test(text) && !am.some((x) => x.kind === 'shield')) p.shield += 1; // a shield whose size the text does not give
    // crowd control: words in the game's crowd-control colour
    for (const m of text.matchAll(/\[cc\](.*?)\[\/\]/g)) {
      const t = m[1].toLowerCase();
      for (const [w, name] of Object.entries(HARD)) if (t.includes(w)) {
        p.cc[name] = (p.cc[name] || 0) + 1;
        const dur = (text.slice(m.index, m.index + 120).match(/for (?:\[\w+\])?([\d.]+)\s?(?:s\b|seconds)/) || [])[1];
        p.hardCC += dur ? Math.min(+dur, 3) : 0.75;
      }
      if (/slow/.test(t)) p.cc.slow = (p.cc.slow || 0) + 1;
    }
    if (/\b(charges?|dash(es)?|leaps?|jumps?|teleports?|blinks?|rushes|lunges?)\b/.test(lower)) p.mobility++;
    if (/untargetable/.test(lower)) p.untargetable = true;
    if (/invisib|stealth|camouflag/.test(lower)) p.stealth = true;
    if (/\b(all enemies|enemies within|enemies in|enemies hit|nearby enemies|in a cone|area|field)\b/.test(lower) && dmg > 0) p.aoe += dmg;
    p.abilities[slot] = ab;
  }
  const tot = p.dmg.phys + p.dmg.magic + p.dmg.true;
  p.dmgTotal = tot;
  if (kit.passive?.vamp) p.heal += kit.passive.vamp / 100 * tot;
  p.magicShare = tot ? p.dmg.magic / tot : 0;
  p.aoeShare = p.burst ? p.aoe / p.burst : 0;
  p.melee = p.range < 35;
  return p;
}

// Profiles for every champion, plus where each stands against the rest (0 to 1).
export function buildProfiles(kits) {
  const out = {};
  for (const [c, k] of Object.entries(kits || {})) out[c] = profileOf(k);
  const ids = Object.keys(out);
  const rank = (f) => { const v = ids.map((c) => [c, f(out[c])]).sort((a, b) => a[1] - b[1]); v.forEach(([c], i) => { (out[c].pct ||= {})[f.key] = ids.length > 1 ? i / (ids.length - 1) : 0.5; }); };
  const keyed = (key, f) => Object.assign(f, { key });
  for (const f of [keyed('burst', (p) => p.burst), keyed('sustained', (p) => p.sustained), keyed('tank', (p) => (p.ehpPhys + p.ehpMagic) / 2 + p.shield),
    keyed('cc', (p) => p.hardCC), keyed('aoe', (p) => p.aoe), keyed('range', (p) => p.range), keyed('support', (p) => (p.healAllies ? 100 + p.heal : 0) + (p.shieldAllies ? 100 + p.shield : 0) + (p.buffAllies ? 80 : 0))]) rank(f);
  for (const p of Object.values(out)) { p.role = rolePattern(p); p.threats = threats(p); }
  return out;
}

// One main pattern per champion, from where it stands on each axis.
export const PATTERNS = {
  frontline: 'Frontline: soaks damage and holds the line',
  diver: 'Diver: closes the gap and bursts a target',
  backline: 'Backline carry: steady damage from range',
  poke: 'Poke and zone: area damage from distance',
  bruiser: 'Bruiser: melee damage that lasts',
  enchanter: 'Enchanter: heals, shields and buffs allies',
  control: 'Control: locks enemies down',
};
function rolePattern(p) {
  const q = p.pct;
  const s = {
    frontline: q.tank * 1.4 + q.cc * 0.6 + (p.melee ? 0.3 : -0.6),
    diver: (p.mobility ? 0.6 : -0.3) + q.burst * 1.2 + (p.melee ? 0.3 : -0.2) + (p.untargetable || p.stealth ? 0.3 : 0) - q.tank * 0.4,
    backline: (p.melee ? -1 : 0.4) + q.sustained * 1.3 + q.range * 0.4,
    poke: (p.melee ? -1 : 0.2) + q.aoe * 1.2 + q.range * 0.4 + q.burst * 0.3,
    bruiser: (p.melee ? 0.4 : -0.8) + q.sustained * 0.9 + q.tank * 0.6,
    enchanter: q.support * 1.8 + (p.healAllies || p.shieldAllies || p.buffAllies ? 0.3 : -1),
    control: q.cc * 1.6 + q.aoe * 0.2 - 0.2,
  };
  return Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
}
// What a champion threatens: the ways it wins fights, which an enemy should plan around.
function threats(p) {
  const q = p.pct; const t = [];
  if (q.burst > 0.7 && (p.mobility || p.range > 60)) t.push(p.mobility ? 'Dives the backline for a pick' : 'Bursts targets from range');
  if (q.sustained > 0.7) t.push(`Steady ${p.magicShare > 0.6 ? 'magic' : p.magicShare < 0.4 ? 'physical' : 'mixed'} damage over a long fight`);
  if (q.aoe > 0.7) t.push('Hits the whole enemy team in fights');
  if (q.cc > 0.7) t.push('Locks enemies down with hard crowd control');
  if (q.support > 0.7) t.push(p.healAllies || p.shieldAllies ? 'Keeps allies alive with heals or shields' : 'Makes allies stronger with buffs');
  if (q.tank > 0.75) t.push('Hard to kill');
  if (p.untargetable || p.stealth) t.push('Dodges damage (untargetable or hidden)');
  return t;
}

// Team view: damage split and what the five bring together.
// Profiles for the loaded kits, built once per kit set and kept on the model.
export function profilesFor(m) {
  if (!m?.kits) return null;
  if (m._profKits !== m.kits) { m._prof = buildProfiles(m.kits); m._profKits = m.kits; }
  return m._prof;
}

export function teamProfile(profiles, picks) {
  const ps = picks.map((c) => profiles[c]).filter(Boolean);
  const dmg = { phys: 0, magic: 0, true: 0 };
  for (const p of ps) for (const k in dmg) dmg[k] += p.dmg[k];
  const tot = dmg.phys + dmg.magic + dmg.true;
  return {
    magicShare: tot ? dmg.magic / tot : 0, physShare: tot ? dmg.phys / tot : 0, dmg,
    frontline: ps.filter((p) => p.role[0] === 'frontline').length,
    hardCC: ps.reduce((a, p) => a + p.hardCC, 0), divers: ps.filter((p) => p.role.includes('diver')).length,
    support: ps.filter((p) => p.role.includes('enchanter')).length,
  };
}
