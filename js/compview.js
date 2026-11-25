// Draft page: what each side's composition is built to do, what it lacks, range matchups,
// and short kit reasons on each suggestion. None of this changes the scores: checked on the
// pro games, these factors are already covered by the champion, synergy and matchup stats.
import { ROLES, pct } from './model.js';
import { esc } from './ui.js';
import { compModel, teamComp, missingPieces, winCondition, rangeMatchups, COMPS, COMP_KEYS } from './comps.js';
import { partnersOf, LINKS } from './combos.js';

const name = (m, c) => esc(m.champName(c));

export function compCard(m, sides) {
  const cm = compModel(m); if (!cm) return '';
  const { us, them } = sides; // { picks, byRole, late }
  if (!us.picks.length && !them.picks.length) return '';
  const tu = teamComp(cm, us.picks), tt = teamComp(cm, them.picks);
  const bars = (tc) => tc ? COMP_KEYS.map((k) => { const z = tc.scores[k]; const w = Math.max(0, Math.min(100, 50 + z * 22)); return `<div class="statrow wide"><span>${COMPS[k].name}</span><span class="bar"><span style="width:${w}%"></span></span><span class="num muted small">${Math.abs(z) < 0.05 ? '0.0' : (z > 0 ? '+' : '') + z.toFixed(1)}</span></div>`; }).join('') : '<p class="muted small">No picks yet.</p>';
  // lane economics: who the gold should go to
  const GOLD_NOTE = ['Top: solo lane, levels fast, middling gold', 'Jungle: second-most gold from camps and kills', 'Mid: solo lane, levels fast; a gold lead here wins most often', 'Bottom: the most gold of any role', 'Support: about half the gold of the others'];
  const carryLine = (sd) => {
    const ids = sd.byRole.map((c, r) => [c, r]).filter(([c]) => c && cm.T[c]);
    if (!ids.length) return '';
    const [c, r] = ids.sort((a, b) => cm.T[b[0]].carry - cm.T[a[0]].carry)[0];
    if (cm.T[c].carry < 0.5) return '';
    const warn = r === 4 ? ' That role gets the least gold, so this damage will come online slowly.' : '';
    return `<p class="small">Main damage: <strong>${name(m, c)}</strong> (${esc(GOLD_NOTE[r])}).${warn}</p>`;
  };
  const side = (label, tc, other, late, sd) => {
    const miss = tc ? missingPieces(tc, other) : [];
    return `<div><h3>${label}</h3>${tc ? `<p class="small"><strong>${esc(winCondition(tc, late))}</strong></p>` : ''}${carryLine(sd)}${bars(tc)}
      ${miss.length ? `<ul class="threats">${miss.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}</div>`;
  };
  const rec = tu && tt && tu.main !== tt.main ? cm.mm[tu.main + '>' + tt.main] : null;
  const recTxt = rec && rec.g >= 20 ? `<p class="small">In this save's pro games, ${COMPS[tu.main].name.toLowerCase()} drafts won ${rec.w} of ${rec.g} games against ${COMPS[tt.main].name.toLowerCase()} drafts (${pct(rec.w / rec.g)}). Much of that comes from which champions are strong, which the win chance already counts.</p>` : '';
  const rm = rangeMatchups(cm, us.byRole, them.byRole);
  const lanes = rm.lanes.filter((l) => l.penalty > 0.15 || l.edge > 0.15).map((l) => l.penalty > 0.15
    ? `<li class="neg">${ROLES[l.role]}: ${name(m, l.b)} out-ranges ${name(m, l.a)} (${l.gap} more range) and ${name(m, l.a)} has little way to close the gap.</li>`
    : `<li class="pos">${ROLES[l.role]}: ${name(m, l.a)} out-ranges ${name(m, l.b)} (${-l.gap} more range), and ${name(m, l.b)} has little way to close the gap.</li>`).join('');
  const team = rm.team > 0.15 ? `<li class="neg">They out-reach you as a team and you have little engage to answer it, so avoid long sieges and look for flanks.</li>`
    : rm.team < -0.15 ? `<li class="pos">You out-reach them as a team and they have little engage, so siege and poke before fights.</li>` : '';
  return `<div class="card comps">
    <h2>Compositions</h2>
    <p class="muted small">From each kit: dive is gap closers and burst, poke is range and zones, pick is catches, protect is one carry with heals, shields and peel, teamfight is area crowd control with area damage, split is a side laner who wins alone. 0 is an average pro draft.</p>
    <div class="grid two">${side('You', tu, tt, us.late, us)}${side('Them', tt, tu, them.late, them)}</div>
    ${recTxt}
    ${lanes || team ? `<h3>Range</h3><ul class="range">${lanes}${team}</ul><p class="muted small">In this save, longer range on its own does not win more: melee and dive champions are strong. Being out-ranged matters most when you cannot get onto the enemy.</p>` : ''}
  </div>`;
}

// Up to two short kit reasons for a suggestion. kind 'pick' or 'ban'; for a ban, c is judged from
// the other side's point of view (what it would add to them).
export function kitReasons(m, c, kind, mine, theirs, role) {
  const cm = compModel(m); if (!cm?.T[c]) return [];
  const [own, opp] = kind === 'ban' ? [theirs, mine] : [mine, theirs];
  const before = own.picks.length ? teamComp(cm, own.picks) : null, after = teamComp(cm, [...own.picks, c]);
  const out = [];
  const best = partnersOf(m, c, own.picks)[0];
  if (best) {
    const who = kind === 'ban' ? 'their' : 'your';
    const link = best.links[0];
    const why = link ? LINKS[link.key].name.toLowerCase() : '';
    const pro = best.pro && best.pro.g >= 10 ? `, pros ${best.pro.w}–${best.pro.g - best.pro.w}` : '';
    out.push({ pos: true, text: `Pairs with ${who} ${m.champName(best.with)}${why ? ` (${why}${pro})` : pro ? ` (${pro.slice(2)})` : ''}` });
  }
  const oppTc = opp.picks.length ? teamComp(cm, opp.picks) : null;
  const was = new Set(before ? missingPieces(before, oppTc).map((x) => x.key) : ['noFront', 'noEngage']);
  const now = new Set(missingPieces(after, oppTc).map((x) => x.key));
  const fixed = [...was].filter((k) => !now.has(k));
  const FIX = { noFront: 'a frontline', noEngage: 'a way to start fights', allPhys: 'magic damage', allMagic: 'physical damage', noPeel: 'peel against divers', noAntiHeal: 'healing cut' };
  if (fixed.length) out.push({ pos: true, text: kind === 'ban' ? `Would give them ${FIX[fixed[0]]}` : `Gives you ${FIX[fixed[0]]}` });
  const gain = COMP_KEYS.map((k) => [k, after.scores[k] - (before ? before.scores[k] : 0)]).sort((a, b) => b[1] - a[1])[0];
  if (gain[1] > 0.3 && (!before || before.main === gain[0] || after.main === gain[0])) out.push({ pos: true, text: kind === 'ban' ? `Key to their ${COMPS[gain[0]].name.toLowerCase()}` : `Builds your ${COMPS[gain[0]].name.toLowerCase()}` });
  if (role != null && opp.byRole[role] && cm.P[opp.byRole[role]]) {
    const rmA = rangeMatchups(cm, Object.assign([null, null, null, null, null], { [role]: c }), Object.assign([null, null, null, null, null], { [role]: opp.byRole[role] }));
    const l = rmA.lanes[0];
    if (l?.penalty > 0.2) out.push({ pos: kind === 'ban', text: `Out-ranged by ${m.champName(l.b)} in ${ROLES[role]} with little way in` });
    else if (l?.edge > 0.2) out.push({ pos: kind !== 'ban', text: `Out-ranges ${m.champName(l.b)} in ${ROLES[role]}` });
  }
  return out.slice(0, 3);
}
