// "Next actions": what a manager should do next, from the save's own numbers.
import { managerAdvice, fmt, KNOWN } from './manager.js';
import { ROLES, STAT_LABELS, pct } from './model.js';
import { esc, table, bar, link, setSort } from './ui.js';
import { filtersFor } from './views.js';

const CAT = { lineup: 'Lineup', training: 'Training', contracts: 'Contracts', signings: 'Signings', experience: 'Player experience', fans: 'Fans' };
const chip = (m, c, extra = '') => `<a class="chip cat-${(m.champs[c]?.cat || 'x').toLowerCase()}" href="#/champ/${c}">${esc(m.champName(c))}${extra}</a>`;
const player = (m, id) => { const a = m.athletes[id]; return a ? link(`#/player/${a.id}`, a.name) : ''; };
const gainTag = (g) => (g > 0.0005 ? `<span class="gain">+${(g * 100).toFixed(1)}% win</span>` : '');

function actionCard(m, x) {
  const money = x.saving > 0 ? `<span class="gain">${fmt(x.saving)} a year</span>` : '';
  return `<div class="action">
    <div class="action-head"><span class="tag tag-${x.cat}">${esc(CAT[x.cat] || x.cat)}</span><strong>${esc(x.title)}</strong>${gainTag(x.gain)}${money}</div>
    <div class="small">${esc(x.why)}</div>
    ${x.players?.length > 1 && x.players.length <= 12 && x.cat === 'contracts' ? `<div class="small muted">${x.players.map((id) => player(m, id)).join(', ')}</div>` : ''}
  </div>`;
}

export function nextView(m) {
  const f = filtersFor('next');
  const maxM = parseFloat(f.maxSalary);
  const x = managerAdvice(m, { maxSalary: maxM > 0 ? maxM * 1e6 : null });
  if (x.error) return `<div class="card">${esc(x.error)} Next actions needs to know which team is yours.</div>`;
  const F = x.f;
  const t = m.teams[m.myTeam];
  const fans = x.fans;

  const coverage = table('next-cover', x.coverage, [
    { key: 'r', label: 'Role', html: (c) => ROLES[c.r] },
    { key: 'a', label: 'Starter', value: (c) => c.a.name, html: (c) => player(m, c.a.id) },
    { key: 'known', label: 'Strong picks they play', cls: 'num', value: (c) => c.known, html: (c) => `${c.known} of ${c.of}` },
    { key: 'list', label: `Strongest in the role (proficiency)`, value: () => 0, html: (c) => c.list.map((s) => {
      const p = c.a.prof?.[s.c]?.[0] ?? 50;
      return chip(m, s.c, ` <span class="${p >= KNOWN ? 'win' : 'muted'}">${p}</span>`);
    }).join(' ') || '<span class="muted">Too few games</span>' },
    { key: 'weak', label: 'Trained but weak now', value: () => 0, html: (c) => (c.weak || []).map((ch) => chip(m, ch)).join(' ') || '<span class="muted">–</span>' },
  ]);

  const rosterRows = x.roster.map((a) => ({ a, fair: x.sal.fair(a), imp: x.imp(a), starter: x.starterIds.has(a.id) }));
  setSort('next-roster', 'imp');
  for (let r = 0; r < 5; r++) setSort('next-cand-' + r, 'value');
  const rosterTable = table('next-roster', rosterRows, [
    { key: 'name', label: 'Player', value: (r) => r.a.name, html: (r) => `${player(m, r.a.id)}${r.starter ? ' <span class="tag tag-lineup">Starter</span>' : ''}` },
    { key: 'role', label: 'Role', value: (r) => r.a.mainRole, html: (r) => `${ROLES[r.a.mainRole]} <span class="muted">${r.a.roleRating}</span>` },
    { key: 'age', label: 'Age', cls: 'num', value: (r) => r.a.age },
    { key: 'imp', label: 'Impact', cls: 'num', value: (r) => r.imp, html: (r) => r.imp.toFixed(1) },
    { key: 'avg', label: 'Avg stat', cls: 'num', value: (r) => r.a.rating },
    { key: 'pot', label: 'Potential', cls: 'num', value: (r) => r.a.potential },
    { key: 'sal', label: 'Salary', cls: 'num', value: (r) => r.a.contract?.salary || 0, html: (r) => fmt(r.a.contract?.salary) },
    { key: 'fair', label: 'Market rate', cls: 'num', value: (r) => r.fair, html: (r) => fmt(r.fair) },
    { key: 'ratio', label: 'Pay vs market', cls: 'num', value: (r) => (r.a.contract?.salary || 0) / Math.max(1, r.fair), html: (r) => { const v = (r.a.contract?.salary || 0) / Math.max(1, r.fair); return `<span class="${v > 1.6 ? 'loss' : v < 0.8 ? 'win' : ''}">${v.toFixed(2)}×</span>`; } },
    { key: 'end', label: 'Contract ends', value: (r) => r.a.contract?.end || '', html: (r) => esc((r.a.contract?.end || '').slice(0, 10)) },
  ]);

  const candTable = (rows, id) => table(id, rows, [
    { key: 'name', label: 'Player', value: (c) => c.a.name, html: (c) => player(m, c.a.id) },
    { key: 'team', label: 'Team', value: (c) => m.teamName(c.a.team), html: (c) => (c.a.team >= 0 ? link(`#/team/${c.a.team}`, m.teamName(c.a.team)) : '<span class="muted">Free agent</span>') },
    { key: 'age', label: 'Age', cls: 'num', value: (c) => c.a.age },
    { key: 'rr', label: 'Role rating', cls: 'num', value: (c) => c.a.pos[c.r] },
    { key: 'd', label: 'Impact gain', cls: 'num', value: (c) => c.d, html: (c) => `+${c.d.toFixed(1)}` },
    { key: 'gain', label: 'Win chance', cls: 'num', value: (c) => c.gain, html: (c) => `+${(c.gain * 100).toFixed(1)}%` },
    { key: 'ask', label: 'Expected salary', cls: 'num', value: (c) => c.ask, html: (c) => fmt(c.ask) },
    { key: 'value', label: 'Win % per 1M', cls: 'num', value: (c) => c.value, html: (c) => (c.value * 100).toFixed(2) },
    { key: 'avail', label: 'Availability', value: (c) => (c.avail === 'free' ? 2 : c.avail === 'expiring' ? 1 : 0), html: (c) => (c.avail === 'free' ? '<span class="win">Free agent</span>' : c.avail === 'expiring' ? `Ends ${esc(c.a.contract.end.slice(0, 10))}` : `Under contract to ${esc(c.a.contract.end.slice(0, 4))}`) },
  ], { empty: 'Nobody clearly better within this salary.' });

  const W = F ? F.weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w) : [];
  const maxW = Math.max(...W.map((v) => v.w), 0.01);
  const lineupNote = x.lineupActions.length ? x.lineupActions.map((a) => actionCard(m, a)).join('') : '<p class="small">Your last starting five is already the strongest five on your roster by impact.</p>';

  return `
  <h1>Next actions</h1>
  <p class="muted">For ${esc(t.name)}, in-game date ${esc(m.db.date)}. Every suggestion is measured on the ${F ? F.n.toLocaleString() : 0} pro games in this save: what actually wins, and what it costs. Payroll ${fmt(x.payroll)} a year across ${x.roster.length} players.</p>

  <div class="card">
    <h2>Do these first</h2>
    ${x.top.map((a) => actionCard(m, a)).join('') || '<p class="muted">Nothing urgent.</p>'}
    <p class="muted small">Win chance is per game, against an even opponent. Training gains count only in games where you pick that champion.</p>
  </div>

  <div class="card">
    <h2>Lineup</h2>
    ${lineupNote}
  </div>

  <div class="card">
    <h2>Champion training</h2>
    <p class="muted small">The strongest champions in each role on patch ${esc(x.patchLabel)} (${x.games} games, smoothed win rate 52% or more), and your starter's proficiency on each. In pro games a player on a champion with under 100 proficiency wins ${pct(bucketWr(F, 0))}, with ${KNOWN} to 349 ${pct(bucketWr(F, 2))}, with 500 or more ${pct(bucketWr(F, 4))}. Green means ${KNOWN} or more.</p>
    ${coverage}
    <h2 style="margin-top:14px">What to train</h2>
    ${x.training.slice(0, 8).map((a) => actionCard(m, a)).join('') || '<p class="small">Your five already cover the strong champions in their roles.</p>'}
  </div>

  <div class="card">
    <h2>Contracts</h2>
    ${x.contracts.map((a) => actionCard(m, a)).join('') || '<p class="small">No contract decisions due.</p>'}
    <h2 style="margin-top:14px">Your roster</h2>
    <p class="muted small">Market rate is what the save's ${m.athletes.filter((a) => a.team >= 0).length} contracts pay for the same impact, potential and age (it explains 90% of salary differences). Red means paid over 1.6× the market, green under 0.8×.</p>
    ${rosterTable}
  </div>

  <div class="card">
    <h2>Signings</h2>
    <div class="filters"><label>Highest salary you would pay (M a year) <input name="maxSalary" type="number" step="0.5" min="0" class="tiny" data-filter="next" value="${esc(f.maxSalary || '')}" placeholder="${(x.maxSalary / 1e6).toFixed(1)}"></label></div>
    <p class="muted small">Players who can play the role (rating 80+) with clearly more impact than your starter. Free agents and contracts ending this year come first, because they cost no transfer fee. Expected salary is the higher of their market rate and their current salary. ${maxM > 0 ? '' : 'The default limit is 1.5× your highest salary.'}</p>
    ${x.signings.map((a) => actionCard(m, a)).join('') || '<p class="small">No clear upgrades within this salary.</p>'}
    ${ROLES.map((role, r) => `<h2 style="margin-top:14px">${role} <span class="muted small">vs ${x.lineup[r] ? esc(x.lineup[r].name) : 'nobody'} (impact ${x.lineup[r] ? x.imp(x.lineup[r]).toFixed(1) : '–'})</span></h2>${candTable(x.bestPerRole[r], 'next-cand-' + r)}`).join('')}
    <p class="small"><a href="#/scout">Scouting</a> has more filters, including young players with room to grow.</p>
  </div>

  <div class="grid two">
    <div class="card">
      <h2>Fans and promotion</h2>
      ${fans.league ? `<p>You are <strong>${ordinal(fans.rank)} of ${fans.of}</strong> in ${esc(fans.league.label)}${fans.row ? ` (${fans.row.w}–${fans.row.l} in league games)` : ''}${fans.leader && fans.rank > 1 ? `, ${fans.leader.w - fans.row.w} wins behind ${esc(fans.leader.team.name)}` : ''}.</p>` : ''}
      ${fans.upper ? `<p class="small">${esc(fans.upper.label)} has a fan pool of ${fmt(fans.upper.fanPool)}, ${(fans.upper.fanPool / Math.max(1, fans.league.fanPool)).toFixed(1)}× the ${fmt(fans.league.fanPool)} in your league. Promotion is the biggest fan lever, so the win chance gains above are also fan gains.</p>` : fans.league ? `<p class="small">Your league's fan pool is ${fmt(fans.league.fanPool)}.</p>` : ''}
      <p class="muted small">Your team's own fan count, popularity and budgets are in the save but not read by the app yet.</p>
    </div>
    <div class="card">
      <h2>Player experience</h2>
      ${x.experience.map((a) => actionCard(m, a)).join('') || '<p class="small">None of your starters is being asked to play or train champions they dislike.</p>'}
    </div>
  </div>

  <div class="card">
    <h2>How impact is worked out</h2>
    <p class="small">Impact is a weighted average of a player's 12 stats, on the same 0 to 100 scale as their average. The weights come from the pro games in this save: which stats the winning side had more of, using each lineup's stats as they were in that game. On the newest ${F?.test ?? 0} games, held out, impact picks the winner ${pct(F?.accImpact, 1)} of the time, against ${pct(F?.accAvg, 1)} for the plain average. One player with 10 more impact adds about ${((F ? sigmoid10(F) : 0) * 100).toFixed(1)} points of win chance.</p>
    ${W.map((v) => `<div class="statrow"><span>${esc(STAT_LABELS[v.i])}</span>${bar(v.w, maxW)}<span class="num">${(v.w * 100).toFixed(0)}%</span></div>`).join('')}
    <p class="muted small">Stats with a weight near 0% made no measurable difference to who won. Salaries follow these weights only partly, which is where cheap value comes from.</p>
  </div>`;
}

const sigmoid10 = (F) => 1 / (1 + Math.exp(-F.bImp * 10 / 5)) - 0.5;
const bucketWr = (F, i) => { const b = F?.profBuckets?.[i]; return b && b.g ? b.w / b.g : null; };
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
