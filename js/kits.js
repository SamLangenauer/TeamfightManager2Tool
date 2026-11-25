// Champion kits, read from the user's own game install (see gamefiles.js): every
// ability's raw parameters plus the game's own English description.
// Times in the data are in ticks (60 per second); ranges are in 1/1000 units.

export const SLOTS = ['attack', 'skill', 'skill2', 'ult'];
export const SLOT_LABEL = { attack: 'Basic attack', skill: 'Ability 1', skill2: 'Ability 2', ult: 'Ultimate' };
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// Every numeric field in an action, in reading order, so placeholders can be matched.
function walk(x, out = []) {
  if (Array.isArray(x)) { for (const y of x) walk(y, out); return out; }
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'number') out.push([k, v]); else walk(v, out);
  }
  return out;
}

// Where each {Placeholder} in the game's descriptions usually lives in the data.
// Times are in ticks; a field ending in _tick is a total time, _period an interval.
const ALIAS = {
  Damage: ['damage', 'attack', 'base_damage', 'sub_damage', 'ap_attack', 'magic_damage'],
  Coef: ['attack_ratio', 'damage_ratio', 'ap_ratio', 'damage_ap_ratio', 'sub_damage_ratio', 'magic_ratio', 'shield_ratio', 'heal_ratio', 'damage_reduce'],
  DamageCoef: ['damage_ratio', 'damage_ap_ratio', 'attack_ratio'],
  Time: ['tick', 'buff_duration', 'stun_duration', 'airborne', 'stun', 'channel_duration', 'taunt_duration', 'invisible_duration', 'effect_duration', 'heal_tick', 'attack_tick'],
  Duration: ['tick', 'heal_tick', 'attack_tick', 'channel_duration', 'buff_duration', 'effect_duration'],
  Tick: ['heal_period', 'attack_period', 'period', 'interval'],
  Value: ['heal', 'shield', 'amount', 'value', 'heal_amount', 'shield_amount'],
  Amount: ['shield', 'heal', 'amount', 'shield_amount', 'heal_amount'],
  Slow: ['slow', 'slow_speed', 'slow_ratio', 'move_speed_reduce'],
  SlowTime: ['slow_duration', 'slow_time', 'slow_tick'],
  Stun: ['stun', 'stun_duration'], StunTime: ['stun_duration', 'stun'],
  AttackSpeed: ['attack_speed', 'attack_speed_increase', 'attack_speed_boost', 'attack_speed_up'],
  AttackSpeedCoef: ['attack_speed_ap_ratio', 'attack_speed_ratio'],
  Attack: ['attack_boost', 'attack_increase', 'attack'], AttackRatio: ['magic_ratio', 'attack_ratio'],
  Shield: ['shield', 'shield_amount'], ShieldCoef: ['shield_ratio', 'shield_ap_ratio'],
  Heal: ['heal', 'heal_amount'], HealCoef: ['heal_ratio', 'heal_ap_ratio'],
  HpCoef: ['damage_reduce_hp_ratio', 'hp_ratio', 'shield_hp_ratio', 'heal_hp_ratio'],
  MoveSpeed: ['slow', 'move_speed', 'move_speed_boost', 'move_speed_increase'],
  Range: ['range', 'attack_range', 'heal_range', 'ult_range', 'skill_range', 'cast_range', 'range_increase'],
  Radius: ['radius', 'attack_range', 'explosion_range', 'heal_range'],
};
const TIMEKEY = /(tick|duration|time|delay|period|interval|^stun$|^airborne$)/;
const SKIP = new Set(['duration', 'start_timing', 'cooltime']); // animation length and cast timing, not effect values

// Fill {Placeholder} values in a description from the action's parameters.
// Returns null when no field matches.
export function paramValue(action, name, seen, area = false) {
  if (!action) return null;
  const f = walk(action).filter(([k]) => !SKIP.has(k));
  const n = seen[name] = (seen[name] || 0) + 1;
  const key = snake(name);
  let keys = ALIAS[name] || [key, key + '_ratio', key + '_boost', key + '_increase', key + '_amount', key + '_duration', key + '_tick'];
  if (name === 'Range' && area) keys = ['attack_range', 'heal_range', 'radius', ...keys];
  const vals = [];
  for (const k of keys) for (const [fk, v] of f) if (fk === k) vals.push([fk, v]);
  if (!vals.length) return null;
  const [k, v] = vals[Math.min(n, vals.length) - 1];
  if (/range|radius/.test(k)) return +(v / 1000).toFixed(1);
  if (TIMEKEY.test(k) && name !== 'Count') return +(v / 60).toFixed(2);
  return v;
}

export const actionFor = (kit, slot) => (slot === 'skill' && kit.passive ? { ...kit.passive, ...(kit.skill || {}) } : kit[slot]);

// Description with numbers filled in and the game's colour tags kept as [tag]…[/].
// A value the data does not hold becomes {?Name}.
export function fillText(kit, slot) {
  const text = kit?.text?.[slot]; if (!text) return '';
  const seen = {}; const action = actionFor(kit, slot);
  return text.replace(/(within |area with |field with |radius of )?\{(\w+)\}/g, (all, pre, p) => {
    const v = paramValue(action, p, seen, !!pre);
    return (pre || '') + (v == null ? `{?${p}}` : String(v));
  });
}

// Description as HTML: colour spans the game uses become classes, numbers filled in.
export function describe(kit, slot, esc) {
  let s = esc(fillText(kit, slot)).replace(/\{\?(\w+)\}/g, (_, p) => `<span class="kit-q" title="Not in the data: ${p}">?</span>`);
  return s.replace(/\[(\w+)\](.*?)\[\/\]/g, (_, c, t) => `<span class="kit-${c}">${t}</span>`);
}

// Short facts for an action: cooldown and cast range.
export function actionFacts(a) {
  if (!a) return '';
  const bits = [];
  if (a.cooltime) bits.push(`${+(a.cooltime / 60).toFixed(2)}s cooldown`);
  const r = a.cast_range || a.range;
  if (r) bits.push(`range ${+(r / 1000).toFixed(1)}`);
  return bits.join(' · ');
}
