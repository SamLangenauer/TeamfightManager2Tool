// Your recorded results and what the win model has learned from them.
import { learner, results, YOUR_WEIGHT } from './learn.js';
import { esc, table, bar } from './ui.js';
import { pct } from './model.js';

const chips = (m, list) => list.map((c) => `<a class="chip cat-${(m.champs[c]?.cat || 'x').toLowerCase()}" href="#/champ/${c}">${esc(m.champName(c))}</a>`).join('');

export function resultsView(m) {
  if (!m.games.length) return '<div class="card">This save has no pro games yet, so there is nothing to learn from.</div>';
  const L = learner(m);
  const list = results.all().slice().reverse();
  const done = list.filter((r) => r.won != null);
  const wins = done.filter((r) => r.won).length;
  // how well the predictions made at draft time held up
  let brier = 0, hit = 0;
  for (const r of done) { brier += (r.predicted - (r.won ? 1 : 0)) ** 2; if ((r.predicted > 0.5) === r.won) hit++; }
  const e = L.eval;

  const ws = L.weights();
  const maxW = Math.max(...ws.map((w) => Math.abs(w.w)), 0.01);
  const weightRows = ws.map((w) => `<div class="kv"><span>${esc(w.label)}</span>
    <span class="row gap" style="margin:0;align-items:center">${bar(Math.abs(w.w), maxW)}<span class="num">${w.w >= 0 ? '+' : '−'}${Math.abs(w.w).toFixed(2)}</span>
    ${w.mult != null ? `<span class="muted small num" style="min-width:3.2em" title="Multiplier on this part of the draft suggestions">×${w.mult.toFixed(2)}</span>` : '<span class="muted small num" style="min-width:3.2em"></span>'}</span></div>`).join('');

  const surprises = Object.entries(L.yours).map(([k, v]) => { const [team, c] = k.split('|'); return { team: +team, c, ...v }; })
    .filter((x) => Math.abs(x.adj) >= 0.02).sort((a, b) => b.adj - a.adj);

  const rows = table('results', list, [
    { key: 'gameDate', label: 'In-game date', value: (r) => r.gameDate },
    { key: 'oppName', label: 'Against', html: (r) => `<a href="#/team/${r.opp}">${esc(r.oppName)}</a>`, value: (r) => r.oppName },
    { key: 'side', label: 'Side' },
    { key: 'us', label: 'Your picks', html: (r) => chips(m, r.picks.us), value: () => 0 },
    { key: 'them', label: 'Their picks', html: (r) => chips(m, r.picks.them), value: () => 0 },
    { key: 'predicted', label: 'Predicted', cls: 'num', value: (r) => r.predicted, html: (r) => pct(r.predicted) },
    { key: 'won', label: 'Result', value: (r) => (r.won ? 1 : 0), html: (r) => (r.won ? '<strong>Won</strong>' : 'Lost') },
    { key: 'x', label: '', value: () => 0, html: (r) => `<button class="ghost small" data-action="result-delete" data-id="${esc(r.id)}">Remove</button>` },
  ], { empty: 'No results yet. Finish a draft on the Draft page, then record whether you won.' });

  return `
  <h1>Results</h1>
  <p class="muted">The win chance on the Draft page comes from a model trained on every pro game in this save. Each result you record is added to its training, counted as ${YOUR_WEIGHT} pro games, and the model is retrained right away. What it learns changes how much each part of a suggestion counts.</p>
  <div class="grid two">
    <div class="card">
      <h2>How accurate it is</h2>
      <p class="muted small">Trained on the older 80% of pro games, then tested on the newest ${e.n} it had not seen.</p>
      <div class="kv"><span>Learned model</span><span class="num"><strong>${pct(e.learned.acc, 1)}</strong> right</span></div>
      <div class="kv"><span>Old hand-made formula</span><span class="num">${pct(e.hand.acc, 1)} right</span></div>
      <div class="kv"><span>Coin flip</span><span class="num">50.0% right</span></div>
      <div class="kv"><span>Log loss (lower is better)</span><span class="num">${e.learned.logloss.toFixed(3)} vs ${e.hand.logloss.toFixed(3)} vs ${e.coin.logloss.toFixed(3)}</span></div>
      ${done.length ? `<h2 style="margin-top:14px">Your games</h2>
      <div class="kv"><span>Recorded</span><span class="num">${done.length} (${wins} won)</span></div>
      <div class="kv"><span>Called the winner</span><span class="num">${hit} of ${done.length}</span></div>
      <div class="kv"><span>Average predicted win chance</span><span class="num">${pct(done.reduce((a, r) => a + r.predicted, 0) / done.length)}</span></div>
      <div class="kv"><span>Actual win rate</span><span class="num">${pct(wins / done.length)}</span></div>
      <div class="kv"><span>Brier score (0 is perfect, 0.25 is a coin flip)</span><span class="num">${(brier / done.length).toFixed(3)}</span></div>` : ''}
    </div>
    <div class="card">
      <h2>What decides games</h2>
      <p class="muted small">Learned weight of each factor, scaled so they compare. The × figure is how much that part now counts in draft suggestions compared with the starting formula.</p>
      ${weightRows}
      <p class="muted small">Player strength and side change the win chance but not which champion is suggested, since they are the same whatever you pick.</p>
    </div>
  </div>
  ${surprises.length ? `<div class="card"><h2>Champions doing better or worse than expected for you</h2>
    <p class="muted small">From your recorded games: how far results ran above or below what the model expected when you picked them, held back for small samples. This shows up as "Your results" in draft suggestions.</p>
    ${surprises.map((x) => `<div class="kv"><span>${chips(m, [x.c])} <span class="muted small">${esc(m.teamName(x.team))}, ${x.n} game${x.n === 1 ? '' : 's'}</span></span><span class="num">${x.adj >= 0 ? '+' : ''}${(x.adj * 100).toFixed(0)} pts</span></div>`).join('')}</div>` : ''}
  <div class="card">
    <h2>Recorded games</h2>
    <div class="row gap" style="margin:0 0 10px">
      <button class="ghost small" data-action="result-export" ${list.length ? '' : 'disabled'}>Export results</button>
      <button class="ghost small" data-action="result-import">Import results</button>
      <input type="file" id="result-file" accept=".json,application/json" hidden>
    </div>
    <p class="muted small">Results are kept in this browser only. Export them to back them up or move them to another computer.</p>
    ${rows}
  </div>`;
}

export function resultsEvents(a, el, app) {
  if (a === 'result-delete') {
    results.save(results.all().filter((r) => r.id !== el.dataset.id));
    learner(app.model).retrain(); return true;
  }
  if (a === 'result-export') {
    const blob = new Blob([JSON.stringify({ app: 'tfm2-analyst', kind: 'results', version: 1, results: results.all() }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'tfm2-results.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return false;
  }
  if (a === 'result-import') { document.getElementById('result-file')?.click(); return false; }
  if (a === 'change' && el.id === 'result-file' && el.files[0]) {
    el.files[0].text().then((t) => {
      try {
        const data = JSON.parse(t); const incoming = Array.isArray(data) ? data : data.results;
        if (!Array.isArray(incoming)) throw new Error('no results in this file');
        const have = new Map(results.all().map((r) => [r.id, r]));
        for (const r of incoming) if (r && r.id && r.picks && r.lineup) have.set(r.id, r);
        results.save([...have.values()].sort((x, y) => String(x.at).localeCompare(String(y.at))));
        learner(app.model).retrain(); app.render();
      } catch (e) { alert('Could not import that file: ' + e.message); }
    });
    return false;
  }
  return false;
}
