import { Model } from './model.js';
import { parseChampions } from './champions.js';
import { saveLast, loadLast, clearLast } from './store.js';
import { handleSortClick, esc } from './ui.js';
import * as V from './views.js';
import { draftView, draftEvents } from './draftview.js';
import { resultsView, resultsEvents } from './resultsview.js';

const app = { model: null, png: null, champText: null };
window.tfm2 = app; // handy for debugging in the console

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const routes = {
  home: V.home, players: V.players, player: V.player, teams: V.teams, team: V.team,
  scout: V.scout, meta: V.meta, champ: V.champ, games: V.games, game: V.game, draft: draftView, results: resultsView,
};

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  return { name: name || 'home', id, q: new URLSearchParams(query || '') };
}

export function render() {
  const r = parseHash();
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === r.name));
  if (!app.model) { main.innerHTML = V.loadScreen(app); nav.hidden = true; return; }
  nav.hidden = false;
  const view = routes[r.name] || V.home;
  try { main.innerHTML = view(app.model, r, app); }
  catch (e) { console.error(e); main.innerHTML = `<div class="card error">Something went wrong on this page: ${esc(e.message)}</div>`; }
  document.getElementById('save-name').textContent = app.model.db.meta?.teamName ? `${app.model.db.meta.teamName} · ${app.model.db.date}` : app.model.db.date;
}
app.render = render;

async function champText() {
  if (!app.champText) app.champText = await (await fetch(new URL('../data/champions.tsv', import.meta.url))).text();
  return app.champText;
}

async function useDb(db, png, cache = true) {
  const champs = parseChampions(await champText());
  app.model = new Model(db, champs);
  app.png = png;
  if (cache) saveLast({ db, png, savedAt: Date.now() });
  if (!location.hash || location.hash === '#/' || location.hash.startsWith('#/load')) location.hash = '#/home';
  render();
}

async function loadFile(file) {
  const status = document.getElementById('load-status');
  const setStatus = (t, f) => { if (status) status.innerHTML = `${esc(t)}${f != null ? ` <span class="bar wide"><span style="width:${Math.round(f * 100)}%"></span></span>` : ''}`; };
  setStatus('Reading the file…', 0);
  const buf = await file.arrayBuffer();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const text = await champText();
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') setStatus(m.stage + '…', m.f);
    else if (m.type === 'error') { setStatus('Could not read this save: ' + m.message); worker.terminate(); }
    else if (m.type === 'done') { worker.terminate(); useDb(m.db, m.png); }
  };
  worker.postMessage({ file: buf, champText: text }, [buf]);
}

// ---- events ----
document.addEventListener('click', async (ev) => {
  const th = ev.target.closest('th[data-sort-table]');
  if (th) { handleSortClick(th); render(); return; }
  const act = ev.target.closest('[data-action]');
  if (!act) return;
  const a = act.dataset.action;
  if (a === 'pick-file') document.getElementById('file-input').click();
  else if (a === 'load-last') {
    const last = await loadLast();
    if (last) useDb(last.db, last.png, false);
  } else if (a === 'forget') { await clearLast(); app.model = null; location.hash = '#/load'; render(); }
  else if (a === 'new-save') { app.model = null; location.hash = '#/load'; render(); }
  else if (V.handleAction(a, act, app) || draftEvents(a, act, app) || resultsEvents(a, act, app)) render();
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'file-input' && ev.target.files[0]) loadFile(ev.target.files[0]);
  else if (V.handleChange(ev.target, app) || draftEvents('change', ev.target, app) || resultsEvents('change', ev.target, app)) render();
});
document.addEventListener('input', (ev) => {
  if (ev.target.matches('[data-live]') && (V.handleChange(ev.target, app) || draftEvents('input', ev.target, app))) {
    const pos = ev.target.selectionStart, name = ev.target.name;
    render();
    const el = main.querySelector(`[name="${name}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} }
  }
});
document.addEventListener('dragover', (ev) => { ev.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', (ev) => {
  ev.preventDefault(); document.body.classList.remove('dragging');
  const f = ev.dataTransfer.files[0]; if (f) { app.model = null; location.hash = '#/load'; render(); loadFile(f); }
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

(async () => {
  const last = await loadLast();
  app.hasLast = !!last; app.lastInfo = last ? { date: last.db.date, team: last.db.meta?.teamName, savedAt: last.savedAt } : null;
  render();
})();
