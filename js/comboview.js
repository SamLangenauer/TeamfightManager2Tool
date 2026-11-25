// Combos page: champion pairs and trios whose kits work together, with their pro record.
import { esc, table, select } from './ui.js';
import { pct } from './model.js';
import { gameFilesCard, filtersFor } from './views.js';
import { compModel } from './comps.js';
import { allCombos, comboStats, kitLinks, LINKS } from './combos.js';
import { results } from './learn.js';

const chip = (m, c) => `<a class="chip cat-${(m.champs[c]?.cat || 'x').toLowerCase()}" href="#/champ/${c}">${esc(m.champName(c))}</a>`;
const signed = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

// one line per kind of link, strongest direction first
function why(m, links) {
  const seen = new Set(); const out = [];
  for (const l of links) { if (seen.has(l.key)) continue; seen.add(l.key); out.push(LINKS[l.key].text(m.champName(l.from), m.champName(l.to))); }
  return out;
}

export function combosView(m, r, app) {
  const cm = compModel(m);
  if (!cm) return `<h1>Combos</h1>${gameFilesCard(app, 'Combos are worked out from each champion\'s kit, so the app needs your game file first.')}`;
  const f = { c: '', show: 'all', ...filtersFor('combos') };
  const st = comboStats(m);
  // your own recorded games with both champions on your team
  const mine = results.all().filter((h) => h.won != null && h.picks?.us);
  const yours = (ids) => { const g = mine.filter((h) => ids.every((c) => h.picks.us.includes(c))); return g.length ? { g: g.length, w: g.filter((h) => h.won).length } : null; };
  let rows = allCombos(m);
  if (f.c) rows = rows.filter((x) => x.a === f.c || x.b === f.c);
  if (f.show === 'kit') rows = rows.filter((x) => x.links.length);
  if (f.show === 'proven') rows = rows.filter((x) => x.pro && x.pro.g >= 15 && x.pro.z > 1.5);
  const champOpts = [['', 'All champions'], ...Object.keys(cm.T).filter((c) => m.champs[c]).map((c) => [c, m.champName(c)]).sort((a, b) => a[1].localeCompare(b[1]))];
  const pairTable = table('combos', rows, [
    { key: 'pair', label: 'Pair', value: (x) => m.champName(x.a), html: (x) => `${chip(m, x.a)} ${chip(m, x.b)}` },
    { key: 'why', label: 'Why the kits work together', value: (x) => x.kit, html: (x) => { const w = why(m, x.links); return w.length ? `<ul class="why">${w.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<span class="muted small">No kit link found; strong pro record only</span>'; } },
    { key: 'g', label: 'Games', cls: 'num', value: (x) => x.pro?.g ?? 0 },
    { key: 'wr', label: 'Won together', cls: 'num', value: (x) => (x.pro ? x.pro.w / x.pro.g : null), html: (x) => (x.pro ? `${x.pro.w}–${x.pro.g - x.pro.w} (${pct(x.pro.w / x.pro.g)})` : '<span class="muted">never paired</span>') },
    { key: 'exp', label: 'Apart', cls: 'num', title: 'What the two champions win in games without each other, combined', value: (x) => x.pro?.exp ?? null, html: (x) => (x.pro ? pct(x.pro.exp) : '–') },
    { key: 'lift', label: 'Lift', cls: 'num', title: 'Win rate together minus apart, pulled toward 0 when there are few games', value: (x) => x.pro?.lift ?? null, html: (x) => (x.pro ? `<span class="${x.pro.lift >= 0 ? 'pos' : 'neg'}">${signed(x.pro.lift)}</span>` : '–') },
    { key: 'kit', label: 'Kit links', cls: 'num', value: (x) => x.kit, html: (x) => x.kit.toFixed(1) },
    { key: 'you', label: 'You', cls: 'num', title: 'Your recorded games with both on your team', value: (x) => yours([x.a, x.b])?.g ?? null, html: (x) => { const y = yours([x.a, x.b]); return y ? `${y.w}–${y.g - y.w}` : '–'; } },
  ], { limit: 150, empty: 'No combos match.' });

  let trios = st.trios.slice();
  if (f.c) trios = trios.filter((t) => t.ids.includes(f.c));
  trios.sort((a, b) => b.lift - a.lift);
  const trioTable = table('trios', trios.slice(0, 60), [
    { key: 'ids', label: 'Trio', value: (t) => m.champName(t.ids[0]), html: (t) => t.ids.map((c) => chip(m, c)).join(' ') },
    { key: 'why', label: 'Kit links inside it', value: (t) => 0, html: (t) => { const l = []; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) l.push(...kitLinks(cm, t.ids[i], t.ids[j])); const w = why(m, l.sort((a, b) => b.s - a.s)); return w.length ? `<ul class="why">${w.slice(0, 2).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted small">–</span>'; } },
    { key: 'g', label: 'Games', cls: 'num' },
    { key: 'wr', label: 'Won together', cls: 'num', value: (t) => t.w / t.g, html: (t) => `${t.w}–${t.g - t.w} (${pct(t.w / t.g)})` },
    { key: 'exp', label: 'Apart', cls: 'num', value: (t) => t.exp, html: (t) => pct(t.exp) },
    { key: 'lift', label: 'Lift', cls: 'num', value: (t) => t.lift, html: (t) => `<span class="${t.lift >= 0 ? 'pos' : 'neg'}">${signed(t.lift)}</span>` },
  ], { empty: 'No trio has 12 or more games together yet.' });

  return `<h1>Combos</h1>
  <div class="filters">
    <label>Champion ${select('c', champOpts, f.c, 'data-filter="combos"')}</label>
    <label>Show ${select('show', [['all', 'Kit combos and pro standouts'], ['kit', 'Kit combos only'], ['proven', 'Proven in pro games']], f.show, 'data-filter="combos"')}</label>
  </div>
  <div class="card">
    <h2>Pairs</h2>
    <p class="muted small">Kit links come from each champion's buffs, debuffs and fight traits: attack buffs on an auto-attacker, heals and shields on a carry, area crowd control into area damage, engage with a follow-up, a catch with burst, resistance shred for a carry. "Apart" is what the two champions win in games without each other; "Lift" is how much more they win together, pulled toward 0 when there are few games. With over a thousand pairs, lifts of ±10 points on 20 to 30 games turn up by chance, so "Proven" keeps only pairs well clear of that.</p>
    ${pairTable}
  </div>
  <div class="card">
    <h2>Trios</h2>
    <p class="muted small">Three champions on the same team in at least 12 pro games, ranked by how much more they win together than apart.</p>
    ${trioTable}
  </div>`;
}
