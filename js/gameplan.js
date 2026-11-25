// After the draft: item builds per player and team tactics.
// Builds come from what pro players set for each champion in this save and how
// those games went. Tactics are rules applied to the draft: the save does not
// record which tactics teams used in each game, so there is nothing to learn
// them from except the results you record yourself. When the game files are
// loaded, the rules read each champion's kit profile (crowd control, toughness,
// area damage, range, dive and side-lane strength) instead of its tags.
import { wr, ROLES } from './model.js';
import { profilesFor } from './profile.js';
import { compModel, teamComp, rangeMatchups, COMPS } from './comps.js';

// Item lines in the game's order. A build slot is stored as line * 5 + tier.
export const LINES = [
  { key: 'ad', name: 'AD', items: ['Iron Sword', "Soldier's Longsword", 'Ruinous Blade', "Conqueror's Greatsword", "Warlord's Final Judgment"] },
  { key: 'as', name: 'Attack Speed', items: ['Dagger', 'Wind Dagger', 'Twin Stormblade', 'Thunderclaw', 'Storm Sovereign'] },
  { key: 'def', name: 'Defense', items: ['Steel Armor', "Gatekeeper's Armor", "Black Knight's Heavy Plate", 'Eternal Iron Plate', 'Impregnable Fortress'] },
  { key: 'mr', name: 'Magic Resist', items: ['Mystic Cloak', 'Night Hood', 'Dusk Raven', "Soul's Edge", 'Veil of Annihilation'] },
  { key: 'ap', name: 'Magic', items: ['Arcane Crystal', 'Spirit Crystal', 'Staff of Rapture', "Angel's Fang", 'Prophet of the Abyss'] },
  { key: 'hp', name: 'HP', items: ['Vital Orb', 'Hardened Heart', 'Ring of Reincarnation', 'Hourglass of Eternity', "Giant's Horn Shard"] },
];
export const lineOf = (v) => Math.floor(v / 5);
export const BUCKETS = ['mostly physical', 'mixed', 'mostly magic'];

export const TACTICS = [
  { key: 'focused', name: 'Core Lane Focus', opts: { top: 'Focus on Top/Mid', bottom: 'Focus on Mid/Bottom', all: 'All Lanes' } },
  { key: 'early_jungle', name: 'Early Jungle Style', opts: { growth_and_cover: 'Farming/Cover', counter_jungle: 'Counter-Jungling', ganking: 'Ganking' } },
  { key: 'early_serpen', name: 'Early Serpen Attempt', opts: { must: 'Always Attempt', flexible: 'Flexible', giveup: 'Concede' } },
  { key: 'early_serpen_top', name: 'Top Laner Join for Early Serpen', opts: { must: 'Always Join', flexible: 'Flexible', giveup: 'Do Not Join' } },
  { key: 'object_buildup', name: 'Objective Setup', opts: { split: 'Split Push', flexible: 'Flexible', gather: 'Group Up' } },
  { key: 'object_finish', name: 'Objective Finish', opts: { kill_priority: 'Kill Priority', battle_priority: 'Fight Priority' } },
  { key: 'minion_wave', name: 'Minion Wave Management', opts: { wave_priority: 'Wave Priority', join_priority: 'Join Priority' } },
  { key: 'game_finish', name: 'Closing Out', opts: { stable: 'Stable', flexible: 'Flexible', aggressive: 'Aggressive' } },
  { key: 'morgard_use', name: 'Morgard Buff Usage', opts: { gather: 'Group as 5', split14: '1-4 Split', split131: '1-3-1 Split' } },
  { key: 'tower_press', name: 'Tower Siege', opts: { poking: 'Poke / Maintain Distance', dive: 'Dive' } },
  { key: 'defense', name: 'Defensive Tactics', opts: { gather: 'Defend Pressured Lane', battle: 'Force Fight' } },
];

const magicWeight = (ch) => (!ch ? 0 : ch.tags.includes('AP') && !ch.tags.includes('AD') ? 1 : ch.tags.includes('AP') ? 0.5 : 0);
export function damageBucket(champs, picks) {
  const m = picks.reduce((a, c) => a + magicWeight(champs[c]), 0);
  return m < 1.5 ? 0 : m < 2.5 ? 1 : 2;
}

let cache = null;
export function planStats(m) {
  if (cache && cache.m === m) return cache;
  const champ = {};
  const laneVs = new Map();
  const golds = m.games.map((g) => [...g.sum[0].gold, ...g.sum[1].gold].reduce((a, b) => a + b, 0));
  const med = golds.slice().sort((a, b) => a - b)[golds.length >> 1] || 0;
  const add = (map, k, win) => { const v = map.get(k) || [0, 0]; v[0]++; if (win) v[1]++; map.set(k, v); };
  m.games.forEach((g, gi) => {
    const long = golds[gi] > med;
    for (const side of [0, 1]) {
      const win = g.winner === side;
      const bucket = damageBucket(m.champs, g.picks[1 - side]);
      const roleOf = {}; g.players[1 - side].forEach((p, i) => { if (p) roleOf[p.slot] = g.picks[1 - side][i]; });
      g.picks[side].forEach((c, i) => {
        const x = champ[c] = champ[c] || { g: 0, w: 0, short: [0, 0], long: [0, 0], builds: new Map(), byRole: [0, 1, 2, 3, 4].map(() => new Map()), roleN: [0, 0, 0, 0, 0], byBucket: [new Map(), new Map(), new Map()] };
        x.g++; if (win) x.w++;
        const t = long ? x.long : x.short; t[0]++; if (win) t[1]++;
        const p = g.players[side][i];
        if (p && roleOf[p.slot]) add(laneVs, `${c}|${roleOf[p.slot]}`, win);
        if (!p?.items?.length) return;
        const key = p.items.map(lineOf).join('-');
        add(x.builds, key, win); add(x.byBucket[bucket], key, win);
        if (p.slot < 5) { add(x.byRole[p.slot], key, win); x.roleN[p.slot]++; }
      });
    }
  });
  for (const x of Object.values(champ)) x.late = wr(x.long[1], x.long[0], 20) - wr(x.short[1], x.short[0], 20);
  const hasItems = m.games.some((g) => g.players.some((side) => side.some((p) => p?.items?.length)));
  cache = { m, champ, laneVs, hasItems };
  return cache;
}

// Best builds for champion c in role r against these enemy picks.
export function recommendBuilds(m, c, role, enemy, n = 3) {
  const S = planStats(m), x = S.champ[c];
  if (!x || !x.builds.size) return { builds: [], bucket: damageBucket(m.champs, enemy), sample: 0 };
  const base = wr(x.w, x.g);
  const byRole = role != null && x.roleN[role] >= 40;
  const pool = byRole ? x.byRole[role] : x.builds;
  const bucket = damageBucket(m.champs, enemy);
  const rows = [];
  for (const [key, [g, w]] of pool) {
    if (g < 5) continue;
    // shrink hard toward the champion's overall record: most builds have few games
    const s1 = (w + 30 * base) / (g + 30);
    const [ge, we] = x.byBucket[bucket].get(key) || [0, 0];
    const s2 = (we + 20 * s1) / (ge + 20);
    rows.push({ key, slots: key.split('-').map(Number), g, w, ge, we, score: s2 });
  }
  rows.sort((a, b) => b.score - a.score);
  let common = null; for (const [key, [g, w]] of pool) if (!common || g > common.g) common = { key, g, w };
  return { builds: rows.slice(0, n), common, byRole, bucket, bucketName: BUCKETS[bucket], sample: [...pool.values()].reduce((a, v) => a + v[0], 0) };
}

const isTank = (ch) => ch && (ch.cat === 'Tank' || ch.tags.includes('Tank'));
const isDuelist = (ch) => ch && (ch.cat === 'Melee' || ch.cat === 'Assassin') && !(ch.cat === 'Tank');
const hasCC = (ch) => ch && ch.tags.includes('CC');
const isPoke = (ch) => ch && ch.range >= 50000 && (ch.cat === 'Range' || ch.cat === 'Magician');

// side = { byRole: [champ id or null x5] }
export function recommendTactics(m, us, them, history = []) {
  const S = planStats(m), C = m.champs;
  const ch = (c) => C[c];
  const list = (s) => s.byRole.filter(Boolean);
  const late = (s) => { const v = list(s).map((c) => S.champ[c]?.late ?? 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const lane = (r) => {
    const a = us.byRole[r], b = them.byRole[r]; if (!a || !b) return 0;
    const v = S.laneVs.get(`${a}|${b}`); return v ? wr(v[1], v[0], 8) - 0.5 : 0;
  };
  const top = lane(0), jg = lane(1), mid = lane(2), bot = (lane(3) + lane(4)) / 2;
  const lateUs = late(us), lateThem = late(them), scale = lateUs - lateThem;
  const P = profilesFor(m);
  const pr = (c) => P?.[c];
  const has = (c, r) => !!pr(c)?.role.includes(r);
  const kit = !!P && list(us).every((c) => pr(c)) && list(them).every((c) => pr(c));
  const name = (c) => m.champName ? m.champName(c) : ch(c)?.name;
  // kit-based versions of the tag rules
  const tanky = (c) => !!c && kit ? pr(c).role[0] === 'frontline' || pr(c).pct.tank > 0.75 : isTank(ch(c));
  const duel = (c) => !!c && kit ? !!pr(c) && (has(c, 'bruiser') || has(c, 'diver')) && !has(c, 'enchanter') && pr(c).pct.sustained + pr(c).pct.tank > 1 : isDuelist(ch(c));
  const fight = (s) => kit
    ? list(s).reduce((a, c) => a + pr(c).pct.cc + 0.5 * pr(c).pct.tank + 0.5 * pr(c).pct.aoe, 0)
    : list(s).filter((c) => hasCC(ch(c))).length + list(s).filter((c) => isTank(ch(c))).length * 0.5;
  const fightUs = fight(us), fightThem = fight(them);
  const isPokeK = (c) => kit ? (pr(c).role[0] === 'poke' || pr(c).role[0] === 'backline') && pr(c).pct.range > 0.6 : isPoke(ch(c));
  const poke = list(us).filter(isPokeK).length;
  const diveK = (c) => kit ? has(c, 'diver') || (pr(c).role[0] === 'frontline' && pr(c).mobility > 0) : isTank(ch(c)) || ch(c)?.cat === 'Assassin';
  const dive = list(us).filter(diveK).length;
  const theirDivers = kit ? list(them).filter((c) => has(c, 'diver')).length : 0;
  const ourCarries = kit ? list(us).filter((c) => pr(c).role[0] === 'backline' || pr(c).role[0] === 'poke').length : 0;
  const duelists = [0, 2, 3].map((r) => us.byRole[r]).filter((c) => c && duel(c));
  const junglerCh = ch(us.byRole[1]);
  const topCh = ch(us.byRole[0]);
  const jgK = pr(us.byRole[1]);
  const ganker = kit && jgK ? jgK.mobility > 0 && (jgK.pct.burst > 0.6 || jgK.hardCC >= 2)
    : junglerCh && (junglerCh.cat === 'Assassin' || (junglerCh.cat === 'Melee' && hasCC(junglerCh)));
  const fightWhat = kit ? 'crowd control, toughness and area damage in the kits' : 'crowd control and frontline';
  const f = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}`;
  const out = {};
  const pick = (key, choice, reason) => { out[key] = { choice, reason }; };

  if (top + mid > bot + mid + 0.04 && top > 0) pick('focused', 'top', `Your top lane matchup looks better (${f(top)} vs ${f(bot)} for bottom).`);
  else if (bot > top + 0.04 && bot > 0) pick('focused', 'bottom', `Your bottom lane matchup looks better (${f(bot)} vs ${f(top)} for top).`);
  else pick('focused', 'all', 'No lane stands out, so press everywhere.');

  if (ganker && Math.max(top, mid, bot) > 0) pick('early_jungle', 'ganking', `${junglerCh.name} has the ${kit ? (jgK.pct.burst > 0.6 ? 'gap closer and burst' : 'gap closer and crowd control') : 'damage or crowd control'} to gank, and you have a lane worth helping.`);
  else if (jg > 0.04 && scale <= 0) pick('early_jungle', 'counter_jungle', `${junglerCh?.name || 'Your jungler'} tends to beat their jungler (${f(jg)}).`);
  else pick('early_jungle', 'growth_and_cover', scale > 0 ? 'Your draft is better in long games, so farm and keep lanes safe.' : 'No clear early edge in the jungle, so farm and cover lanes.');

  if (bot > 0.03 && scale <= 0.01) pick('early_serpen', 'must', `Your bottom side is stronger early (${f(bot)}), so take the first Serpen.`);
  else if (bot < -0.03 && scale > 0) pick('early_serpen', 'giveup', 'Their bottom side is stronger and your draft scales, so do not fight for it early.');
  else pick('early_serpen', 'flexible', 'Neither side has a clear edge near Serpen.');

  if (out.early_serpen.choice === 'must' && (tanky(us.byRole[0]) || top < 0)) pick('early_serpen_top', 'must', `${topCh?.name || 'Your top laner'} gives up little by leaving lane.`);
  else if (top > 0.03 && topCh && duel(us.byRole[0])) pick('early_serpen_top', 'giveup', `${topCh.name} should keep winning top lane instead.`);
  else pick('early_serpen_top', 'flexible', 'Let the top laner judge it.');

  if (duelists.length && fightUs <= fightThem) pick('object_buildup', 'split', `${duelists.map(name).join(' and ')} can pressure a side lane, and their teamfight is as strong as yours.`);
  else if (fightUs > fightThem + 1) pick('object_buildup', 'gather', `Your teamfight is stronger (${fightUs.toFixed(1)} vs ${fightThem.toFixed(1)} on ${fightWhat}).`);
  else pick('object_buildup', 'flexible', 'Teamfights look even.');

  if (fightThem >= fightUs + 1) pick('object_finish', 'battle_priority', `They have more engage (${fightThem.toFixed(1)} vs ${fightUs.toFixed(1)} on ${fightWhat}), so be ready to fight when they contest.`);
  else pick('object_finish', 'kill_priority', 'Your fight is at least even, so finish the objective and pick off whoever contests.');

  if (scale > 0.01) pick('minion_wave', 'wave_priority', 'Your draft gets stronger in longer games, so keep farming waves.');
  else pick('minion_wave', 'join_priority', 'Your draft is stronger early, so group up and use it.');

  if (scale < -0.01) pick('game_finish', 'aggressive', `They are stronger in long games (${f(-scale)}), so end it fast.`);
  else if (scale > 0.01) pick('game_finish', 'stable', `You are stronger in long games (${f(scale)}), so there is no need to force it.`);
  else pick('game_finish', 'flexible', 'Neither draft clearly wins longer games.');

  if (duelists.length >= 2) pick('morgard_use', 'split131', `${duelists.slice(0, 2).map(name).join(' and ')} can hold side lanes alone.`);
  else if (duelists.length === 1) pick('morgard_use', 'split14', `${name(duelists[0])} can hold a side lane alone.`);
  else pick('morgard_use', 'gather', 'Nobody on your team is built to hold a side lane alone.');

  if (dive >= 3 && dive > poke) pick('tower_press', 'dive', `You have ${dive} ${kit ? 'divers and mobile frontliners' : 'tanks and assassins'} to dive with.`);
  else pick('tower_press', 'poking', poke >= 2 ? `You have ${poke} long-range damage dealers.` : 'Without enough divers, siege safely.');

  if (theirDivers >= 2 && ourCarries >= 2) pick('defense', 'gather', `They have ${theirDivers} divers and you have ${ourCarries} backline carries, so defend together and keep the carries covered.`);
  else if (fightUs >= fightThem && scale <= 0.01) pick('defense', 'battle', 'Your teamfight is at least as strong, so force fights when they split up.');
  else pick('defense', 'gather', scale > 0.01 ? 'You outscale them, so defend safely and wait.' : 'Their teamfight is stronger, so defend together.');

  // composition: what the draft is built to do sets the big plays
  const cm = kit ? compModel(m) : null;
  const tu = cm ? teamComp(cm, list(us)) : null, tt = cm ? teamComp(cm, list(them)) : null;
  if (tu && tu.scores[tu.main] > 0.3) {
    const comp = COMPS[tu.main].name.toLowerCase(); const why = (t) => `Your draft is built for ${comp}: ${t}`;
    if (tu.main === 'dive') { pick('tower_press', 'dive', why('dive towers when your engage is up.')); pick('object_buildup', 'gather', why('group so the dive has follow-up.')); }
    if (tu.main === 'poke') { pick('tower_press', 'poking', why('chip towers from range and do not walk into them.')); pick('defense', 'gather', why('defend together and poke them off.')); pick('object_finish', 'kill_priority', why('take the objective while they are worn down.')); }
    if (tu.main === 'pick') { pick('object_buildup', 'flexible', why('look for a catch before each objective.')); pick('defense', 'battle', why('punish anyone who walks in alone.')); }
    if (tu.main === 'protect') { pick('object_buildup', 'gather', why('stay grouped around your carry.')); pick('morgard_use', 'gather', why('keep all five together so the carry stays protected.')); pick('tower_press', 'poking', why('let the carry hit towers from safety instead of diving.')); }
    if (tu.main === 'teamfight') { pick('object_buildup', 'gather', why('force five-on-five fights around objectives.')); pick('object_finish', 'battle_priority', why('fight first, then take the objective.')); pick('defense', 'battle', why('take the fight when they come.')); }
    if (tu.main === 'split' && duelists.length) { pick('object_buildup', 'split', why(`${name(duelists[0])} pulls them to a side lane.`)); pick('morgard_use', 'split14', why(`${name(duelists[0])} holds a side lane while four group.`)); }
  }
  const rm = cm ? rangeMatchups(cm, us.byRole, them.byRole) : null;
  if (rm && rm.team > 0.2) { pick('tower_press', 'dive', 'They out-reach you and you would lose a long siege, so commit when you go in.'); }
  if (rm && rm.team < -0.2 && out.tower_press.choice !== 'poking') pick('tower_press', 'poking', 'You out-reach them and they have little engage, so siege from range.');

  // your own record with each choice
  for (const t of TACTICS) {
    const rows = history.filter((h) => h.tactics && h.tactics[t.key] === out[t.key].choice && h.won != null);
    out[t.key].record = rows.length ? { g: rows.length, w: rows.filter((h) => h.won).length } : null;
  }
  return { tactics: out, traits: { top, jg, mid, bot, lateUs, lateThem, fightUs, fightThem, poke, dive, theirDivers, ourCarries, kit, compUs: tu, compThem: tt, range: rm } };
}

// slots here are item lines (0..5), as returned by recommendBuilds
export function buildLabel(slots) { return slots.map((v) => LINES[v]?.name || '?').join(' → '); }
export { ROLES };
