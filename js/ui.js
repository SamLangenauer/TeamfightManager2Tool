// Small rendering helpers. Views return HTML strings; events are delegated.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sortState = new Map();

// cols: [{ key, label, value(row) -> sortable, html(row) -> cell html, cls, title }]
export function table(id, rows, cols, { limit = 300, empty = 'Nothing to show.', rowAttr } = {}) {
  const st = sortState.get(id) || { key: null, dir: -1 };
  let list = rows;
  if (st.key) {
    const col = cols.find((c) => c.key === st.key);
    if (col) {
      const v = col.value || ((r) => r[col.key]);
      list = rows.slice().sort((a, b) => {
        const x = v(a), y = v(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st.dir;
      });
    }
  }
  const shown = list.slice(0, limit);
  const head = cols.map((c) => `<th class="${c.cls || ''}" data-sort-table="${id}" data-sort-key="${c.key}" title="${esc(c.title || 'Sort')}">${esc(c.label)}${st.key === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = shown.map((r) => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map((c) => `<td class="${c.cls || ''}">${c.html ? c.html(r) : esc(c.value ? c.value(r) : r[c.key])}</td>`).join('')}</tr>`).join('');
  const more = list.length > limit ? `<div class="muted small">Showing ${limit} of ${list.length}. Narrow the filters to see the rest.</div>` : '';
  return `<div class="table-wrap"><table class="data">${'<thead><tr>' + head + '</tr></thead>'}<tbody>${body || `<tr><td colspan="${cols.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>${more}`;
}
export function handleSortClick(th) {
  const id = th.dataset.sortTable, key = th.dataset.sortKey;
  const st = sortState.get(id) || { key: null, dir: -1 };
  if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = -1; }
  sortState.set(id, st);
}
export function setSort(id, key, dir = -1) { if (!sortState.has(id)) sortState.set(id, { key, dir }); }

export const bar = (v, max = 100, cls = '') => `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></span></span>`;
export function statTone(v) { return v >= 85 ? 'tone-a' : v >= 70 ? 'tone-b' : v >= 50 ? 'tone-c' : 'tone-d'; }
export const num = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
export const link = (href, text, cls = '') => `<a href="${href}" class="${cls}">${esc(text)}</a>`;

export function select(name, options, value, attrs = '') {
  return `<select name="${name}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
