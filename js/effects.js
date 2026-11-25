// Every buff and debuff in a champion's kit, read from the ability text with numbers filled in.
//
// Each effect is { kind, slot, target, dur, amount }:
//   kind    one of EFFECTS below
//   slot    attack / skill / skill2 / ult
//   target  'self', 'ally' (one ally), 'allies' (several), 'enemy' (one), 'enemies' (several)
//   dur     seconds, when the text gives it
//   amount  the percentage or flat number next to it, when the text gives one
import { SLOTS, fillText } from './kits.js';

// group: what the effect does in a fight; good: who it is for
export const EFFECTS = {
  stun: { name: 'Stun', group: 'hard CC', good: 'enemy', re: /\bstun/ },
  airborne: { name: 'Knock-up', group: 'hard CC', good: 'enemy', re: /airborne|knock(s|ing|ed)? (them |enemies |it )?up/ },
  knockback: { name: 'Knockback', group: 'hard CC', good: 'enemy', re: /knock(s|ing|ed)? (them |enemies |it )?back|push(es|ing)? (them |enemies )?(away|back)/ },
  pull: { name: 'Pull', group: 'hard CC', good: 'enemy', re: /\bpull(s|ing|ed)?\b/ },
  root: { name: 'Root', group: 'hard CC', good: 'enemy', re: /\broot|\bbind|snare|immobili/ },
  taunt: { name: 'Taunt', group: 'hard CC', good: 'enemy', re: /taunt/ },
  fear: { name: 'Fear', group: 'hard CC', good: 'enemy', re: /\bfear|terrif/ },
  sleep: { name: 'Sleep', group: 'hard CC', good: 'enemy', re: /\bsleep|\basleep|charm/ },
  silence: { name: 'Silence', group: 'soft CC', good: 'enemy', re: /silenc/ },
  blind: { name: 'Blind', group: 'soft CC', good: 'enemy', re: /\bblind/ },
  slow: { name: 'Slow', group: 'soft CC', good: 'enemy', re: /\bslow/ },
  aspdDown: { name: 'Attack speed down', group: 'debuff', good: 'enemy', re: /(reduc|lower|decreas)\w* .{0,30}attack speed|attack speed .{0,15}(reduc|lower|decreas)/ },
  armorDown: { name: 'Armor shred', group: 'debuff', good: 'enemy', re: /(reduc|lower|decreas|shred)\w* .{0,30}(armor|defen[cs]e)|(armor|defen[cs]e) .{0,15}(reduc|lower|decreas)/ },
  mrDown: { name: 'Magic resist shred', group: 'debuff', good: 'enemy', re: /(reduc|lower|decreas|shred)\w* .{0,30}magic resist|magic resist\w* .{0,15}(reduc|lower|decreas)/ },
  dmgAmp: { name: 'Takes more damage', group: 'debuff', good: 'enemy', re: /(take|takes|receive|receives) .{0,25}(more|increased|additional|extra) damage/ },
  antiHeal: { name: 'Healing cut', group: 'debuff', good: 'enemy', re: /(reduc|lower|decreas|cut)\w* .{0,25}(healing|health restor|recovery)|(healing|recovery) .{0,20}(reduc|lower|decreas)|cannot (be )?heal/ },
  dot: { name: 'Damage over time', group: 'damage', good: 'enemy', re: /\bburn|poison|bleed|every [\d.]+s .{0,40}damage|damage .{0,40}every [\d.]+s/ },
  execute: { name: 'Execute', group: 'damage', good: 'enemy', re: /execut|missing health|below [\d.]+% (health|hp)|lower (their|the target's) health/ },
  mark: { name: 'Mark', group: 'debuff', good: 'enemy', re: /\bmark/ },
  heal: { name: 'Heal', group: 'sustain', good: 'friend', re: /\bheal(s|ing|ed)?\b|restor\w* .{0,40}health|health .{0,10}restor/ },
  lifesteal: { name: 'Life steal', group: 'sustain', good: 'friend', re: /life ?steal|vamp|% of (the )?damage (dealt|done)/ },
  shield: { name: 'Shield', group: 'sustain', good: 'friend', re: /shield/ },
  dmgReduce: { name: 'Damage reduction', group: 'defense', good: 'friend', re: /(take|takes|receive|receives) .{0,25}(less|reduced) damage|damage taken .{0,15}reduc|reduc\w* (the )?damage (they |it |he |she )?(take|receive)|damage to .{0,45} (is )?reduced|damage reduction/ },
  armorUp: { name: 'Armor or MR up', group: 'defense', good: 'friend', re: /(gain|grant|increas)\w* .{0,30}(armor|defen[cs]e|magic resist)|(armor|defen[cs]e|magic resist\w*) .{0,15}(increas|up\b)/ },
  untargetable: { name: 'Untargetable', group: 'defense', good: 'friend', re: /untargetable|invulnerab|invincib|cannot be (targeted|attacked)/ },
  stealth: { name: 'Stealth', group: 'defense', good: 'friend', re: /stealth|invisib|camouflag/ },
  ccImmune: { name: 'CC immune', group: 'defense', good: 'friend', re: /immun\w* to (crowd control|cc|all)|unstoppable|cannot be (stunned|interrupted)/ },
  cleanse: { name: 'Cleanse', group: 'defense', good: 'friend', re: /cleans|remov\w* .{0,25}(debuff|crowd control|negative)/ },
  revive: { name: 'Revive', group: 'defense', good: 'friend', re: /reviv|resurrect|return(s)? to life|cheat death/ },
  aspdUp: { name: 'Attack speed up', group: 'buff', good: 'friend', re: /(gain|grant|increas|giv)\w* .{0,30}attack speed|attack speed .{0,10}(increas|up\b)|\[aspd\]/ },
  adUp: { name: 'Damage up', group: 'buff', good: 'friend', re: /(gain|grant|increas)\w* .{0,25}(attack damage|ability power|damage dealt)|deal\w* .{0,15}(more|increased) damage/ },
  cdrUp: { name: 'Cooldowns cut', group: 'buff', good: 'friend', re: /(reduc|lower|cut)\w* .{0,30}cooldown|cooldown .{0,15}(reset|reduc)/ },
  hpUp: { name: 'Max health up', group: 'defense', good: 'friend', re: /(gain|increas)\w* .{0,15}maximum health|maximum health by/ },
  msUp: { name: 'Move speed up', group: 'buff', good: 'friend', re: /(gain|grant|increas)\w* .{0,25}movement speed|movement speed .{0,10}(increas|up\b)|\[speed\][\d.]+% movement speed/ },
  dash: { name: 'Dash or blink', group: 'mobility', good: 'friend', re: /\b(charges?|dash(es)?|leaps?|jumps?|teleports?|blinks?|rushes|lunges?|flies)\b/ },
  summon: { name: 'Summon', group: 'damage', good: 'friend', re: /(summon|spawn|creat|rais)\w* .{0,25}\b(clone|totem|turret|minion|spirit|wolf|wolves|golem|skeleton|undead|soldier|familiar|bird|beast|ghoul|puppet|doll|bear|gate|tower|copy|copies)/ },
  zone: { name: 'Zone', group: 'damage', good: 'enemy', re: /(creates?|leaves?|places?) .{0,30}(field|zone|area|circle|pool|trap)|\btrap/ },
};
export const GROUPS = ['hard CC', 'soft CC', 'debuff', 'damage', 'sustain', 'defense', 'buff', 'mobility'];

// who a sentence affects, for an effect that is good for friends or bad for enemies
function targetOf(s, good) {
  if (good === 'enemy') {
    if (/\b(all|nearby|surrounding) enemies|enemies (within|in|around|hit|near|on|standing)|in (an|a) (area|line|cone|circle)|\barea\b|each enemy|enemies it passes/.test(s)) return 'enemies';
    return 'enemy';
  }
  if (/\b(all )?allies\b|allied champions|the team|nearby allies|every ally/.test(s)) return 'allies';
  if (/\b(an|one|another|the|target|lowest-health|nearest) ally\b|\bally\b/.test(s)) return 'ally';
  return 'self';
}

const sentences = (t) => t.replace(/\[(\w+)\](.*?)\[\/\]/g, (_, c, x) => (c === 'aspd' || c === 'speed' || c === 'num' ? `[${c}]${x}` : x)).toLowerCase().split(/(?<=[.!?])\s+/);

export function effectsOf(kit) {
  const out = [];
  for (const slot of SLOTS) {
    const text = fillText(kit, slot); if (!text) continue;
    for (const s of sentences(text)) {
      for (const [kind, e] of Object.entries(EFFECTS)) {
        const m = s.match(e.re); if (!m) continue;
        if (EFFECTS[kind].group === 'hard CC' && /\b(remov|cleans|reflect|immun)/.test(s)) continue; // listed as what gets removed or blocked
        if (/^does not|\bdoes not (remove|affect)/.test(s) && EFFECTS[kind].good === 'enemy') continue;
        if (kind === 'shield' && /cannot .{0,20}shield/.test(s)) continue;
        if (kind === 'cleanse' && /^cleansing the/.test(s.slice(m.index))) continue;
        if (kind === 'dash' && /flies into the air/.test(s)) continue;
        if (kind === 'heal' && /cannot (be )?heal|(reduc|lower|cut)\w* .{0,25}healing/.test(s) && !/restor/.test(s)) continue;
        if (kind === 'slow' && /slowly/.test(s) && !/\bslow(s|ing|ed)?\b/.test(s.replace(/slowly/g, ''))) continue;
        if (e.good === 'enemy' && /\ball(y|ies|ied)\b/.test(s) && !/enem|target|them\b/.test(s)) continue; // a drawback on your own team
        const before = s.slice(Math.max(0, m.index - 14), m.index), after = s.slice(m.index, m.index + 60);
        const amount = +(before.match(/([\d.]+)%\s*(\[\w+\])?\s*$/)?.[1] ?? after.match(/^[^,.;]{0,30}?\b(by|of) ([\d.]+)%/)?.[2] ?? NaN);
        const dur = +(after.match(/^[^.;]{0,50}?for (\[num\])?([\d.]+)\s?s\b/)?.[2] ?? s.match(/for (\[num\])?([\d.]+)\s?s\b/)?.[2] ?? NaN);
        if (out.some((x) => x.kind === kind && x.slot === slot)) continue;
        out.push({ kind, slot, target: kind === 'dash' ? 'self' : targetOf(s, e.good), dur: Number.isFinite(dur) ? dur : null, amount: Number.isFinite(amount) ? amount : null });
      }
    }
  }
  return out;
}

export function allEffects(kits) {
  const out = {};
  for (const [c, k] of Object.entries(kits || {})) out[c] = effectsOf(k);
  return out;
}

// one-line label, e.g. "Stun 1.2s (one enemy)"
const WHO = { self: 'self', ally: 'one ally', allies: 'allies', enemy: 'one enemy', enemies: 'several enemies' };
export function effectLabel(e) {
  const bits = [e.amount != null && !['stun', 'airborne', 'root', 'taunt', 'fear', 'sleep'].includes(e.kind) ? `${e.amount}%` : null, e.dur ? `${e.dur}s` : null].filter(Boolean).join(', ');
  return `${EFFECTS[e.kind].name}${bits ? ' ' + bits : ''} (${WHO[e.target]})`;
}
