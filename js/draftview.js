import { DraftEngine } from './draft.js';
import { ROLES, pct } from './model.js';
import { esc, select } from './ui.js';
import { local } from './store.js';
import { learner, results } from './learn.js';

let D = local.get('draft', null);
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

export function draftView(m, r) {
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
    label = `${ourTurn ? 'Your' : `${m.teamName(D.opp)}'s`} ${step.kind} (${step.kind === 'ban' ? 'ban' : 'pick'} ${steps.slice(0, cur + 1).filter((s) => s.side === step.side && s.kind === step.kind).length})`;
  }
  const L = learner(m);
  const predictFor = (usPicks, themPicks) => L.predict({ us: usPicks, them: themPicks, lineupUs: engine.lineup.us, lineupThem: engine.lineup.them, sideA: D.side === 'A' });
  const out = predictFor(st.us.picks, st.them.picks);
  const recorded = D.recorded ? results.all().find((x) => x.id === D.recorded) : null;
  const assigned = { us: engine.assign('us', st.us.picks), them: engine.assign('them', st.them.picks) };

  const board = (who) => {
    const sideLetter = who === 'us' ? D.side : D.side === 'A' ? 'B' : 'A';
    const teamId = who === 'us' ? D.us : D.opp;
    const banSlots = steps.map((s, i) => ({ s, i })).filter((x) => x.s.side === sideLetter && x.s.kind === 'ban');
    const pickSlots = steps.map((s, i) => ({ s, i })).filter((x) => x.s.side === sideLetter && x.s.kind === 'pick');
    const slot = ({ i }, kind) => {
      const c = D.entries[i];
      const pickIdx = kind === 'pick' && c ? st[who].picks.indexOf(c) : -1;
      const role = pickIdx >= 0 ? assigned[who].roles[pickIdx] : null;
      const aid = role != null ? engine.lineup[who][role] : null;
      return `<div class="slot ${kind} ${i === cur ? 'current' : ''} ${c ? 'filled' : ''}" data-action="draft-goto" data-step="${i}" title="Click to redo from here">
        ${c ? `<span class="chip cat-${(m.champs[c]?.cat || '').toLowerCase()}">${esc(m.champName(c))}</span>` : `<span class="muted">${i === cur ? 'now' : '–'}</span>`}
        ${role != null ? `<span class="muted small">${ROLES[role]}${aid != null ? ' · ' + esc(m.athletes[aid]?.name || '') : ''}</span>` : ''}
      </div>`;
    };
    return `<div class="card board ${who}">
      <h2>${esc(m.teamName(teamId))} <span class="muted small">side ${sideLetter}${who === 'us' ? ' · you' : ''}</span></h2>
      <div class="bans">${banSlots.map((x) => slot(x, 'ban')).join('')}</div>
      <div class="picks">${pickSlots.map((x) => slot(x, 'pick')).join('')}</div>
    </div>`;
  };

  const lineupEditor = (who) => {
    const teamId = who === 'us' ? D.us : D.opp;
    const roster = (m.roster.get(teamId) || []).slice().sort((a, b) => b.rating - a.rating);
    return `<div class="lineup">${ROLES.map((role, i) => `<label>${role} ${select(`lineup-${who}-${i}`, [['', '—'], ...roster.map((a) => [a.id, `${a.name} (${a.pos[i]})`])], D.lineup[who][i] ?? '', 'data-draft="lineup"')}</label>`).join('')}</div>`;
  };

  const partLabel = { meta: 'Meta', fit: 'Player and role fit', synergy: 'Synergy with your picks', counter: 'Against their picks', comp: 'Team composition', habit: 'Team habit', deny: 'Denies them', threat: 'Their pick value', comfortPick: 'Their comfort pick', oftenBannedVsThem: 'Usually banned vs them', ownLoss: 'You lose it too', yours: 'Your results' };
  const recList = recs.map((x, k) => {
    const ch = m.champs[x.c];
    const parts = Object.entries(x.parts).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const who = ourTurn ? 'us' : 'them';
    const p = x.player != null ? m.athletes[step.kind === 'ban' ? engine.lineup[ourTurn ? 'them' : 'us'][x.role] : engine.lineup[who][x.role]] : null;
    const after = step.kind === 'pick' ? (ourTurn ? predictFor([...st.us.picks, x.c], st.them.picks) : predictFor(st.us.picks, [...st.them.picks, x.c])) : null;
    return `<div class="rec">
      <button class="rec-pick" data-action="draft-pick" data-c="${x.c}">${k + 1}. ${esc(ch.name)}</button>
      <span class="muted small">${esc(ch.cat)}${x.role != null ? ` · ${ROLES[x.role]}${p ? ' for ' + esc(p.name) : ''}` : ''}</span>
      <span class="score">${x.total.toFixed(1)}${after != null ? `<span class="muted small" title="Your win chance if this is picked">${pct(after)} win</span>` : ''}</span>
      <div class="parts">${parts.map(([k2, v]) => `<span class="part ${v >= 0 ? 'pos' : 'neg'}">${partLabel[k2] || k2} ${v >= 0 ? '+' : ''}${v.toFixed(1)}</span>`).join('')}</div>
    </div>`;
  }).join('');

  function resultBox() {
    if (recorded) return `<p>Recorded as a <strong>${recorded.won ? 'win' : 'loss'}</strong>. The model has been updated with it.</p>
      <div class="row gap"><button data-action="draft-next">Next draft</button><button class="ghost" data-action="draft-unrecord">Undo the result</button><a href="#/results">See all results</a></div>`;
    return `<p>The model gives you a <strong>${pct(out)}</strong> chance with this draft. Once the game is over, record how it went so it can learn from it.</p>
      <div class="row gap"><button data-action="draft-result" data-won="1">We won</button><button data-action="draft-result" data-won="0">We lost</button></div>
      <p class="muted small">Or undo to try another line.</p>`;
  }

  const taken = new Set(D.entries.filter(Boolean));
  const q = (D.filter || '').toLowerCase();
  const grid = m.champIds.filter((c) => !q || m.champName(c).toLowerCase().includes(q))
    .sort((a, b) => m.champName(a).localeCompare(m.champName(b)))
    .map((c) => `<button class="gchamp cat-${(m.champs[c].cat || '').toLowerCase()}" data-action="draft-pick" data-c="${c}" ${taken.has(c) || !step ? 'disabled' : ''}>${esc(m.champName(c))}</button>`).join('');

  return `
  <h1>Draft</h1>
  <div class="filters">
    <label>You ${select('us', teamOpts, D.us, 'data-draft="setup"')}</label>
    <label>Against ${select('opp', teamOpts, D.opp, 'data-draft="setup"')}</label>
    <label>Your side ${select('side', [['A', 'A (first pick)'], ['B', 'B']], D.side, 'data-draft="setup"')}</label>
    <label>Bans each ${select('bansPer', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], D.bansPer, 'data-draft="setup"')}</label>
    <label>Pick order ${select('order', [['snake', 'A B B A A B B A A B'], ['alt', 'A B A B A B A B A B']], D.order, 'data-draft="setup"')}</label>
    <label>Data ${select('patch', patchOpts, D.patch, 'data-draft="setup"')}</label>
    <button class="ghost" data-action="draft-undo" ${cur ? '' : 'disabled'}>Undo</button>
    <button class="ghost" data-action="draft-reset">Reset</button>
  </div>
  <p class="muted small">Based on ${engine.games.length} games. Enter each ban and pick as it happens in game: click a suggestion, or a champion below. Click a filled slot to redo the draft from there.</p>
  <div class="outlook"><span>Win chance</span><span class="bar wide"><span style="width:${Math.round(out * 100)}%"></span></span><strong>${pct(out)}</strong><span class="muted small">win chance for ${esc(m.teamName(D.us))}, from a model trained on ${L.pro.length} pro games${L.mine.length ? ` and ${L.mine.length} of your results` : ''}. <a href="#/results">How it learns</a></span></div>
  <div class="draft-grid">
    ${board('us')}
    <div class="card center">
      <h2>${esc(label)}</h2>
      ${step ? `<p class="muted small">${ourTurn ? (step.kind === 'ban' ? 'Bans that take away what they want most, minus what you would lose.' : 'Picks scored for your lineup and this draft.') : (step.kind === 'ban' ? 'What they are likely to ban.' : 'What they are likely to pick. Enter what they actually take.')}</p>` : ''}
      ${step ? `<div class="recs">${recList}</div>` : resultBox()}
    </div>
    ${board('them')}
  </div>
  <div class="grid two">
    <div class="card"><h2>Your lineup</h2>${lineupEditor('us')}</div>
    <div class="card"><h2>Their lineup</h2>${lineupEditor('them')}</div>
  </div>
  <div class="card">
    <h2>All champions</h2>
    <input name="draft-filter" data-draft="filter" data-live placeholder="Filter champions" value="${esc(D.filter || '')}">
    <div class="cgrid">${grid}</div>
  </div>`;
}

export function draftEvents(a, el, app) {
  if (!D) return false;
  const steps = sequence(D.bansPer, D.order);
  if (a === 'draft-pick') { if (D.entries.length < steps.length && !D.entries.includes(el.dataset.c)) { D.entries.push(el.dataset.c); D.filter = ''; save(); } return true; }
  if (a === 'draft-undo') { D.entries.pop(); D.recorded = null; save(); return true; }
  if (a === 'draft-reset') { D.entries = []; D.recorded = null; save(); return true; }
  if (a === 'draft-next') { D.entries = []; D.recorded = null; save(); return true; }
  if (a === 'draft-result') {
    const m = app.model, st = stateFrom(steps), L = learner(m);
    const rec = {
      id: Date.now().toString(36), at: new Date().toISOString(), gameDate: m.db.date,
      us: D.us, opp: D.opp, usName: m.teamName(D.us), oppName: m.teamName(D.opp), side: D.side,
      picks: { us: st.us.picks, them: st.them.picks }, bans: { us: st.us.bans, them: st.them.bans },
      lineup: { us: engine.lineup.us.slice(), them: engine.lineup.them.slice() },
      predicted: L.predict({ us: st.us.picks, them: st.them.picks, lineupUs: engine.lineup.us, lineupThem: engine.lineup.them, sideA: D.side === 'A' }),
      won: el.dataset.won === '1',
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
      if (el.name === 'us' || el.name === 'opp' || el.name === 'bansPer') D[el.name] = +v; else D[el.name] = v;
      if (el.name !== 'patch') { D.entries = []; D.recorded = null; }
      if (el.name === 'us' || el.name === 'opp') D.lineup = null;
      save(); return true;
    }
    if (el.dataset.draft === 'lineup') {
      const [, who, i] = el.name.split('-');
      D.lineup[who][+i] = el.value === '' ? null : +el.value; save(); return true;
    }
  }
  return false;
}
