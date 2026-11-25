// "Ask Claude" on the Draft page. Only shows when the app runs as a Claude artifact, where the
// page can ask Claude on the viewer's own account (the `sample` capability). On GitHub Pages
// there is no window.claude, so the tab stays hidden and nothing here runs.
//
// Each question goes to Claude with the live draft: both teams, players and their champion
// pools, the app's suggestions with their score parts, the model's win chance, comps and range.
// Claude can also call a few page functions to look up more numbers from the save.
import { ROLES, pct } from './model.js';
import { esc } from './ui.js';
import { local } from './store.js';
import { results } from './learn.js';
import { compModel, teamComp, missingPieces, rangeMatchups, COMPS } from './comps.js';
import { partnersOf, comboStats, pairKey } from './combos.js';
import { kitReasons } from './compview.js';

let sample = null; // the capability, once the viewer's Claude app hands it over
let app = null;
const chat = { turns: local.get('askchat', []), busy: false, live: '', status: '', error: '', ctl: null, input: '', tier: local.get('asktier', 'default') };
const keep = () => local.set('askchat', chat.turns.slice(-30));

if (typeof window !== 'undefined' && window.claude?.use) {
  window.claude.use('sample').then((s) => { sample = s; if (s) window.tfm2?.render?.(); }).catch(() => {});
}
export const askAvailable = () => !!sample;

// ---------- context ----------
const r1 = (x) => Math.round(x * 10) / 10;

function nameToId(m, s) {
  if (!s) return null;
  const q = String(s).trim().toLowerCase();
  return m.champIds.find((c) => m.champName(c).toLowerCase() === q || c.toLowerCase() === q)
    || m.champIds.find((c) => m.champName(c).toLowerCase().startsWith(q))
    || m.champIds.find((c) => m.champName(c).toLowerCase().includes(q)) || null;
}

function playerLine(m, x, aid, role) {
  const a = m.athletes[aid];
  if (!a) return `  ${ROLES[role]}: (nobody set)`;
  const pool = m.champPool(a, 6).map((p) => `${m.champName(p.c)} prof ${p.prof}${p.g ? `, ${p.w}-${p.g - p.w} in pro games` : ''}, comfort ${p.comfort.toFixed(2)}`).join('; ');
  return `  ${ROLES[role]}: ${a.name} (overall ${a.rating}, ${ROLES[role]} rating ${a.pos?.[role] ?? '?'}, best role ${ROLES[a.mainRole]}). Best champions: ${pool}`;
}

// The live draft as plain text for Claude.
export function draftContext(x) {
  const { m, D, engine, st, steps, cur, step, ourTurn, recs, assigned, out, L, sides, partLabel, label } = x;
  const lines = [];
  const usName = m.teamName(D.us), themName = m.teamName(D.opp);
  const patch = D.patch === 'latest' ? `latest patch (${m.patches[m.patches.length - 1]})` : D.patch === 'all' ? 'all patches' : `patch ${D.patch}`;
  lines.push(`SAVE: in-game date ${m.db.date}. Draft stats use ${patch}: ${engine.games.length} pro games.`);
  lines.push(`MATCH: ${usName} (us, side ${D.side}${D.side === 'A' ? ', first pick' : ''}) vs ${themName}. ${D.bansPer} bans each, pick order ${D.order === 'snake' ? 'A B B A A B B A A B' : 'alternating'}.${D.fearless !== 'off' ? ` Fearless ${D.fearless}, game ${D.series.games.length + 1} of best of ${D.series.bestOf}; locked for us: ${[...engine.locked.us].map((c) => m.champName(c)).join(', ') || 'none'}; locked for them: ${[...engine.locked.them].map((c) => m.champName(c)).join(', ') || 'none'}.` : ''}`);
  const tl = steps.map((s, i) => {
    const who = s.side === D.side ? 'Us' : 'Them'; const c = D.entries[i];
    return `${i + 1}. ${who} ${s.kind}: ${c ? m.champName(c) : i === cur ? '<- NOW' : '-'}`;
  });
  lines.push('DRAFT ORDER: ' + tl.join(' | '));
  lines.push(`NOW: ${step ? label : 'draft complete'}.`);
  lines.push(`WIN CHANCE for ${usName} (app model, logistic, trained on ${L.pro.length} pro games${L.mine.length ? ` + ${L.mine.length} of Sam's recorded games` : ''}): ${pct(out)}.`);

  const cm = sides ? compModel(m) : null;
  for (const who of ['us', 'them']) {
    const tname = who === 'us' ? usName : themName;
    lines.push('', `${who === 'us' ? 'OUR TEAM' : 'THEIR TEAM'}: ${tname}`);
    lines.push(`  Bans: ${st[who].bans.map((c) => m.champName(c)).join(', ') || 'none yet'}`);
    const picks = st[who].picks.map((c, i) => {
      const r = assigned[who].roles[i]; const aid = r != null ? engine.lineup[who][r] : null;
      const set = D.roles[who][c] != null;
      return `${m.champName(c)} (${r != null ? ROLES[r] : '?'}${set ? '' : ', role guessed'}${aid != null ? `, ${m.athletes[aid]?.name}` : ''})`;
    });
    lines.push(`  Picks: ${picks.join(', ') || 'none yet'}`);
    lines.push('  Lineup:');
    for (let r = 0; r < 5; r++) lines.push(playerLine(m, x, engine.lineup[who][r], r));
    if (cm) {
      const tc = teamComp(cm, st[who].picks), other = teamComp(cm, st[who === 'us' ? 'them' : 'us'].picks);
      if (tc) {
        const miss = missingPieces(tc, other).map((p) => p.text);
        lines.push(`  Comp: ${COMPS[tc.main].name}, backup ${COMPS[tc.second].name} (style scores vs an average pro draft: ${Object.entries(tc.scores).map(([k, v]) => `${COMPS[k].name} ${v > 0 ? '+' : ''}${v.toFixed(1)}`).join(', ')}).${miss.length ? ' Missing: ' + miss.join('; ') + '.' : ''}`);
      }
    }
    const t = engine.tend[who]; const tg = engine.teamGames[who] || 0;
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `${m.champName(c)} ${n}`).join(', ');
    if (tg) lines.push(`  Habits over ${tg} games in the save: most picked ${top(t.picks)}; most banned ${top(t.bans)}; most banned against them ${top(t.bannedVs)}.`);
  }
  if (cm && sides) {
    const rm = rangeMatchups(cm, sides.us.byRole, sides.them.byRole);
    const ln = rm.lanes.filter((l) => l.penalty > 0.15 || l.edge > 0.15).map((l) => l.penalty > 0.15
      ? `${ROLES[l.role]}: their ${m.champName(l.b)} out-ranges our ${m.champName(l.a)} by ${l.gap} with little way in`
      : `${ROLES[l.role]}: our ${m.champName(l.a)} out-ranges their ${m.champName(l.b)} by ${-l.gap}`);
    if (rm.team > 0.15) ln.push('They out-reach us as a team and we have little engage');
    if (rm.team < -0.15) ln.push('We out-reach them as a team and they have little engage');
    if (ln.length) lines.push('', 'RANGE: ' + ln.join('; ') + '.');
  }

  if (step) {
    const who = ourTurn ? 'us' : 'them';
    lines.push('', `APP SUGGESTIONS for this step (${ourTurn ? 'our' : 'their likely'} ${step.kind}; score is a sum of parts, higher is better${step.kind === 'pick' ? '; "win" is our win chance if it is picked' : ''}):`);
    recs.forEach((rc, k) => {
      const parts = Object.entries(rc.parts).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([k2, v]) => `${partLabel[k2] || k2} ${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(', ');
      const pl = rc.player != null ? m.athletes[step.kind === 'ban' ? engine.lineup[ourTurn ? 'them' : 'us'][rc.role] : engine.lineup[who][rc.role]] : null;
      const after = step.kind === 'pick' ? x.predictFor(ourTurn ? [...st.us.picks, rc.c] : st.us.picks, ourTurn ? st.them.picks : [...st.them.picks, rc.c]) : null;
      const kr = sides ? kitReasons(m, rc.c, step.kind, ourTurn ? sides.us : sides.them, ourTurn ? sides.them : sides.us, rc.role).map((q) => q.text) : [];
      const roleTxt = rc.role == null ? '' : step.kind === 'ban' ? ` (would be ${ourTurn ? 'their' : 'our'} ${ROLES[rc.role]}${pl ? ' ' + pl.name + "'s" : ''} pick)` : ` (${ROLES[rc.role]}${pl ? ' for ' + pl.name : ''})`;
      lines.push(`  ${k + 1}. ${m.champName(rc.c)}${roleTxt}: score ${rc.total.toFixed(1)}${after != null ? `, win ${pct(after)}` : ''}. Parts: ${parts}.${kr.length ? ' Kit notes: ' + kr.join('; ') + '.' : ''}`);
    });
  }

  const s = engine.stats;
  const taken = new Set(D.entries.filter(Boolean));
  const meta = m.champIds.filter((c) => s[c] && s[c].picks + s[c].bans > 0).sort((a, b) => s[b].presence - s[a].presence).slice(0, 20)
    .map((c) => `${m.champName(c)}${taken.has(c) ? '*' : ''} ${s[c].picks}g ${pct(s[c].winRate)} raw / ${pct(s[c].adjWin)} adj, presence ${pct(s[c].presence)}, ban ${pct(s[c].banRate)}, ${ROLES[s[c].mainRole]}`);
  lines.push('', `META (top 20 by pick+ban presence in those ${engine.games.length} games; adj = win rate pulled toward 50% for sample size; * = already taken this draft): ${meta.join('; ')}.`);

  const hist = results.all().filter((h) => h.us === D.us && h.opp === D.opp && h.won != null);
  if (hist.length) lines.push(`SAM'S RECORD vs ${themName} with this tool: ${hist.filter((h) => h.won).length}-${hist.filter((h) => !h.won).length}.`);
  return lines.join('\n');
}

const RULES = `You are the draft analyst inside "TFM2 Analyst", a fan-made companion app for Teamfight Manager 2, an esports manager game where two AI-played teams of five fight on a small MOBA-style map. Sam manages one team and is drafting live in the game right now, so time is short.

How to answer:
- Lead with the answer in the first line (a champion, a ban, yes or no). Then at most 3 short bullets of reasons. Stay under about 120 words unless Sam asks for more.
- Be a moneyball analyst: lean on the numbers in the data (win rates and their sample sizes, the app's win chance, player proficiency and pro records). Say when a sample is small. Reputation and feelings do not count.
- Only use numbers that are in the data below or that a tool returns. If you need a number that is not there, call a tool. Never invent stats.
- What this save's pro games showed: the win chance model and the suggestion scores are the best guide. Comp styles, kit combos and range explain a draft well but add almost nothing to win prediction beyond champion strength, synergy and matchups, so use them as reasons, not as the main argument. Item builds barely change win rates.
- Use champion and player names exactly as written in the data.
- Plain text with short bullets ("- "). You may use **bold** for the pick. No tables, no headings.`;

// ---------- tools Claude can call ----------
function tools(x) {
  const { m, engine, st, D, predictFor } = x;
  const cid = (n) => { const c = nameToId(m, n); if (!c) throw new Error(`No champion called "${n}"`); return c; };
  return [
    {
      name: 'champion_info',
      description: 'Numbers for one champion in this save: pro record on the patch in use, roles played, each lineup player\'s proficiency and comfort on it, its pick score for each side if still open, pro pair records with picks already made, and our win chance if we pick it.',
      inputSchema: { type: 'object', properties: { champion: { type: 'string' } }, required: ['champion'] },
      execute({ champion }) {
        const c = cid(champion); const s = engine.stats[c];
        const taken = D.entries.includes(c);
        const players = {};
        for (const who of ['us', 'them']) players[who] = engine.lineup[who].map((aid, r) => {
          const a = m.athletes[aid]; if (!a) return null;
          let g = 0, w = 0; for (const l of a.log) if (l.champ === c) { g++; if (l.win) w++; }
          return { role: ROLES[r], player: a.name, proficiency: a.prof?.[c]?.[0] ?? 0, proGames: g, proWins: w, comfort: r1(m.comfort(a, c)) };
        }).filter(Boolean);
        const pair = (map, a, b) => { const v = map.get(a + '|' + b); return v ? { games: v[0], wins: v[1] } : { games: 0, wins: 0 }; };
        const score = (who) => { if (taken || st[who].picks.length >= 5) return null; const p = engine.pickScore(st, who, c); return { total: r1(p.total), role: ROLES[p.role], parts: Object.fromEntries(Object.entries(p.parts).map(([k, v]) => [k, r1(v)])) }; };
        const partners = partnersOf(m, c, st.us.picks).slice(0, 3).map((p) => ({ with: m.champName(p.with), kitLinks: p.links.map((l) => l.key), pro: p.pro ? { games: p.pro.g, wins: p.pro.w } : null }));
        return {
          champion: m.champName(c), class: m.champs[c].cat, alreadyTaken: taken,
          patch: s ? { games: s.picks, wins: s.wins, winRate: s.winRate == null ? null : r1(s.winRate * 100), adjustedWinRate: r1(s.adjWin * 100), presence: r1(s.presence * 100), banRate: r1(s.banRate * 100), roles: Object.fromEntries(ROLES.map((rn, i) => [rn, s.roles[i]])) } : null,
          players,
          pickScoreForUs: score('us'), pickScoreForThem: score('them'),
          withOurPicks: st.us.picks.map((o) => ({ ally: m.champName(o), ...pair(engine.syn, c, o) })),
          againstTheirPicks: st.them.picks.map((o) => ({ enemy: m.champName(o), ...pair(engine.vs, c, o) })),
          kitPartnersOnOurTeam: partners,
          ourWinChanceIfWePickIt: !taken && st.us.picks.length < 5 ? r1(predictFor([...st.us.picks, c], st.them.picks) * 100) : null,
        };
      },
    },
    {
      name: 'win_chance',
      description: 'The app model\'s win chance for us (percent) for any full or partial set of picks, using the current lineups and roles. Use it to compare what-if drafts.',
      inputSchema: { type: 'object', properties: { our_picks: { type: 'array', items: { type: 'string' } }, their_picks: { type: 'array', items: { type: 'string' } } }, required: ['our_picks', 'their_picks'] },
      execute({ our_picks, their_picks }) {
        const us = (our_picks || []).slice(0, 5).map(cid), them = (their_picks || []).slice(0, 5).map(cid);
        return { ourPicks: us.map((c) => m.champName(c)), theirPicks: them.map((c) => m.champName(c)), ourWinChance: r1(predictFor(us, them) * 100) };
      },
    },
    {
      name: 'player_pool',
      description: 'A lineup player\'s top champions by comfort (proficiency, pro games and form), with their patch strength. team is "us" or "them"; role is Top, Jungle, Mid, Bottom or Support.',
      inputSchema: { type: 'object', properties: { team: { type: 'string', enum: ['us', 'them'] }, role: { type: 'string', enum: ROLES } }, required: ['team', 'role'] },
      execute({ team, role }) {
        const r = ROLES.findIndex((x) => x.toLowerCase() === String(role).toLowerCase());
        const a = m.athletes[engine.lineup[team === 'them' ? 'them' : 'us'][r]];
        if (!a) return { error: 'Nobody is set in that role' };
        const taken = new Set(D.entries.filter(Boolean));
        return {
          player: a.name, overall: a.rating, roleRating: a.pos?.[r],
          champions: m.champPool(a, 15).map((p) => ({ champion: m.champName(p.c), taken: taken.has(p.c), proficiency: p.prof, proGames: p.g, proWins: p.w, comfort: r1(p.comfort), patchAdjWin: engine.stats[p.c] ? r1(engine.stats[p.c].adjWin * 100) : null })),
        };
      },
    },
    {
      name: 'pair_record',
      description: 'Pro game record of two champions, both on the same team and against each other, on the patch in use and across all games in the save.',
      inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
      execute({ a, b }) {
        const x = cid(a), y = cid(b);
        const v = (map) => { const q = map.get(x + '|' + y); return q ? { games: q[0], aWins: q[1] } : { games: 0, aWins: 0 }; };
        const all = comboStats(m).pairs.get(pairKey(x, y));
        return { a: m.champName(x), b: m.champName(y), sameTeamThisPatch: v(engine.syn), aAgainstBThisPatch: v(engine.vs), sameTeamAllGames: all ? { games: all.g, wins: all.w } : null };
      },
    },
  ];
}

// ---------- view ----------
function md(s) {
  // escaped first, then a little markdown: bold, bullets, line breaks
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').split('\n');
  let html = '', inList = false;
  for (const l of lines) {
    const b = l.match(/^\s*[-•*]\s+(.*)/);
    if (b) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${b[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

const QUICK = {
  ban: ['What should I ban and why?', 'Which of their players should I target with bans?'],
  pick: ['Which pick gives us the best win chance?', 'What are they likely to pick next?', 'Is the top suggestion worth it for our player?'],
  done: ['How do we win this game?', 'Where is our draft weakest?'],
};

// The draft page hands over its current state on every render, whichever tab is open.
export function setAskContext(x) { app = x.app || app; chat.ctx = x; }

export function askTab(x) {
  const quick = QUICK[x.step ? x.step.kind : 'done'];
  const msgs = chat.turns.map((t) => `<div class="ask-msg ${t.role}">${t.role === 'user' ? esc(t.content) : md(t.content)}</div>`).join('');
  const live = chat.busy ? `<div class="ask-msg assistant live" id="ask-live">${chat.live ? md(chat.live) : `<span class="muted">${esc(chat.status || 'Thinking…')}</span>`}</div>` : '';
  return `<div class="ask">
    <div class="ask-log" id="ask-log">${msgs || `<p class="muted small">Ask anything about this draft. Claude sees both teams, the players and their champion pools, the app's suggestions and win chance, and can look up more numbers from your save. It uses your own Claude account.</p>`}${live}
      ${chat.error ? `<p class="error small">${esc(chat.error)}</p>` : ''}</div>
    <textarea name="ask-input" rows="2" placeholder="Ask about this draft. Enter sends, Shift+Enter for a new line" ${chat.busy ? 'disabled' : ''}>${esc(chat.input)}</textarea>
    <div class="ask-bar">
      ${quick.map((q) => `<button class="ghost small" data-action="ask-quick" data-q="${esc(q)}" ${chat.busy ? 'disabled' : ''}>${esc(q)}</button>`).join('')}
      <span class="spacer"></span>
      ${chat.turns.length && !chat.busy ? '<button class="ghost small" data-action="ask-clear" title="Start a new conversation">Clear</button>' : ''}
      <select name="ask-tier" title="How long Claude thinks before answering"><option value="quick" ${chat.tier === 'quick' ? 'selected' : ''}>Fast</option><option value="default" ${chat.tier === 'default' ? 'selected' : ''}>Standard</option><option value="complex" ${chat.tier === 'complex' ? 'selected' : ''}>Deep</option></select>
      ${chat.busy ? '<button data-action="ask-stop">Stop</button>' : '<button class="primary" data-action="ask-send">Ask</button>'}
    </div>
  </div>`;
}

// Scroll the log to the end after each render.
export function afterRender() {
  const log = document.getElementById('ask-log'); if (log) log.scrollTop = log.scrollHeight;
}

const ERRORS = {
  not_granted: 'Claude was not allowed for this page. You can allow it from the artifact\'s permissions menu.',
  rate_limited: 'Claude is busy for your account right now. Wait a moment and ask again.',
  prompt_too_large: 'This question is too long. Clear the chat and ask again.',
};

function rerender(focus) {
  (app?.render || window.tfm2?.render)?.();
  afterRender();
  if (focus) document.querySelector('[name="ask-input"]')?.focus();
}

async function send(q) {
  q = (q || '').trim();
  if (!q || chat.busy || !sample || !chat.ctx) return;
  const x = chat.ctx;
  chat.busy = true; chat.live = ''; chat.error = ''; chat.status = 'Thinking…'; chat.input = '';
  const history = chat.turns.slice(-12);
  chat.turns.push({ role: 'user', content: q }); keep();
  rerender();
  const ctl = new AbortController(); chat.ctl = ctl;
  const input = [
    { role: 'user', content: RULES },
    ...history,
    { role: 'user', content: `Live draft data from the app:\n\n${draftContext(x)}\n\nSam's question: ${q}` },
  ];
  const tl = tools(x).map((t) => ({ ...t, execute: (inp) => { chat.status = `Looking up ${t.name.replace('_', ' ')}…`; const el = document.getElementById('ask-live'); if (el && !chat.live) el.innerHTML = `<span class="muted">${esc(chat.status)}</span>`; return t.execute(inp || {}); } }));
  try {
    const { text, truncated } = await sample(input, {
      signal: ctl.signal, cache: false, modelTier: chat.tier, tools: tl,
      onText: ({ text: t }) => { chat.live = t; const el = document.getElementById('ask-live'); if (el) { el.innerHTML = md(t); afterRender(); } },
    });
    chat.turns.push({ role: 'assistant', content: text + (truncated ? '\n\n(Cut short.)' : '') });
  } catch (e) {
    if (e?.text) chat.turns.push({ role: 'assistant', content: e.text + (e.code === 'cancelled' ? '\n\n(Stopped.)' : '') });
    if (e?.code !== 'cancelled') chat.error = ERRORS[e?.code] || `Claude could not answer: ${e?.message || e}`;
    if (!e?.text && chat.turns[chat.turns.length - 1]?.role === 'user' && e?.code === 'cancelled') chat.turns.pop();
  }
  chat.busy = false; chat.ctl = null; chat.live = ''; keep();
  rerender(true);
}

export function askEvents(a, el) {
  if (a === 'ask-send') { send(document.querySelector('[name="ask-input"]')?.value ?? chat.input); return false; }
  if (a === 'ask-quick' || a === 'ask-why') { send(el.dataset.q); return false; }
  if (a === 'ask-stop') { chat.ctl?.abort(); return false; }
  if (a === 'ask-clear') { chat.turns = []; chat.error = ''; keep(); return true; }
  return false;
}

// Typing and the model choice are kept without re-rendering the page.
if (typeof document !== 'undefined') {
  document.addEventListener('input', (ev) => { if (ev.target.name === 'ask-input') chat.input = ev.target.value; });
  document.addEventListener('change', (ev) => { if (ev.target.name === 'ask-tier') { chat.tier = ev.target.value; local.set('asktier', chat.tier); } });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.name === 'ask-input' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(ev.target.value); }
  });
}
