import { readGameFile } from './gamefiles.js';
import { setPortraits } from './portraits.js';
import { Model } from './model.js';
import { parseChampions } from './champions.js';
import { saveLast, loadLast, clearLast, saveKits, loadKits } from './store.js';
import { handleSortClick, esc } from './ui.js';
import * as V from './views.js';
import { draftView, draftEvents } from './draftview.js';
import { resultsView, resultsEvents } from './resultsview.js';
import { combosView } from './comboview.js';
import { nextView } from './nextview.js';

const app = { model: null, png: null, champText: null };
window.tfm2 = app; // handy for debugging in the console

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const routes = {
  home: V.home, players: V.players, player: V.player, teams: V.teams, team: V.team,
  scout: V.scout, meta: V.meta, champ: V.champ, games: V.games, game: V.game, draft: draftView, results: resultsView, combos: combosView, next: nextView,
};

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  return { name: name || 'home', id, q: new URLSearchParams(query || '') };
}

export function render() {
  const r = parseHash();
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === r.name));
  if (!app.model) { main.innerHTML = V.loadScreen(app); nav.hidden = true; document.body.dataset.route = 'load'; return; }
  nav.hidden = false;
  document.body.dataset.route = r.name;
  const view = routes[r.name] || V.home;
  try { main.innerHTML = view(app.model, r, app); }
  catch (e) { console.error(e); main.innerHTML = `<div class="card error">Something went wrong on this page: ${esc(e.message)}</div>`; }
  // Draft: keep the champion search ready, so the next ban or pick can be typed straight away.
  if (r.name === 'draft' && matchMedia('(pointer: fine)').matches && (!document.activeElement || document.activeElement === document.body)) {
    main.querySelector('[name="draft-filter"]')?.focus({ preventScroll: true });
  }
  document.getElementById('save-name').textContent = app.model.db.meta?.teamName ? `${app.model.db.meta.teamName} · ${app.model.db.date}` : app.model.db.date;
}
app.render = render;

async function champText() {
  if (!app.champText) app.champText = await (await fetch(new URL('../data/champions.tsv', import.meta.url))).text();
  return app.champText;
}

// Champion kits come from the user's bundle.game_data, read once and kept in this browser.
async function loadGameFile(file) {
  app.gameStatus = 'Reading champion data from the game files…'; render();
  try {
    const g = await readGameFile(file, (f) => { app.gameStatus = `Reading champion data from the game files… ${Math.round(f * 100)}%`; const el = document.getElementById('game-status'); if (el) el.textContent = app.gameStatus; });
    app.game = g; app.gameStatus = null; setPortraits(g.portraits);
    if (app.model) { app.model.kits = g.kits; app.model.items = g.items || null; }
    await saveKits(g);
  } catch (e) { app.gameStatus = 'Could not read that file: ' + e.message + '. Pick bundle.game_data from the game folder.'; }
  render();
}

async function useDb(db, png, cache = true) {
  const champs = parseChampions(await champText());
  app.model = new Model(db, champs);
  app.model.kits = app.game?.kits || null; app.model.items = app.game?.items || null;
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
  const text = await champText();
  // Decode in a worker. Where workers are not allowed (some embedded views), decode on the page instead.
  const onPage = async () => {
    try {
      const { decodeSave } = await import('./decodesave.js');
      const { db, png } = await decodeSave(buf, text, (stage, f) => setStatus(stage + '…', f));
      useDb(db, png);
    } catch (e) { setStatus('Could not read this save: ' + (e.message || e)); }
  };
  let worker;
  try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch { return onPage(); }
  let started = false;
  worker.onerror = (e) => { e.preventDefault?.(); worker.terminate(); if (!started) onPage(); else setStatus('Could not read this save: ' + (e.message || 'the decoder stopped')); };
  worker.onmessage = (ev) => {
    const m = ev.data; started = true;
    if (m.type === 'progress') setStatus(m.stage + '…', m.f);
    else if (m.type === 'error') { setStatus('Could not read this save: ' + m.message); worker.terminate(); }
    else if (m.type === 'done') { worker.terminate(); useDb(m.db, m.png); }
  };
  // keep a copy for the on-page fallback; the worker gets its own
  worker.postMessage({ file: buf.slice(0), champText: text }, []);
}

// ---- events ----
document.addEventListener('click', async (ev) => {
  const th = ev.target.closest('th[data-sort-table]');
  if (th) { handleSortClick(th); render(); return; }
  const act = ev.target.closest('[data-action]');
  if (!act) return;
  const a = act.dataset.action;
  if (a === 'pick-file') document.getElementById('file-input').click();
  else if (a === 'pick-game') document.getElementById('game-input').click();
  else if (a === 'load-last') {
    const last = await loadLast();
    if (last) useDb(last.db, last.png, false);
  } else if (a === 'forget') { await clearLast(); app.model = null; location.hash = '#/load'; render(); }
  else if (a === 'new-save') { app.model = null; location.hash = '#/load'; render(); }
  else if (V.handleAction(a, act, app) || draftEvents(a, act, app) || resultsEvents(a, act, app)) render();
});
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-live]')) return; // already handled on input; a late change on blur would render twice
  if (ev.target.id === 'game-input' && ev.target.files[0]) { loadGameFile(ev.target.files[0]); ev.target.value = ''; }
  else if (ev.target.id === 'file-input' && ev.target.files[0]) { loadFile(ev.target.files[0]); ev.target.value = ''; } // reset so the same file can be picked again
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
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('[name="draft-filter"]') && draftEvents('enter', ev.target, app)) { ev.preventDefault(); render(); }
});
document.addEventListener('dragover', (ev) => { ev.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', (ev) => {
  ev.preventDefault(); document.body.classList.remove('dragging');
  const f = ev.dataTransfer.files[0];
  if (f && /\.game_data$/i.test(f.name)) { loadGameFile(f); return; }
  if (f) { app.model = null; location.hash = '#/load'; render(); loadFile(f); }
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

(async () => {
  // ask the browser not to clear stored data (match history) under storage pressure
  try { await navigator.storage?.persist?.(); } catch {}
  app.game = await loadKits();
  setPortraits(app.game?.portraits);
  const last = await loadLast();
  app.hasLast = !!last; app.lastInfo = last ? { date: last.db.date, team: last.db.meta?.teamName, savedAt: last.savedAt } : null;
  render();
})();
