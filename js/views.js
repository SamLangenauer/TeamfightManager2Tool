import { SLOTS, SLOT_LABEL, describe, actionFacts } from './kits.js';
import { ROLES, STAT_LABELS, HIDDEN_LABELS, fmtMoney, pct, wr } from './model.js';
import { esc, table, bar, statTone, num, link, select, setSort } from './ui.js';
import { local } from './store.js';

// ---------- shared filter state ----------
const F = local.get('filters', {});
const filt = (view, defaults) => (F[view] = { ...defaults, ...(F[view] || {}) });
const saveFilters = () => local.set('filters', F);
let watch = new Set(local.get('watchlist', []));

export function handleChange(el) {
  const view = el.dataset.filter; if (!view) return false;
  F[view] = F[view] || {};
  F[view][el.name] = el.type === 'checkbox' ? el.checked : el.value;
  saveFilters();
  return true;
}
export function handleAction(a, el) {
  if (a === 'watch') {
    const id = +el.dataset.id; watch.has(id) ? watch.delete(id) : watch.add(id);
    local.set('watchlist', [...watch]); return true;
  }
  if (a === 'patch-toggle') {
    const v = el.dataset.view; F[v] = F[v] || {}; F[v].patch = el.dataset.patch; saveFilters(); return true;
  }
  return false;
}

const champChip = (m, c, extra = '') => `<a class="chip cat-${(m.champs[c]?.cat || 'x').toLowerCase()}" href="#/champ/${c}" title="${esc(m.champs[c]?.cat || '')}">${esc(m.champName(c))}${extra}</a>`;
const teamLink = (m, id) => (id >= 0 ? link(`#/team/${id}`, m.teamName(id)) : '<span class="muted">Free agent</span>');
const playerLink = (m, a) => (a ? link(`#/player/${a.id}`, a.name) : '–');
const patchOptions = (m) => [['all', 'All patches'], ...m.patches.map((p) => [p, `Patch ${p}`]), ['latest', 'Latest patch only']];
const patchList = (m, v) => (v === 'all' || !v ? null : v === 'latest' ? [m.patches[m.patches.length - 1]] : [v]);
const leagueOptions = (m, all = 'All leagues') => [['', all], ...m.leagues.map((l) => [l.id, l.label])];

// ---------- load ----------
export function loadScreen(app) {
  const last = app.lastInfo;
  return `
  <section class="load">
    <h1>Open your save</h1>
    <p>Pick a save file to explore it. It is read in your browser and never uploaded anywhere.</p>
    <div class="drop" data-action="pick-file">
      <strong>Drop a save here, or click to choose one</strong>
      <span class="muted small">Saves live in <code>%APPDATA%\\TeamSamoyed\\TeamfightManager2\\data</code>, named <code>save_*.data</code>.</span>
    </div>
    <div id="load-status" class="status"></div>
    ${last ? `<div class="card"><div>Last save: <strong>${esc(last.team || 'Unknown team')}</strong>, in-game date ${esc(last.date)}</div>
      <div class="row gap"><button data-action="load-last">Open it again</button><button class="ghost" data-action="forget">Forget it</button></div></div>` : ''}
    <div class="card muted small">
      Tip: in Windows, paste <code>%APPDATA%\\TeamSamoyed\\TeamfightManager2\\data</code> into the file picker's address bar to jump to the folder.
      The newest file is the latest save; <code>.bak</code> is the one before it.
    </div>
  </section>`;
}

// ---------- home ----------
export function home(m) {
  const my = m.myTeam;
  const t = my != null ? m.teams[my] : null;
  const tg = my != null ? m.teamGames.get(my) : [];
  const wins = tg.filter((g) => g.teams[g.winner] === my).length;
  const lg = t ? m.league(t.league) : null;
  const stand = t ? m.standings(t.league) : [];
  const starters = my != null ? (m.starters.get(my) || []) : [];
  return `
  <h1>${esc(t ? t.name : 'Your save')}</h1>
  <p class="muted">In-game date ${esc(m.db.date)}. ${m.athletes.length} players, ${m.teams.length} teams, ${m.games.length} pro games across patches ${m.patches.join(', ')}.</p>
  ${t ? `
  <div class="grid two">
    <div class="card">
      <h2>${esc(lg?.label || '')} standings</h2>
      ${standingsTable(m, stand, 'home-stand', my)}
    </div>
    <div class="card">
      <h2>Your starting five</h2>
      <p class="muted small">From your latest game.</p>
      ${table('home-five', starters.map((aid, r) => ({ a: m.athletes[aid], r })), [
        { key: 'r', label: 'Role', value: (x) => x.r, html: (x) => ROLES[x.r] },
        { key: 'name', label: 'Player', value: (x) => x.a?.name, html: (x) => playerLink(m, x.a) },
        { key: 'rating', label: 'Avg stat', value: (x) => x.a?.rating, cls: 'num' },
        { key: 'role', label: 'Role rating', value: (x) => x.a?.pos?.[x.r], cls: 'num' },
        { key: 'pool', label: 'Best champions', html: (x) => x.a ? m.champPool(x.a, 3).map((p) => champChip(m, p.c)).join(' ') : '' },
      ])}
      <p><strong>${wins}–${tg.length - wins}</strong> in ${tg.length} games this save. <a href="#/team/${my}">Team page</a> · <a href="#/draft">Start a draft</a></p>
    </div>
  </div>
  <div class="card">
    <h2>Recent games</h2>
    ${gamesTable(m, tg.slice(-12).reverse(), 'home-games', my)}
  </div>` : `<div class="card">Your team was not found in the save header. Browse <a href="#/teams">Teams</a> instead.</div>`}`;
}

function standingsTable(m, rows, id, highlight) {
  return table(id, rows.map((r, i) => ({ ...r, rank: i + 1 })), [
    { key: 'rank', label: '#', cls: 'num' },
    { key: 'team', label: 'Team', value: (r) => r.team.name, html: (r) => `${r.team.id === highlight ? '<strong>' : ''}${teamLink(m, r.team.id)}${r.team.id === highlight ? '</strong>' : ''}` },
    { key: 'w', label: 'W', cls: 'num' }, { key: 'l', label: 'L', cls: 'num' },
    { key: 'wr', label: 'Win %', cls: 'num', value: (r) => (r.w + r.l ? r.w / (r.w + r.l) : null), html: (r) => pct(r.w + r.l ? r.w / (r.w + r.l) : null) },
    { key: 'kd', label: 'Kill diff', cls: 'num', value: (r) => r.k - r.d },
  ]);
}

function gamesTable(m, games, id, perspective) {
  return table(id, games, [
    { key: 'idx', label: 'Game', cls: 'num', value: (g) => g.idx, html: (g) => link(`#/game/${g.idx}`, '#' + g.idx) },
    { key: 'patch', label: 'Patch', value: (g) => g.patch },
    { key: 'blue', label: 'Side A', value: (g) => m.teamName(g.teams[0]), html: (g) => `${g.winner === 0 ? '<strong>' : ''}${teamLink(m, g.teams[0])}${g.winner === 0 ? '</strong>' : ''}` },
    { key: 'score', label: 'Kills', cls: 'num', value: (g) => g.sum[0].kills - g.sum[1].kills, html: (g) => `${g.sum[0].kills}–${g.sum[1].kills}` },
    { key: 'red', label: 'Side B', value: (g) => m.teamName(g.teams[1]), html: (g) => `${g.winner === 1 ? '<strong>' : ''}${teamLink(m, g.teams[1])}${g.winner === 1 ? '</strong>' : ''}` },
    ...(perspective != null ? [{ key: 'res', label: 'Result', value: (g) => (g.teams[g.winner] === perspective ? 1 : 0), html: (g) => (g.teams[g.winner] === perspective ? '<span class="win">Win</span>' : '<span class="loss">Loss</span>') }] : []),
    { key: 'picks', label: 'Picks', html: (g) => `<span class="picks">${g.picks[0].map((c) => champChip(m, c)).join('')}</span> <span class="muted">vs</span> <span class="picks">${g.picks[1].map((c) => champChip(m, c)).join('')}</span>` },
  ], { limit: 100 });
}

// ---------- players ----------
export function players(m) {
  const f = filt('players', { q: '', team: '', league: '', role: '', maxAge: '', minPot: '', fa: false, watch: false });
  let rows = m.athletes.filter((a) => !a.bad);
  const q = f.q.trim().toLowerCase();
  if (q) rows = rows.filter((a) => a.name.toLowerCase().includes(q));
  if (f.team !== '') rows = rows.filter((a) => a.team === +f.team);
  if (f.league !== '') rows = rows.filter((a) => a.team >= 0 && m.teams[a.team].league === +f.league);
  if (f.role !== '') rows = rows.filter((a) => a.mainRole === +f.role);
  if (f.maxAge) rows = rows.filter((a) => a.age <= +f.maxAge);
  if (f.minPot) rows = rows.filter((a) => a.potential >= +f.minPot);
  if (f.fa) rows = rows.filter((a) => a.team < 0);
  if (f.watch) rows = rows.filter((a) => watch.has(a.id));
  setSort('players', 'rating');
  return `
  <h1>Players</h1>
  <div class="filters">
    <input name="q" data-filter="players" data-live placeholder="Search by name" value="${esc(f.q)}">
    ${select('team', [['', 'All teams'], ['-1', 'Free agents'], ...m.teams.map((t) => [t.id, t.name]).sort((a, b) => a[1].localeCompare(b[1]))], f.team, 'data-filter="players"')}
    ${select('league', leagueOptions(m), f.league, 'data-filter="players"')}
    ${select('role', [['', 'Any role'], ...ROLES.map((r, i) => [i, r])], f.role, 'data-filter="players"')}
    <label>Max age <input name="maxAge" type="number" min="14" max="45" data-filter="players" value="${esc(f.maxAge)}" class="tiny"></label>
    <label>Min potential <input name="minPot" type="number" min="0" max="100" data-filter="players" value="${esc(f.minPot)}" class="tiny"></label>
    <label><input type="checkbox" name="fa" data-filter="players" ${f.fa ? 'checked' : ''}> Free agents only</label>
    <label><input type="checkbox" name="watch" data-filter="players" ${f.watch ? 'checked' : ''}> Watchlist</label>
  </div>
  <p class="muted small">${rows.length} players. Potential is the save's hidden true value, not the scout's estimate.</p>
  ${playersTable(m, rows, 'players')}`;
}

function playersTable(m, rows, id, extraCols = []) {
  return table(id, rows, [
    { key: 'w', label: '★', value: (a) => (watch.has(a.id) ? 1 : 0), html: (a) => `<button class="star ${watch.has(a.id) ? 'on' : ''}" data-action="watch" data-id="${a.id}" title="Watchlist">★</button>` },
    { key: 'name', label: 'Name', value: (a) => a.name, html: (a) => playerLink(m, a) },
    { key: 'team', label: 'Team', value: (a) => m.teamName(a.team), html: (a) => teamLink(m, a.team) },
    { key: 'age', label: 'Age', cls: 'num' },
    { key: 'role', label: 'Role', value: (a) => a.mainRole, html: (a) => `${ROLES[a.mainRole]} <span class="muted">${a.roleRating}</span>` },
    { key: 'rating', label: 'Avg stat', cls: 'num', html: (a) => `<span class="${statTone(a.rating)}">${a.rating}</span>` },
    { key: 'potential', label: 'Potential', cls: 'num', html: (a) => `<span class="${statTone(a.potential)}">${a.potential ?? '–'}</span>` },
    { key: 'end', label: 'Contract ends', value: (a) => a.contract?.end || '', html: (a) => esc((a.contract?.end || '').slice(0, 10)) },
    { key: 'salary', label: 'Salary', cls: 'num', value: (a) => a.contract?.salary ?? null, html: (a) => fmtMoney(a.contract?.salary) },
    { key: 'games', label: 'Games', cls: 'num', value: (a) => a.log.length },
    { key: 'winr', label: 'Win %', cls: 'num', value: (a) => (a.log.length ? a.log.filter((l) => l.win).length / a.log.length : null), html: (a) => pct(a.log.length ? a.log.filter((l) => l.win).length / a.log.length : null) },
    ...extraCols,
  ]);
}

// ---------- player ----------
export function player(m, r) {
  const a = m.athletes[+r.id];
  if (!a) return '<div class="card">Player not found.</div>';
  const pool = m.champPool(a, 0).filter((p) => p.prof > 0);
  const games = a.log.slice().reverse();
  const wins = a.log.filter((l) => l.win).length;
  const k = a.log.reduce((s, l) => s + l.k, 0), d = a.log.reduce((s, l) => s + l.d, 0);
  const byRole = ROLES.map((_, i) => a.log.filter((l) => l.role === i).length);
  return `
  <h1>${esc(a.name)} <button class="star ${watch.has(a.id) ? 'on' : ''}" data-action="watch" data-id="${a.id}" title="Watchlist">★</button></h1>
  <p class="muted">${teamLink(m, a.team)} · Age ${a.age ?? '?'} · ${ROLES[a.mainRole]} · Contract ${esc((a.contract?.start || '').slice(0, 10))} to ${esc((a.contract?.end || '').slice(0, 10))} · Salary ${fmtMoney(a.contract?.salary)}</p>
  <div class="grid three">
    <div class="card">
      <h2>Stats</h2>
      ${a.stat.map((v, i) => `<div class="statrow"><span>${STAT_LABELS[i]}</span>${bar(v, 100, statTone(v))}<span class="num ${statTone(v)}">${v}</span></div>`).join('')}
      <div class="statrow total"><span>Average</span>${bar(a.rating)}<span class="num">${a.rating}</span></div>
    </div>
    <div class="card">
      <h2>Positions</h2>
      ${a.pos.map((v, i) => `<div class="statrow"><span>${ROLES[i]}</span>${bar(v, 100, statTone(v))}<span class="num">${v}</span></div>`).join('')}
      <h2>Hidden traits</h2>
      ${a.hidden.map((v, i) => `<div class="kv"><span>${HIDDEN_LABELS[i]}</span><span class="num">${v}</span></div>`).join('')}
      <p class="muted small">Hidden traits are read straight from the save. The game only shows estimates of these.</p>
    </div>
    <div class="card">
      <h2>Pro record</h2>
      <div class="kv"><span>Games</span><span class="num">${a.log.length}</span></div>
      <div class="kv"><span>Win rate</span><span class="num">${pct(a.log.length ? wins / a.log.length : null)}</span></div>
      <div class="kv"><span>Kills / deaths</span><span class="num">${k} / ${d} (${num(k / Math.max(1, d), 2)})</span></div>
      <div class="kv"><span>Avg damage</span><span class="num">${num(a.log.reduce((s, l) => s + l.dmg, 0) / Math.max(1, a.log.length))}</span></div>
      <div class="kv"><span>Roles played</span><span>${byRole.map((n, i) => (n ? `${ROLES[i]} ${n}` : '')).filter(Boolean).join(', ') || '–'}</span></div>
      <div class="kv"><span>Languages</span><span>${a.lang.map(([l, v]) => `#${l} (${v})`).join(', ')}</span></div>
      ${a.like.length || a.dislike.length ? `<div class="kv"><span>Likes / dislikes</span><span>${a.like.map((c) => champChip(m, c)).join(' ')} / ${a.dislike.map((c) => champChip(m, c)).join(' ')}</span></div>` : ''}
    </div>
  </div>
  <div class="card">
    <h2>Champion pool</h2>
    <p class="muted small">Proficiency is the save's value for each champion (higher is better; most players start near 80). Comfort mixes proficiency with pro results and is what the draft helper uses.</p>
    ${table('player-pool', pool, [
      { key: 'c', label: 'Champion', value: (p) => m.champName(p.c), html: (p) => champChip(m, p.c) },
      { key: 'prof', label: 'Proficiency', cls: 'num', html: (p) => `${bar(p.prof, 1000)} ${p.prof}` },
      { key: 'comfort', label: 'Comfort', cls: 'num', html: (p) => pct(p.comfort) },
      { key: 'g', label: 'Pro games', cls: 'num' },
      { key: 'wr', label: 'Win %', cls: 'num', value: (p) => (p.g ? p.w / p.g : null), html: (p) => pct(p.g ? p.w / p.g : null) },
      { key: 'kd', label: 'K / D', cls: 'num', value: (p) => (p.g ? p.k / Math.max(1, p.d) : null), html: (p) => (p.g ? `${p.k} / ${p.d}` : '–') },
    ], { limit: 80 })}
  </div>
  <div class="card">
    <h2>Game log</h2>
    ${table('player-log', games, [
      { key: 'idx', label: 'Game', cls: 'num', value: (l) => l.g.idx, html: (l) => link(`#/game/${l.g.idx}`, '#' + l.g.idx) },
      { key: 'patch', label: 'Patch', value: (l) => l.g.patch },
      { key: 'team', label: 'For', value: (l) => m.teamName(l.team), html: (l) => teamLink(m, l.team) },
      { key: 'opp', label: 'Against', value: (l) => m.teamName(l.opp), html: (l) => teamLink(m, l.opp) },
      { key: 'role', label: 'Role', value: (l) => l.role, html: (l) => ROLES[l.role] },
      { key: 'champ', label: 'Champion', value: (l) => l.champ, html: (l) => champChip(m, l.champ) },
      { key: 'k', label: 'K', cls: 'num' }, { key: 'd', label: 'D', cls: 'num' },
      { key: 'cs', label: 'CS', cls: 'num' }, { key: 'gold', label: 'Gold', cls: 'num' }, { key: 'dmg', label: 'Damage', cls: 'num' },
      { key: 'win', label: 'Result', value: (l) => (l.win ? 1 : 0), html: (l) => (l.win ? '<span class="win">Win</span>' : '<span class="loss">Loss</span>') },
    ], { limit: 60, empty: 'No pro games in this save.' })}
  </div>`;
}

// ---------- teams ----------
export function teams(m) {
  return `<h1>Leagues and teams</h1>
  <p class="muted small">Standings are counted from the league games stored in the save (game wins, not series).</p>
  <div class="grid two">${m.leagues.map((l) => `<div class="card"><h2>${esc(l.label)} <span class="muted small">${esc(l.regionName)}</span></h2>${standingsTable(m, m.standings(l.id), 'stand-' + l.id, m.myTeam)}</div>`).join('')}</div>`;
}

export function team(m, r) {
  const id = +r.id; const t = m.teams[id];
  if (!t) return '<div class="card">Team not found.</div>';
  const f = filt('team', { patch: 'all' });
  const games = m.teamGames.get(id).filter((g) => !patchList(m, f.patch) || patchList(m, f.patch).includes(g.patch));
  const tt = m.teamTendencies(id, games);
  const roster = m.roster.get(id) || [];
  const five = m.starters.get(id) || [];
  const wins = games.filter((g) => g.teams[g.winner] === id).length;
  const top = (obj, n = 10, wins) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([c, v]) => `<div class="kv">${champChip(m, c)}<span class="num">${v}${wins ? ` <span class="muted">(${pct(wr(wins[c] || 0, v, 0))})</span>` : ''}</span></div>`).join('') || '<span class="muted">None</span>';
  const lg = m.league(t.league);
  return `
  <h1>${esc(t.name)}</h1>
  <p class="muted">${esc(lg?.label || '')} · ${wins}–${games.length - wins} in ${games.length} games ${id === m.myTeam ? '· Your team' : `· <a href="#/draft?opp=${id}">Draft against them</a>`}</p>
  <div class="filters">${select('patch', patchOptions(m), f.patch, 'data-filter="team"')}</div>
  <div class="card">
    <h2>Starting five</h2>
    ${table('team-five-' + id, five.map((aid, i) => ({ a: m.athletes[aid], i })), [
      { key: 'i', label: 'Role', html: (x) => ROLES[x.i] },
      { key: 'n', label: 'Player', value: (x) => x.a?.name, html: (x) => playerLink(m, x.a) },
      { key: 'r', label: 'Avg stat', cls: 'num', value: (x) => x.a?.rating },
      { key: 'rr', label: 'Role rating', cls: 'num', value: (x) => x.a?.pos?.[x.i] },
      { key: 'p', label: 'Potential', cls: 'num', value: (x) => x.a?.potential },
      { key: 'pool', label: 'Comfort picks', html: (x) => (x.a ? m.champPool(x.a, 4).map((p) => champChip(m, p.c)).join(' ') : '') },
    ])}
  </div>
  <div class="grid three">
    <div class="card"><h2>Most picked</h2>${top(tt.picks, 10, tt.wins)}</div>
    <div class="card"><h2>Most banned by them</h2>${top(tt.bans)}</div>
    <div class="card"><h2>Banned against them</h2>${top(tt.bannedVs)}</div>
  </div>
  <div class="card"><h2>Roster (${roster.length})</h2>${playersTable(m, roster, 'team-roster-' + id)}</div>
  <div class="card"><h2>Games</h2>${gamesTable(m, games.slice().reverse(), 'team-games-' + id, id)}</div>`;
}

// ---------- scouting ----------
export function scout(m) {
  const f = filt('scout', { role: '0', maxAge: '23', minPot: '70', expiring: '', fa: false, league: '', excludeMine: true, sortBy: 'score' });
  const role = +f.role;
  const latestYear = Number(String(m.db.date).slice(0, 4));
  let rows = m.athletes.filter((a) => !a.bad && a.pos);
  if (f.excludeMine && m.myTeam != null) rows = rows.filter((a) => a.team !== m.myTeam);
  if (f.maxAge) rows = rows.filter((a) => a.age <= +f.maxAge);
  if (f.minPot) rows = rows.filter((a) => a.potential >= +f.minPot);
  if (f.fa) rows = rows.filter((a) => a.team < 0);
  if (f.league !== '') rows = rows.filter((a) => a.team >= 0 && m.teams[a.team].league === +f.league);
  if (f.expiring) rows = rows.filter((a) => a.team < 0 || Number((a.contract?.end || '9999').slice(0, 4)) <= +f.expiring);
  // scouting score: role rating now, room to grow, youth, and pro form
  for (const a of rows) {
    const now = (a.pos[role] * 0.55 + a.rating * 0.45);
    const growth = Math.max(0, (a.potential ?? a.rating) - a.rating);
    const youth = Math.max(0, 25 - (a.age || 25));
    const form = a.log.length >= 5 ? (wr(a.log.filter((l) => l.win).length, a.log.length) - 0.5) * 40 : 0;
    a._now = Math.round(now); a._growth = growth;
    a._score = Math.round(now + growth * 0.6 + youth * 1.2 + form);
  }
  rows = rows.filter((a) => a.pos[role] >= 30);
  setSort('scout', '_score');
  const years = [latestYear, latestYear + 1, latestYear + 2];
  return `
  <h1>Scouting</h1>
  <p class="muted">Ranks players for a role by current ability in that role, room to grow (true potential minus average stat), age and pro form. Uses hidden values your scouts can only estimate in game.</p>
  <div class="filters">
    ${select('role', ROLES.map((r, i) => [i, r]), f.role, 'data-filter="scout"')}
    <label>Max age <input name="maxAge" type="number" class="tiny" data-filter="scout" value="${esc(f.maxAge)}"></label>
    <label>Min potential <input name="minPot" type="number" class="tiny" data-filter="scout" value="${esc(f.minPot)}"></label>
    ${select('expiring', [['', 'Any contract'], ...years.map((y) => [y, `Contract ends by ${y}`])], f.expiring, 'data-filter="scout"')}
    ${select('league', leagueOptions(m, 'All leagues and free agents'), f.league, 'data-filter="scout"')}
    <label><input type="checkbox" name="fa" data-filter="scout" ${f.fa ? 'checked' : ''}> Free agents only</label>
    <label><input type="checkbox" name="excludeMine" data-filter="scout" ${f.excludeMine ? 'checked' : ''}> Hide my players</label>
  </div>
  <p class="muted small">${rows.length} matches.</p>
  ${playersTable(m, rows, 'scout', [
    { key: '_now', label: `${ROLES[role]} now`, cls: 'num' },
    { key: '_growth', label: 'Room to grow', cls: 'num' },
    { key: '_score', label: 'Scout score', cls: 'num', html: (a) => `<strong>${a._score}</strong>` },
  ])}
  ${watch.size ? `<div class="card"><h2>Watchlist</h2>${playersTable(m, [...watch].map((id) => m.athletes[id]).filter(Boolean), 'watchlist')}</div>` : ''}`;
}

// ---------- meta ----------
export function metaRows(m, f) {
  const games = m.filterGames({ patches: patchList(m, f.patch), league: f.league });
  const s = m.champStats(games);
  let rows = Object.values(s);
  if (f.role !== '') rows = rows.filter((x) => x.mainRole === +f.role || x.roles[+f.role] / Math.max(1, x.picks) >= 0.25);
  // tier: presence and smoothed win rate
  for (const x of rows) {
    x.power = (x.adjWin - 0.5) * 2 + x.presence * 0.6;
  }
  const sorted = rows.slice().sort((a, b) => b.power - a.power);
  sorted.forEach((x, i) => { const q = i / sorted.length; x.tier = q < 0.1 ? 'S' : q < 0.3 ? 'A' : q < 0.6 ? 'B' : q < 0.85 ? 'C' : 'D'; });
  return { games, rows };
}

export function meta(m) {
  const f = filt('meta', { patch: 'latest', league: '', role: '' });
  const { games, rows } = metaRows(m, f);
  setSort('meta', 'power');
  return `
  <h1>Meta</h1>
  <div class="filters">
    ${select('patch', patchOptions(m), f.patch, 'data-filter="meta"')}
    ${select('league', leagueOptions(m), f.league, 'data-filter="meta"')}
    ${select('role', [['', 'All roles'], ...ROLES.map((r, i) => [i, r])], f.role, 'data-filter="meta"')}
  </div>
  <p class="muted small">${games.length} games. Win % is raw; "Adj. win %" pulls small samples toward 50% so a 2–0 pick doesn't top the list. Tier ranks presence and adjusted win rate together.</p>
  ${table('meta', rows, [
    { key: 'tier', label: 'Tier', value: (x) => 'SABCD'.indexOf(x.tier) * -1, html: (x) => `<span class="tier t-${x.tier}">${x.tier}</span>` },
    { key: 'c', label: 'Champion', value: (x) => m.champName(x.c), html: (x) => champChip(m, x.c) },
    { key: 'cat', label: 'Class', value: (x) => m.champs[x.c].cat },
    { key: 'mainRole', label: 'Main role', value: (x) => x.mainRole, html: (x) => (x.picks ? ROLES[x.mainRole] : '–') },
    { key: 'picks', label: 'Picks', cls: 'num' },
    { key: 'pickRate', label: 'Pick %', cls: 'num', html: (x) => pct(x.pickRate, 1) },
    { key: 'banRate', label: 'Ban %', cls: 'num', html: (x) => pct(x.banRate, 1) },
    { key: 'presence', label: 'Presence', cls: 'num', html: (x) => `${bar(x.presence, 1)} ${pct(x.presence)}` },
    { key: 'winRate', label: 'Win %', cls: 'num', html: (x) => pct(x.winRate, 1) },
    { key: 'adjWin', label: 'Adj. win %', cls: 'num', html: (x) => pct(x.adjWin, 1) },
    { key: 'kda', label: 'K/D', cls: 'num', html: (x) => num(x.kda, 2) },
    { key: 'power', label: 'Power', cls: 'num', html: (x) => num(x.power * 100) },
  ], { limit: 100 })}`;
}

// ---------- champion ----------
function kitCard(m, c) {
  const k = m.kits?.[c]; const ch = m.champs[c];
  if (!k) return `<div class="card"><h2>Abilities</h2>${ch.skills.map((n, i) => `<div class="kv"><span>${['Ability 1', 'Ability 2', 'Ultimate'][i]}</span><span>${esc(n)}</span></div>`).join('')}</div>`;
  const row = (slot) => {
    const name = slot === 'attack' ? '' : k.names?.[slot] || '';
    const text = slot === 'attack' ? '' : describe(k, slot, esc);
    return `<div class="kit-row"><div class="kit-head"><span class="muted small">${SLOT_LABEL[slot]}</span> <strong>${esc(name)}</strong> <span class="muted small">${esc(actionFacts(k[slot]))}</span></div>${text ? `<div class="kit-text">${text}</div>` : ''}</div>`;
  };
  return `<div class="card"><h2>Abilities</h2>
    <p class="muted small">The game's own descriptions, with the numbers filled in from its champion data (base values, before balance patches). A ? is a value the data does not spell out.</p>
    ${SLOTS.map(row).join('')}</div>`;
}

export function champ(m, r) {
  const c = r.id; const ch = m.champs[c];
  if (!ch) return '<div class="card">Champion not found.</div>';
  const f = filt('champ', { patch: 'all' });
  const games = m.filterGames({ patches: patchList(m, f.patch) });
  const s = m.champStats(games)[c];
  const { syn, vs } = m.pairStats(games);
  const pairs = (map) => m.champIds.filter((x) => x !== c).map((x) => { const v = map.get(c + '|' + x) || [0, 0]; return { c: x, g: v[0], w: v[1], adj: wr(v[1], v[0], 8) }; }).filter((x) => x.g >= 3);
  const sy = pairs(syn), vv = pairs(vs);
  const best = (list, dir) => list.slice().sort((a, b) => dir * (b.adj - a.adj)).slice(0, 8)
    .map((x) => `<div class="kv">${champChip(m, x.c)}<span class="num">${pct(x.w / x.g)} <span class="muted">in ${x.g}</span></span></div>`).join('') || '<span class="muted">Not enough games.</span>';
  // players on this champion
  const pl = m.athletes.map((a) => { const ls = a.log.filter((l) => l.champ === c && (!patchList(m, f.patch) || patchList(m, f.patch).includes(l.g.patch))); return { a, g: ls.length, w: ls.filter((l) => l.win).length, prof: a.prof?.[c]?.[0] || 0 }; })
    .filter((x) => x.g > 0 || x.prof >= 300);
  const st = ch.stat, gr = ch.growth;
  return `
  <h1>${esc(ch.name)} <span class="muted small">${esc(ch.cat)} · ${ch.tags.map(esc).join(', ')}${ch.mod ? ' · added in an update' : ''}</span></h1>
  <div class="filters">${select('patch', patchOptions(m), f.patch, 'data-filter="champ"')}</div>
  <div class="grid three">
    <div class="card">
      <h2>In pro games</h2>
      <div class="kv"><span>Picks / bans</span><span class="num">${s.picks} / ${s.bans}</span></div>
      <div class="kv"><span>Presence</span><span class="num">${pct(s.presence)}</span></div>
      <div class="kv"><span>Win rate</span><span class="num">${pct(s.winRate, 1)} (adj. ${pct(s.adjWin, 1)})</span></div>
      <div class="kv"><span>K / D</span><span class="num">${s.k} / ${s.d}</span></div>
      <div class="kv"><span>Avg damage</span><span class="num">${num(s.dmg / Math.max(1, s.picks))}</span></div>
      <h2>Roles</h2>
      ${s.roles.map((n, i) => `<div class="statrow"><span>${ROLES[i]}</span>${bar(n, Math.max(1, s.picks))}<span class="num">${n}</span></div>`).join('')}
    </div>
    <div class="card">
      <h2>Base stats</h2>
      <p class="muted small">Base values from the game files, before balance patches.</p>
      ${[['Attack', 'attack'], ['Ability power', 'magic_power'], ['Health', 'hp'], ['Armor', 'defence'], ['Magic resist', 'magic_resistance'], ['Move speed', 'move_speed']]
        .map(([l, k]) => `<div class="kv"><span>${l}</span><span class="num">${st[k]}${gr[k] ? ` <span class="muted">+${gr[k]}/lvl</span>` : ''}</span></div>`).join('')}
      <div class="kv"><span>Attack range</span><span class="num">${ch.range ? ch.range / 1000 : '–'}</span></div>
    </div>
    <div class="card">
      <h2>Best with</h2>${best(sy, 1)}
      <h2>Worst with</h2>${best(sy, -1)}
    </div>
  </div>
  ${kitCard(m, c)}
  <div class="grid two">
    <div class="card"><h2>Strong against</h2><p class="muted small">Win rate when facing these champions.</p>${best(vv, 1)}</div>
    <div class="card"><h2>Weak against</h2>${best(vv, -1)}</div>
  </div>
  <div class="card"><h2>Who plays it</h2>
  ${table('champ-players-' + c, pl, [
    { key: 'n', label: 'Player', value: (x) => x.a.name, html: (x) => playerLink(m, x.a) },
    { key: 't', label: 'Team', value: (x) => m.teamName(x.a.team), html: (x) => teamLink(m, x.a.team) },
    { key: 'g', label: 'Games', cls: 'num' },
    { key: 'wr', label: 'Win %', cls: 'num', value: (x) => (x.g ? x.w / x.g : null), html: (x) => pct(x.g ? x.w / x.g : null) },
    { key: 'prof', label: 'Proficiency', cls: 'num' },
  ], { limit: 40 })}</div>`;
}

// ---------- games ----------
export function games(m) {
  const f = filt('games', { patch: 'all', league: '', team: '' });
  const gs = m.filterGames({ patches: patchList(m, f.patch), league: f.league, team: f.team === '' ? null : +f.team });
  return `<h1>Match history</h1>
  <div class="filters">
    ${select('patch', patchOptions(m), f.patch, 'data-filter="games"')}
    ${select('league', leagueOptions(m), f.league, 'data-filter="games"')}
    ${select('team', [['', 'All teams'], ...m.teams.map((t) => [t.id, t.name]).sort((a, b) => a[1].localeCompare(b[1]))], f.team, 'data-filter="games"')}
  </div>
  <p class="muted small">${gs.length} games. The winner is read from each game's final score.</p>
  ${gamesTable(m, gs.slice().reverse(), 'games', f.team === '' ? null : +f.team)}`;
}

export function game(m, r) {
  const g = m.games.find((x) => x.idx === +r.id);
  if (!g) return '<div class="card">Game not found.</div>';
  const side = (s) => {
    const sm = g.sum[s];
    return `<div class="card ${g.winner === s ? 'won' : ''}">
      <h2>${teamLink(m, g.teams[s])} ${g.winner === s ? '<span class="win">Win</span>' : '<span class="loss">Loss</span>'}</h2>
      <p class="muted small">Bans: ${g.bans[s].map((c) => champChip(m, c)).join(' ') || 'none'}</p>
      ${table(`game-${g.idx}-${s}`, g.picks[s].map((c, i) => ({ c, i, p: g.players[s][i] })), [
        { key: 'i', label: 'Pick', cls: 'num', value: (x) => x.i + 1 },
        { key: 'c', label: 'Champion', value: (x) => x.c, html: (x) => champChip(m, x.c) },
        { key: 'pl', label: 'Player', value: (x) => m.athletes[x.p?.aid]?.name, html: (x) => playerLink(m, m.athletes[x.p?.aid]) },
        { key: 'r', label: 'Role', value: (x) => x.p?.slot, html: (x) => (x.p ? ROLES[x.p.slot] : '–') },
        { key: 'k', label: 'K', cls: 'num', value: (x) => sm.k[x.i] }, { key: 'd', label: 'D', cls: 'num', value: (x) => sm.d[x.i] },
        { key: 'cs', label: 'CS', cls: 'num', value: (x) => sm.cs[x.i] }, { key: 'gold', label: 'Gold', cls: 'num', value: (x) => sm.gold[x.i] },
        { key: 'dmg', label: 'Damage', cls: 'num', value: (x) => sm.dmg[x.i] },
      ])}
      <div class="kv"><span>Kills / deaths</span><span class="num">${sm.kills} / ${sm.deaths}</span></div>
      <div class="kv"><span>Towers / objectives</span><span class="num">${sm.towers} / ${sm.objectives}</span></div>
      <div class="kv"><span>Final score</span><span class="num">${sm.score}</span></div>
    </div>`;
  };
  return `<h1>Game #${g.idx} <span class="muted small">Patch ${esc(g.patch)}</span></h1><div class="grid two">${side(0)}${side(1)}</div>`;
}
