import { DraftEngine } from './draft.js';
import { ROLES, pct } from './model.js';
import { esc, select } from './ui.js';
import { face } from './portraits.js';
import { local } from './store.js';
import { learner, results } from './learn.js';
import { recommendBuilds, recommendTactics, TACTICS, LINES, damageBucket, BUCKETS, planStats } from './gameplan.js';
import { mathBuilds, stepReason, ITEM_LEVEL } from './items.js';
import { profiles } from './views.js';
import { compCard, kitReasons } from './compview.js';
import { compModel, teamComp, missingPieces, rangeMatchups, COMPS } from './comps.js';
import { askAvailable, askTab, askEvents, setAskContext, afterRender } from './askclaude.js';

let D = local.get('draft', null);
const openRecs = new Set(); // suggestion cards opened to show their full breakdown, keyed by step and champion

// Small role marks, drawn here (plain shapes, not the game's art).
const ROLE_SVG = [
  '<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2.5" y="2.5" width="6" height="6" fill="currentColor"/>',
  '<path d="M4 13 L7 3 M7.5 13 L10 4 M11 13 L13 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  '<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 13 L13 3" stroke="currentColor" stroke-width="2.2"/>',
  '<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7.5" y="7.5" width="6" height="6" fill="currentColor"/>',
  '<path d="M8 2 V14 M3 7 H13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
];
export const roleIcon = (r) => `<svg class="role-ic" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="${ROLES[r]}"><title>${ROLES[r]}</title>${ROLE_SVG[r]}</svg>`;
let engine = null, engineKey = '';
const save = () => local.set('draft', D);

function sequence(bansPer, order) {
  const steps = [];
  for (let i = 0; i < bansPer * 2; i++) steps.push({ side: i % 2 ? 'B' : 'A', kind: 'ban' });
  const picks = order === 'snake' ? 'ABBAABBAAB' : 'ABABABABAB';
  for (const s of picks) steps.push({ side: s, kind: 'pick' });
  return steps;
}

function ensure(m, r) {
  const qOpp = r.q.get('opp');
  if (!D || (qOpp && +qOpp !== D.opp)) {
    const opp = qOpp != null ? +qOpp : (m.teams.find((t) => t.id !== m.myTeam && t.league === m.teams[m.myTeam ?? 0]?.league)?.id ?? 0);
    D = { us: m.myTeam ?? 0, opp, side: 'A', bansPer: 3, order: 'snake', patch: 'latest', entries: [], lineup: null, filter: '' };
    save();
  }
  const latestBans = m.games.length ? m.games[m.games.length - 1].bans[0].length : 3;
  if (!D.bansPer) D.bansPer = latestBans || 3;
  const key = [D.us, D.opp, D.patch].join('|');
  if (!engine || key !== engineKey || engine.m !== m) {
    const patches = D.patch === 'all' ? null : D.patch === 'latest' ? [m.patches[m.patches.length - 1]] : [D.patch];
    engine = new DraftEngine(m, { us: D.us, them: D.opp, patches, learner: learner(m) });
    engineKey = key;
    if (!D.lineup || D.lineup.key !== key) D.lineup = { key, us: engine.lineup.us, them: engine.lineup.them };
  }
  engine.lineup = { us: D.lineup.us.slice(), them: D.lineup.them.slice() };
  engine.comfortCache.clear();
  D.roles = D.roles || { us: {}, them: {} };
  D.tactics = D.tactics || {};
  engine.fixed = D.roles;
  D.fearless = D.fearless || 'off';
  D.series = D.series || { bestOf: 3, games: [], extra: [] };
  const lk = lockedSets();
  engine.locked = lk; engine.fearless = D.fearless;
  engine.seriesLeft = D.fearless === 'off' ? 0 : Math.max(0, D.series.bestOf - D.series.games.length - 1);
}

// Fearless series: champions used in earlier games of the series.
// Hard: nobody may pick them again. Soft: each team may not repick its own.
function usedInSeries() {
  const us = new Set(), them = new Set();
  for (const g of D.series?.games || []) { g.us.forEach((c) => us.add(c)); g.them.forEach((c) => them.add(c)); }
  for (const x of D.series?.extra || []) (x.who === 'them' ? them : us).add(x.c);
  return { us, them };
}
function lockedSets() {
  if (!D.fearless || D.fearless === 'off') return { us: new Set(), them: new Set() };
  const u = usedInSeries();
  if (D.fearless === 'soft') return u;
  const all = new Set([...u.us, ...u.them]);
  return { us: all, them: all };
}

function stateFrom(steps) {
  const st = { us: { picks: [], bans: [] }, them: { picks: [], bans: [] } };
  D.entries.forEach((c, i) => {
    const s = steps[i]; if (!s || !c) return;
    const who = s.side === D.side ? 'us' : 'them';
    st[who][s.kind === 'ban' ? 'bans' : 'picks'].push(c);
  });
  return st;
}

export function draftView(m, r, app) {
  if (!m.games.length) return '<div class="card">This save has no pro games yet, so there is nothing to base draft advice on.</div>';
  ensure(m, r);
  const steps = sequence(D.bansPer, D.order);
  const cur = D.entries.length;
  const step = steps[cur];
  const st = stateFrom(steps);
  const ourTurn = step && step.side === D.side;
  const patchOpts = [['latest', 'Latest patch'], ['all', 'All patches'], ...m.patches.map((p) => [p, `Patch ${p}`])];
  const teamOpts = m.teams.map((t) => [t.id, t.name]).sort((a, b) => a[1].localeCompare(b[1]));

  let recs = [], label = 'Draft complete';
  if (step) {
    const who = ourTurn ? 'us' : 'them';
    recs = step.kind === 'ban' ? engine.recommendBans(st, who, 10) : engine.recommendPicks(st, who, 10);
    label = `${ourTurn ? 'Your' : 'Their'} ${step.kind} ${steps.slice(0, cur + 1).filter((s) => s.side === step.side && s.kind === step.kind).length} of ${steps.filter((s) => s.side === step.side && s.kind === step.kind).length}`;
  }
  const L = learner(m);
  const predictFor = (usPicks, themPicks) => L.predict({ us: usPicks, them: themPicks, lineupUs: engine.lineup.us, lineupThem: engine.lineup.them, sideA: D.side === 'A', roles: D.roles });
  const out = predictFor(st.us.picks, st.them.picks);
  const recorded = D.recorded ? results.all().find((x) => x.id === D.recorded) : null;
  const assigned = { us: engine.assign('us', st.us.picks), them: engine.assign('them', st.them.picks) };

  const S = planStats(m);
  const sideInfo = (who) => {
    const byRole = [null, null, null, null, null];
    st[who].picks.forEach((c, i) => { const r = assigned[who].roles[i]; if (r != null) byRole[r] = c; });
    const ls = st[who].picks.map((c) => S.champ[c]?.late ?? 0);
    return { picks: st[who].picks, byRole, late: ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : 0 };
  };
  const sides = m.kits ? { us: sideInfo('us'), them: sideInfo('them') } : null;

  const sideOf = (who) => (who === 'us' ? D.side : D.side === 'A' ? 'B' : 'A');
  const chip = (c, cls = '') => `<span class="chip ${cls} cat-${(m.champs[c]?.cat || '').toLowerCase()}">${face(c)}${esc(m.champName(c))}</span>`;
  const cm = sides ? compModel(m) : null;
  const tcs = cm ? { us: teamComp(cm, st.us.picks), them: teamComp(cm, st.them.picks) } : null;
  const rm = cm && sides ? rangeMatchups(cm, sides.us.byRole, sides.them.byRole) : null;
  const rangeWarn = rm ? rm.lanes.filter((l) => l.penalty > 0.15).length + (rm.team > 0.15 ? 1 : 0) : 0;
  const ordinal = (i) => steps.slice(0, i + 1).filter((s) => s.kind === steps[i].kind && s.side === steps[i].side).length;

  // One team's column: bans, then its five picks in the order they come up, then a short read of its comp.
  const board = (who) => {
    const sideLetter = sideOf(who);
    const teamId = who === 'us' ? D.us : D.opp;
    const banSlots = steps.map((s, i) => ({ s, i })).filter((x) => x.s.side === sideLetter && x.s.kind === 'ban');
    const pickSlots = steps.map((s, i) => ({ s, i })).filter((x) => x.s.side === sideLetter && x.s.kind === 'pick');
    const pickNo = (i) => steps.slice(0, i + 1).filter((s) => s.kind === 'pick').length;
    const slot = ({ i }) => {
      const c = D.entries[i];
      const pickIdx = c ? st[who].picks.indexOf(c) : -1;
      const role = pickIdx >= 0 ? assigned[who].roles[pickIdx] : null;
      const aid = role != null ? engine.lineup[who][role] : null;
      const locked = c && D.roles[who][c] != null;
      const roleSel = role != null ? `<select name="role-${who}-${c}" data-draft="role" class="role-pick ${locked ? 'locked' : ''}" title="${locked ? 'Role you set' : 'Guessed role. Change it once you see where they play.'}">
          <option value="">${locked ? 'Guess' : ROLES[role] + ' (guess)'}</option>${ROLES.map((rn, ri) => `<option value="${ri}" ${locked && D.roles[who][c] === ri ? 'selected' : ''}>${rn}</option>`).join('')}</select>` : '';
      return `<div class="slot pick ${i === cur ? 'current' : ''} ${c ? 'filled' : ''}">
        <div class="slot-head"><span class="slot-no">P${pickNo(i)}</span>
        <span class="slot-main" ${c ? `data-action="draft-goto" data-step="${i}" title="Click to redo the draft from here"` : ''}>${c ? chip(c) : `<span class="muted small">${i === cur ? 'Picking now' : '–'}</span>`}</span></div>
        ${c ? `<div class="slot-sub">${role != null ? roleIcon(role) : ''}${roleSel}${aid != null ? `<span class="muted small">${esc(m.athletes[aid]?.name || '')}</span>` : ''}</div>` : ''}
      </div>`;
    };
    const ban = ({ i }) => {
      const c = D.entries[i];
      return c ? `<span class="slot-main ban-chip" data-action="draft-goto" data-step="${i}" title="Banned. Click to redo the draft from here">${chip(c, 'banned')}</span>`
        : `<span class="ban-empty ${i === cur ? 'current' : ''}">${i === cur ? 'now' : '–'}</span>`;
    };
    const tc = tcs?.[who], other = tcs?.[who === 'us' ? 'them' : 'us'];
    const miss = tc ? missingPieces(tc, other).slice(0, 3) : [];
    const summary = tc ? `<div class="team-comp" data-action="draft-tab" data-tab="comp" title="Open the Compositions tab">
        <div class="small"><strong>${esc(COMPS[tc.main].name)}</strong> <span class="muted">draft, backup ${esc(COMPS[tc.second].name.toLowerCase())}</span></div>
        ${miss.length ? `<ul class="threats small">${miss.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}</div>` : '';
    return `<section class="dr-team ${who} ${step && (step.side === sideLetter) ? 'turn' : ''}">
      <h2>${esc(m.teamName(teamId))} <span class="muted small">side ${sideLetter}${who === 'us' ? ' · you' : ''}</span></h2>
      <div class="dr-bans"><span class="muted small">Bans</span>${banSlots.map(ban).join('')}</div>
      <div class="dr-picks">${pickSlots.map(slot).join('')}</div>
      ${summary}
    </section>`;
  };

  // The whole draft in the order it happens. Click a filled step to redo from there.
  const timeline = () => {
    let html = '<span class="tl-sep">Bans</span>';
    steps.forEach((s, i) => {
      if (i && s.kind !== steps[i - 1].kind) html += '<span class="tl-sep">Picks</span>';
      const c = D.entries[i]; const who = s.side === D.side ? 'us' : 'them';
      html += `<button class="tl ${who} ${s.kind} ${i === cur ? 'current' : ''} ${c ? 'filled' : ''}" ${c ? `data-action="draft-goto" data-step="${i}" title="Redo the draft from here"` : 'tabindex="-1"'}>
        <span class="tl-lab">${who === 'us' ? 'You' : 'Them'} ${s.kind} ${ordinal(i)}</span>
        <span class="tl-c">${c ? `${face(c)}<span>${esc(m.champName(c))}</span>` : i === cur ? '<strong>Now</strong>' : ''}</span></button>`;
    });
    return `<div class="dr-timeline">${html}</div>`;
  };

  const byRoleOf = (who) => { const out = [null, null, null, null, null]; st[who].picks.forEach((c, i) => { const r = assigned[who].roles[i]; if (r != null) out[r] = c; }); return out; };
  // Both lineups listed by role, the way the game's Matchup panel shows them. With edit on, players can be swapped.
  const matchup = (edit = false) => {
    const row = (who, r) => {
      const c = byRoleOf(who)[r], aid = engine.lineup[who][r];
      const teamId = who === 'us' ? D.us : D.opp;
      const roster = (m.roster.get(teamId) || []).slice().sort((a, b) => b.rating - a.rating);
      const player = edit ? select(`lineup-${who}-${r}`, [['', '—'], ...roster.map((a) => [a.id, `${a.name} (${a.pos[r]})`])], D.lineup[who][r] ?? '', 'data-draft="lineup"')
        : `<span>${aid != null ? esc(m.athletes[aid]?.name || '') : '<span class="muted">–</span>'}</span>`;
      return `<div class="mu-row ${who}" title="${ROLES[r]}${c ? ': ' + esc(m.champName(c)) : ''}">${roleIcon(r)}<span class="mu-bar"></span><span class="mu-pt">${c ? face(c, 'full') : ''}</span>${player}</div>`;
    };
    return `<div class="matchup">${ROLES.map((_, r) => row('us', r) + row('them', r)).join('')}</div>`;
  };

  const partLabel = { patchStrength: 'Strength this patch', proBans: 'Teams ban it this patch', denySeries: 'Gone for them all series', saveForLater: 'Save for later games', meta: 'Meta', fit: 'Player and role fit', synergy: 'Synergy with your picks', counter: 'Against their picks', comp: 'Team composition', habit: 'Team habit', deny: 'Denies them', threat: 'Their pick value', comfortPick: 'Their comfort pick', oftenBannedVsThem: 'Usually banned vs them', ownLoss: 'You lose it too', yours: 'Your results' };
  const canAsk = askAvailable();
  // Compact suggestion: the champion (click to lock in), one short line, and the win chance.
  // Click anywhere else on the card to open the full breakdown.
  const recList = recs.map((x, k) => {
    const ch = m.champs[x.c];
    const parts = Object.entries(x.parts).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const who = ourTurn ? 'us' : 'them';
    const p = x.player != null ? m.athletes[step.kind === 'ban' ? engine.lineup[ourTurn ? 'them' : 'us'][x.role] : engine.lineup[who][x.role]] : null;
    const after = step.kind === 'pick' ? (ourTurn ? predictFor([...st.us.picks, x.c], st.them.picks) : predictFor(st.us.picks, [...st.them.picks, x.c])) : null;
    const open = openRecs.has(`${cur}|${x.c}`);
    const tip = `${x.role != null ? ROLES[x.role] + (p ? ' · ' + esc(p.name) : '') : esc(ch.cat)}`;
    const kr = open && sides ? kitReasons(m, x.c, step.kind, ourTurn ? sides.us : sides.them, ourTurn ? sides.them : sides.us, x.role) : [];
    const head = parts.slice(0, 2).map(([k2]) => partLabel[k2] || k2).join(', ');
    return `<div class="rec ${open ? 'open' : ''}" data-action="rec-toggle" data-c="${x.c}" title="${open ? 'Click to close' : 'Click for the full breakdown. Click the name to lock it in.'}">
      <button class="rec-pick" data-action="draft-pick" data-c="${x.c}" title="Lock in ${esc(ch.name)}">${face(x.c)}${esc(ch.name)}</button>
      <span class="rec-tip muted small" title="${esc(head)}">${tip}</span>
      ${canAsk ? `<button class="ask-why ghost small" data-action="ask-why" data-q="${esc(`Why ${ch.name}${step.kind === 'ban' ? ' as a ban' : ''}? Is it the right ${step.kind} here, or is something else better?`)}" title="Ask Claude about this ${step.kind}">Ask</button>` : ''}
      <span class="rec-win" title="${after != null ? `Your win chance if ${ourTurn ? 'you pick' : 'they pick'} this` : 'Ban score'}">${after != null ? pct(after) : x.total.toFixed(0)}</span>
      ${open ? `<div class="rec-more">
        <div class="small muted">#${k + 1} · ${esc(ch.cat)} · score ${x.total.toFixed(1)}${x.role != null ? ` · ${ROLES[x.role]}${p ? ' for ' + esc(p.name) : ''}` : ''}</div>
        <div class="parts">${parts.map(([k2, v]) => `<span class="part ${v >= 0 ? 'pos' : 'neg'}">${partLabel[k2] || k2} ${v >= 0 ? '+' : ''}${v.toFixed(1)}</span>`).join('')}</div>
        ${kr.length ? `<div class="parts kit">${kr.map((k3) => `<span class="part kitr ${k3.pos ? 'pos' : 'neg'}">${esc(k3.text)}</span>`).join('')}</div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  function resultBox(lead = '') {
    if (recorded) return `<div class="result-bar">${lead}<span>${recorded.won == null ? 'Saved to your match history. The result is filled in from your next save.' : `Recorded as a <strong>${recorded.won ? 'win' : 'loss'}</strong>. The model has learned from it.`}</span>
      <button data-action="draft-next">${D.fearless !== 'off' ? 'Next game in series' : 'Next draft'}</button><button class="ghost" data-action="draft-unrecord">Remove from history</button><a href="#/results">Match history</a></div>`;
    return `<div class="result-bar">${lead}<span title="Win chance with this draft"><strong>${pct(out)}</strong> · after the game:</span>
      <button data-action="draft-result" data-won="1">We won</button><button data-action="draft-result" data-won="0">We lost</button><button class="ghost" data-action="draft-result" data-won="" title="Every recorded draft stays in your match history when you load a newer save">From next save</button>
      ${D.fearless !== 'off' ? '<button class="ghost" data-action="draft-next">Next game, no record</button>' : ''}</div>`;
  }

  // After the draft: the game's two screens in the game's order. Tactics first (same columns as in game),
  // then item builds (one row per player, four item slots).
  function gamePlan() {
    if (st.us.picks.length < 5 || st.them.picks.length < 5) return '';
    const us = { byRole: byRoleOf('us') }, them = { byRole: byRoleOf('them') };
    const plan = recommendTactics(m, us, them, results.all().filter((h) => h.us === D.us));
    const ptab = D.planTab || 'tactics';
    const T = Object.fromEntries(TACTICS.map((t) => [t.key, t]));
    const group = (key) => {
      const t = T[key]; const rec = plan.tactics[key]; const cur = D.tactics[key] || rec.choice;
      const why = rec.reason + (rec.record ? ` You are ${rec.record.w}–${rec.record.g - rec.record.w} when you used it.` : '');
      return `<div class="tgroup"><h3 title="${esc(why)}">${esc(t.name)} <span class="kit-q">ⓘ</span></h3><div class="topts">${Object.entries(t.opts).map(([k, v]) =>
        `<button class="topt ${k === cur ? 'on' : ''}" data-action="tactic-set" data-k="${key}" data-v="${k}" title="${k === rec.choice ? 'Suggested. ' + esc(why) : 'Not the suggestion'}">${esc(v)}${k === rec.choice ? ' <span class="star">★</span>' : ''}</button>`).join('')}</div></div>`;
    };
    const tactics = `<div class="tactics-grid">
      <div>${group('focused')}${group('early_jungle')}${group('early_serpen')}${group('early_serpen_top')}</div>
      <div>${group('minion_wave')}${group('object_buildup')}${group('object_finish')}</div>
      <div>${group('morgard_use')}${group('tower_press')}${group('defense')}</div>
      <div>${group('game_finish')}<div class="tgroup"><h3>Matchup</h3>${matchup()}</div></div>
    </div>
    <p class="muted small">★ is the suggestion; hover a heading for why. Click to change it. What you set is saved with the result, so your record with each choice builds up.</p>`;

    const mathOn = !!(m.kits && m.items);
    const enemyTc = sides && compModel(m) ? teamComp(compModel(m), st.them.picks) : null;
    const ctx = mathOn ? { kits: m.kits, items: m.items, profiles: profiles(m), enemyComp: enemyTc?.scores } : null;
    const proRecord = (c, lines) => {
      const x = planStats(m).champ[c]; if (!x) return null;
      const want = lines.slice().sort().join('-'); let g = 0, w = 0;
      for (const [key, [n, k]] of x.builds) if (key.split('-').map(Number).sort().join('-') === want) { g += n; w += k; }
      return { g, w };
    };
    const slot = (v, why = '') => `<span class="bslot line-${LINES[v]?.key}" title="${esc(`${LINES[v]?.items.join(' → ') || ''}${why ? '\n' + why : ''}`)}">${esc(LINES[v]?.name || '?')}</span>`;
    const altTxt = (alts) => alts.length ? 'Next best:\n' + alts.map((a) => a.slots.map((v) => LINES[v].name).join(' → ') + (a.note ? ` (${a.note})` : '')).join('\n') : '';
    let threat = null;
    const rows = us.byRole.map((c, r) => {
      if (!c) return '';
      const aid = engine.lineup.us[r];
      const b = recommendBuilds(m, c, r, st.them.picks);
      const mb = ctx ? mathBuilds(ctx, c, st.them.picks) : null;
      if (mb && !threat) threat = mb.threat;
      let slots = null, whys = [], note = '', alts = [];
      if (mb?.builds.length) {
        const best = mb.builds[0]; const pr = proRecord(c, best.slots);
        slots = best.slots; whys = best.steps.map((s2) => stepReason(s2, mb.threat));
        note = pr?.g ? `Pros ${pr.w}–${pr.g - pr.w}` : 'Pros never used it';
        alts = mb.builds.slice(1).map((x) => { const q = proRecord(c, x.slots); return { slots: x.slots, note: q?.g ? `pros ${q.w}–${q.g - q.w}` : '' }; });
      } else if (b.builds[0]) {
        const best = b.builds[0]; slots = best.slots; note = `Pros ${best.w}–${best.g - best.w}`;
        alts = b.builds.slice(1).map((x) => ({ slots: x.slots, note: `${pct((x.w + 5) / (x.g + 10))} in ${x.g}` }));
      }
      const common = b.common ? 'Most common pro build: ' + b.common.key.split('-').map((v) => LINES[v].name).join(' → ') : '';
      return `<tr title="${esc([altTxt(alts), common].filter(Boolean).join('\n'))}">
        <td><div class="mu-row us">${roleIcon(r)}<span class="mu-bar"></span><span class="mu-pt">${face(c, 'full')}</span><span>${aid != null ? esc(m.athletes[aid]?.name || '') : '–'}<br><span class="muted small">${esc(m.champName(c))}</span></span></div></td>
        ${slots ? slots.map((v, k) => `<td>${slot(v, whys[k] || '')}</td>`).join('') : '<td colspan="4" class="muted small">Not enough pro games with this champion.</td>'}
        <td class="muted small">${esc(note)}</td></tr>`;
    }).join('');
    const threatTxt = threat ? `Their damage: about ${pct(threat.physShare)} physical, ${pct(threat.magicShare)} magic, ${pct(threat.aaShare)} from basic attacks${threat.divers ? `, ${threat.divers} diver${threat.divers > 1 ? 's' : ''}` : ''}.` : `Their damage is ${BUCKETS[damageBucket(m.champs, st.them.picks)]}.`;
    const builds = `${planStats(m).hasItems ? '' : '<p class="error small">This save was opened with an older version of the app, so item builds are missing. Open the save file again to add them.</p>'}
      <table class="data loadout"><thead><tr><th>Player</th><th>1st Item</th><th>2nd Item</th><th>3rd Item</th><th>4th Item</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">${threatTxt} ${mathOn ? `Worked out from each kit at level ${ITEM_LEVEL}: damage after their armor and magic resist, and time alive against their damage.` : 'From pro builds in this save.'} Hover an item for its upgrades and why, or a row for the next best builds. Builds change pro win rates very little, so this is a small edge.</p>`;
    const sub = `<div class="dr-subtabs"><button class="${ptab === 'tactics' ? 'active' : ''}" data-action="plan-tab" data-tab="tactics">1. Tactics</button><button class="${ptab === 'builds' ? 'active' : ''}" data-action="plan-tab" data-tab="builds">2. Item builds</button></div>`;
    return `${resultBox(sub)}<div class="plan">${ptab === 'tactics' ? tactics : builds}</div>`;
  }

  const taken = new Set(D.entries.filter(Boolean));
  const turnSide = step ? (ourTurn ? 'us' : 'them') : null;
  // during a pick, fearless locks apply to the side picking; bans can still name anything open
  const lockedNow = (c) => step && step.kind === 'pick' && engine.locked[turnSide].has(c);
  const q = (D.filter || '').toLowerCase();
  const grid = m.champIds.filter((c) => !q || m.champName(c).toLowerCase().includes(q))
    .sort((a, b) => (q ? (m.champName(b).toLowerCase().startsWith(q) - m.champName(a).toLowerCase().startsWith(q)) : 0) || m.champName(a).localeCompare(m.champName(b)))
    .map((c) => `<button class="gchamp cat-${(m.champs[c].cat || '').toLowerCase()} ${engine.locked.us.has(c) || engine.locked.them.has(c) ? 'used' : ''}" data-action="draft-pick" data-c="${c}" ${taken.has(c) || !step || lockedNow(c) ? 'disabled' : ''} ${lockedNow(c) ? 'title="Used earlier in the series"' : ''}>${face(c, 'full')}<span>${esc(m.champName(c))}</span></button>`).join('');

  function seriesBar() {
    if (D.fearless === 'off') return '';
    const u = usedInSeries();
    const n = D.series.games.length + 1;
    const chip = (c, who) => `<span class="chip cat-${(m.champs[c]?.cat || '').toLowerCase()}">${face(c)}${esc(m.champName(c))}<button class="x" data-action="series-remove" data-c="${c}" data-who="${who}" title="Remove">×</button></span>`;
    const champOpts = [['', 'Add a champion used earlier…'], ...m.champIds.slice().sort((a, b) => m.champName(a).localeCompare(m.champName(b))).map((c) => [c, m.champName(c)])];
    return `<div class="card series">
      <h2>Fearless series · ${n <= D.series.bestOf ? `game ${n} of ${D.series.bestOf}` : `past best of ${D.series.bestOf}, start a new series when this one is over`} <span class="muted small">${D.fearless === 'hard' ? 'nobody can pick a champion used earlier in the series' : 'each team cannot pick a champion it used earlier in the series'}</span></h2>
      <div class="grid two">
        <div><strong>${esc(m.teamName(D.us))} used</strong><div>${[...u.us].map((c) => chip(c, 'us')).join('') || '<span class="muted small">Nothing yet</span>'}</div></div>
        <div><strong>${esc(m.teamName(D.opp))} used</strong><div>${[...u.them].map((c) => chip(c, 'them')).join('') || '<span class="muted small">Nothing yet</span>'}</div></div>
      </div>
      <div class="row gap"><label>${select('series-add-c', champOpts, '', 'data-draft="series-add"')}</label>
        <label>used by ${select('series-add-who', [['us', m.teamName(D.us)], ['them', m.teamName(D.opp)]], D.seriesAddWho || 'them', 'data-draft="series-who"')}</label>
        <button class="ghost" data-action="series-new">Start a new series</button></div>
      <p class="muted small">Finished games are added here when you go to the next game. If you start using the tool mid-series, add the champions from earlier games above. Suggestions skip locked champions and, with games still to play, weigh saving your players' best champions for later.</p>
    </div>`;
  }

  let tab = step ? (D.tab || 'pick') : (D.tab && D.tab !== 'pick' ? D.tab : 'pick');
  if (tab === 'ask' && !askAvailable()) tab = 'pick';
  const tabs = [
    ['pick', step ? 'Suggestions' : 'Result and game plan'],
    ['comp', `Compositions${rangeWarn ? ` <span class="warn-dot" title="Range warnings">${rangeWarn}</span>` : ''}`],
    ['lineup', 'Lineups'],
    ['settings', `Settings${D.fearless !== 'off' ? ' and series' : ''}`],
  ];
  if (canAsk) tabs.splice(1, 0, ['ask', 'Ask Claude']);
  setAskContext({ app, m, D, engine, st, steps, cur, step, ourTurn, recs, assigned, out, L, sides, partLabel, label, predictFor });
  const hint = !step ? 'Record the result once the game is over. The game plan below has builds and tactics.'
    : ourTurn ? (step.kind === 'ban' ? 'Bans that take away what they want most, minus what you would lose.' : 'Picks scored for your lineup and this draft.')
      : (step.kind === 'ban' ? 'What they are likely to ban. Enter what they actually ban.' : 'What they are likely to pick. Enter what they actually take.');
  const fearlessTag = D.fearless !== 'off' ? `<button class="tag tag-fearless" data-action="draft-tab" data-tab="settings" title="Fearless series settings">Fearless ${D.fearless} · game ${Math.min(D.series.games.length + 1, D.series.bestOf)} of ${D.series.bestOf}</button>` : '';

  let body = '';
  if (tab === 'pick') {
    body = step ? `<div class="dr-pick">
        <div class="dr-recs"><div class="recs-head muted small" title="Click a card for the full breakdown. Click the name to lock it in."><span>${ourTurn ? 'Suggested' : 'Likely'} ${step.kind}s</span><span>${step.kind === 'pick' ? 'Your win %' : 'Score'}</span></div><div class="recs">${recList}</div></div>
        <div class="dr-pool">
          <input name="draft-filter" data-draft="filter" data-live autocomplete="off" placeholder="Type a champion, Enter to lock in" value="${esc(D.filter || '')}">
          <div class="cgrid">${grid}</div>
        </div>
      </div>` : (gamePlan() || resultBox());
  } else if (tab === 'ask') {
    body = askTab({ step });
    queueMicrotask(afterRender);
  } else if (tab === 'comp') {
    body = sides ? (compCard(m, sides) || '<p class="muted">Compositions fill in once champions are picked.</p>') : '<p class="muted">Compositions need champion kits. Point the app at your game files on the load screen.</p>';
  } else if (tab === 'lineup') {
    body = `<div class="lineups"><div class="mu-head"><strong>${esc(m.teamName(D.us))}</strong><strong>${esc(m.teamName(D.opp))}</strong></div>${matchup(true)}</div>
      <p class="muted small">Who plays each role, listed like the game's Matchup panel. Suggestions use these players' champion skill and role fit.</p>`;
  } else {
    body = `<div class="card"><h2>Draft settings</h2><div class="filters">
      <label>Bans each ${select('bansPer', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], D.bansPer, 'data-draft="setup"')}</label>
      <label>Pick order ${select('order', [['snake', 'A B B A A B B A A B'], ['alt', 'A B A B A B A B A B']], D.order, 'data-draft="setup"')}</label>
      <label>Data ${select('patch', patchOpts, D.patch, 'data-draft="setup"')}</label>
      <label>Fearless ${select('fearless', [['off', 'Off'], ['hard', 'Hard (nobody repicks)'], ['soft', 'Soft (own picks only)']], D.fearless, 'data-draft="setup"')}</label>
      ${D.fearless !== 'off' ? `<label>Best of ${select('bestOf', [[3, '3'], [5, '5'], [7, '7']], D.series.bestOf, 'data-draft="setup"')}</label>` : ''}
    </div>
    <p class="muted small">Suggestions are based on ${engine.games.length} pro games. The win chance comes from a model trained on ${L.pro.length} pro games${L.mine.length ? ` and ${L.mine.length} of your results` : ''}. <a href="#/results">How it learns</a></p></div>
    ${seriesBar()}`;
  }

  return `<div class="dr">
  <div class="dr-top">
    <label>You ${select('us', teamOpts, D.us, 'data-draft="setup"')}</label>
    <label>vs ${select('opp', teamOpts, D.opp, 'data-draft="setup"')}</label>
    <label>Side ${select('side', [['A', 'A (first pick)'], ['B', 'B']], D.side, 'data-draft="setup"')}</label>
    ${fearlessTag}
    <span class="dr-win" title="Win chance for ${esc(m.teamName(D.us))}, from a model trained on ${L.pro.length} pro games${L.mine.length ? ` and ${L.mine.length} of your results` : ''}">Win chance <span class="bar"><span style="width:${Math.round(out * 100)}%"></span></span><strong>${pct(out)}</strong></span>
    <span class="spacer"></span>
    <button class="ghost" data-action="draft-undo" ${cur ? '' : 'disabled'} title="Take back the last ban or pick">Undo</button>
    <button class="ghost" data-action="draft-reset" title="Clear this draft">Reset</button>
  </div>
  ${timeline()}
  <div class="dr-main">
    ${board('us')}
    <section class="dr-center">
      <div class="dr-now ${turnSide || 'done'}"><div class="dr-step">${esc(label)}</div>${step ? `<div class="muted small">${hint}</div>` : ''}</div>
      <div class="dr-tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" class="${k === tab ? 'active' : ''}" data-action="draft-tab" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="dr-body">${body}</div>
    </section>
    ${board('them')}
  </div>
</div>`;
}

// Tactics as they stand: your changes on top of the suggestions.
function currentTactics(m, st) {
  const byRole = (who) => { const out = [null, null, null, null, null]; const a = engine.assign(who, st[who].picks); st[who].picks.forEach((c, i) => { const r = a.roles[i]; if (r != null) out[r] = c; }); return out; };
  if (st.us.picks.length < 5 || st.them.picks.length < 5) return null;
  const plan = recommendTactics(m, { byRole: byRole('us') }, { byRole: byRole('them') });
  return Object.fromEntries(TACTICS.map((t) => [t.key, D.tactics?.[t.key] || plan.tactics[t.key].choice]));
}

export function draftEvents(a, el, app) {
  if (!D) return false;
  if (a === 'ask-why') { D.tab = 'ask'; save(); }
  if (a.startsWith('ask-')) return askEvents(a, el);
  const steps = sequence(D.bansPer, D.order);
  if (a === 'draft-pick') { if (D.entries.length < steps.length && !D.entries.includes(el.dataset.c)) { D.entries.push(el.dataset.c); D.filter = ''; if (D.entries.length === steps.length) D.tab = 'pick'; save(); } return true; }
  if (a === 'rec-toggle') { const k = `${D.entries.length}|${el.dataset.c}`; if (openRecs.has(k)) openRecs.delete(k); else openRecs.add(k); return true; }
  if (a === 'plan-tab') { D.planTab = el.dataset.tab; save(); return true; }
  if (a === 'tactic-set') { D.tactics = D.tactics || {}; D.tactics[el.dataset.k] = el.dataset.v; save(); return true; }
  if (a === 'draft-tab') { D.tab = el.dataset.tab; save(); return true; }
  if (a === 'enter' && el.dataset.draft === 'filter') {
    const first = document.querySelector('.cgrid button.gchamp:not(:disabled)');
    if (first && D.entries.length < steps.length) { D.entries.push(first.dataset.c); D.filter = ''; save(); }
    return true;
  }
  if (a === 'draft-undo') { D.entries.pop(); D.recorded = null; save(); return true; }
  if (a === 'draft-reset') { D.entries = []; D.recorded = null; D.roles = { us: {}, them: {} }; D.tactics = {}; save(); return true; }
  if (a === 'series-new') { D.series = { bestOf: D.series?.bestOf || 3, games: [], extra: [] }; D.entries = []; D.recorded = null; D.roles = { us: {}, them: {} }; D.tactics = {}; save(); return true; }
  if (a === 'series-remove') {
    const { c, who } = el.dataset;
    D.series.extra = (D.series.extra || []).filter((x) => !(x.c === c && x.who === who));
    for (const g of D.series.games) g[who] = g[who].filter((x) => x !== c);
    save(); return true;
  }
  if (a === 'draft-next' && D.fearless !== 'off') {
    const st = stateFrom(steps);
    if (st.us.picks.length || st.them.picks.length) D.series.games.push({ us: st.us.picks, them: st.them.picks });
  }
  if (a === 'draft-next') { D.entries = []; D.recorded = null; D.roles = { us: {}, them: {} }; D.tactics = {}; save(); return true; }
  if (a === 'draft-result') {
    const m = app.model, st = stateFrom(steps), L = learner(m);
    const rec = {
      id: Date.now().toString(36), at: new Date().toISOString(), gameDate: m.db.date,
      us: D.us, opp: D.opp, usName: m.teamName(D.us), oppName: m.teamName(D.opp), side: D.side,
      picks: { us: st.us.picks, them: st.them.picks }, bans: { us: st.us.bans, them: st.them.bans },
      lineup: { us: engine.lineup.us.slice(), them: engine.lineup.them.slice() },
      roles: { us: { ...D.roles.us }, them: { ...D.roles.them } }, series: D.fearless !== 'off' ? { mode: D.fearless, game: D.series.games.length + 1, bestOf: D.series.bestOf } : null, tactics: currentTactics(m, st),
      predicted: L.predict({ us: st.us.picks, them: st.them.picks, lineupUs: engine.lineup.us, lineupThem: engine.lineup.them, sideA: D.side === 'A', roles: D.roles }),
      won: el.dataset.won === '' ? null : el.dataset.won === '1',
    };
    results.save([...results.all(), rec]); L.retrain();
    D.recorded = rec.id; save(); return true;
  }
  if (a === 'draft-unrecord') { results.save(results.all().filter((x) => x.id !== D.recorded)); learner(app.model).retrain(); D.recorded = null; save(); return true; }
  if (a === 'draft-goto') { const i = +el.dataset.step; if (i < D.entries.length) { D.entries = D.entries.slice(0, i); D.recorded = null; save(); } return true; }
  if ((a === 'change' || a === 'input') && el.dataset.draft) {
    if (el.dataset.draft === 'filter') { D.filter = el.value; save(); return true; }
    if (el.dataset.draft === 'setup') {
      const v = el.value;
      if (el.name === 'bestOf') { D.series.bestOf = +v; save(); return true; }
      if (el.name === 'fearless') { D.fearless = v; save(); return true; }
      if (el.name === 'us' || el.name === 'opp' || el.name === 'bansPer') D[el.name] = +v; else D[el.name] = v;
      if (el.name !== 'patch') { D.entries = []; D.recorded = null; }
      if (el.name === 'us' || el.name === 'opp') D.series = { bestOf: D.series?.bestOf || 3, games: [], extra: [] };
      if (el.name === 'us' || el.name === 'opp') D.lineup = null;
      save(); return true;
    }
    if (el.dataset.draft === 'role') {
      const [, who, ...rest] = el.name.split('-'); const c = rest.join('-');
      D.roles = D.roles || { us: {}, them: {} };
      if (el.value === '') delete D.roles[who][c]; else D.roles[who][c] = +el.value;
      save(); return true;
    }
    if (el.dataset.draft === 'series-who') { D.seriesAddWho = el.value; save(); return true; }
    if (el.dataset.draft === 'series-add') {
      if (el.value) { D.series.extra = D.series.extra || []; const who = D.seriesAddWho || 'them'; if (!D.series.extra.some((x) => x.c === el.value && x.who === who)) D.series.extra.push({ c: el.value, who }); save(); }
      return true;
    }
    if (el.dataset.draft === 'tactic') { D.tactics = D.tactics || {}; D.tactics[el.name.slice(7)] = el.value; save(); return true; }
    if (el.dataset.draft === 'lineup') {
      const [, who, i] = el.name.split('-');
      D.lineup[who][+i] = el.value === '' ? null : +el.value; save(); return true;
    }
  }
  return false;
}
