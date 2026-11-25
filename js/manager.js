// Manager advice: what to do next with your roster, training, contracts and signings.
// Everything is measured on the save's own pro games, so the advice follows what
// actually wins in this save rather than what a player's average stat suggests.
import { ROLES, wr } from './model.js';

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);

export const KNOWN = 200; // proficiency from which pros win more often than they lose on a champion
export const TARGET = 300; // a realistic training goal
const PROF_CAP = 600; // proficiency gains flatten out well before the 990 maximum
const MIN_ROLE = 75; // role rating needed to play a role at all

// Logistic regression with no intercept on side differences. Returns weights per raw unit.
function logit(X, Y, iters = 300) {
  const k = X[0].length;
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(mean(X.map((x) => x[j] ** 2))) || 1);
  const Z = X.map((x) => x.map((v, j) => v / sd[j]));
  const w = Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = Array(k).fill(0);
    for (let i = 0; i < Z.length; i++) {
      let s = 0; for (let j = 0; j < k; j++) s += w[j] * Z[i][j];
      const e = sigmoid(s) - Y[i];
      for (let j = 0; j < k; j++) g[j] += e * Z[i][j];
    }
    for (let j = 0; j < k; j++) w[j] -= 1.5 * (g[j] / Z.length + 0.001 * w[j]);
  }
  return w.map((v, j) => v / sd[j]);
}
const accuracy = (w, X, Y) => mean(X.map((x, i) => ((sum(x.map((v, j) => v * w[j])) > 0) === (Y[i] === 1) ? 1 : 0)));

// Least squares by normal equations (small k).
function ols(X, y) {
  const k = X[0].length, A = Array.from({ length: k }, () => Array(k + 1).fill(0));
  X.forEach((x, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += x[a] * x[b]; A[a][k] += x[a] * y[i]; } });
  for (let a = 0; a < k; a++) A[a][a] += 1e-6;
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}

// ---------- what wins games in this save ----------
// Stat weights come from each pro game's own lineup stats (as they were in that game).
export function winFactors(m) {
  if (m._winFactors) return m._winFactors;
  const A = m.athletes;
  const rows = [];
  for (const g of m.games) {
    const ps = g.players;
    if (ps.some((side) => side.some((p) => !p))) continue;
    // each lineup's stats as they were in that game; saves cached by older versions only have today's stats
    const statOf = (p) => p.stat || A[p.aid]?.stat;
    if (ps.some((side) => side.some((p) => !statOf(p)))) continue;
    const st = g.teamStat || ps.map((side) => Array.from({ length: 12 }, (_, i) => mean(side.map((p) => statOf(p)[i]))));
    const prof = ps.map((side, s) => mean(side.map((p, i) => Math.min(PROF_CAP, A[p.aid]?.prof?.[g.picks[s][i]]?.[0] ?? 50))));
    rows.push({ st, prof, y: g.winner === 0 ? 1 : 0 });
  }
  if (rows.length < 100) return (m._winFactors = null);
  const Y = rows.map((r) => r.y);
  const Xs = rows.map((r) => r.st[0].map((v, i) => v - r.st[1][i]));
  const raw = logit(Xs, Y);
  const pos = raw.map((v) => Math.max(0, v));
  const total = sum(pos) || 1;
  const weights = pos.map((v) => v / total); // shares; impact = weighted average of stats, on the same 0-100 scale
  const impactOfStats = (s) => sum(s.map((v, i) => v * weights[i]));
  // joint model: lineup impact and champion proficiency
  const Xj = rows.map((r) => [impactOfStats(r.st[0]) - impactOfStats(r.st[1]), (r.prof[0] - r.prof[1]) / 100]);
  const [bImp, bProf] = logit(Xj, Y, 400);
  // honest check on the newest 20%: impact against the plain average
  const cut = Math.floor(rows.length * 0.8);
  const Xa = rows.map((r) => [mean(r.st[0]) - mean(r.st[1])]);
  const wTrain = logit(Xs.slice(0, cut), Y.slice(0, cut));
  const wPos = wTrain.map((v) => Math.max(0, v)), wSum = sum(wPos) || 1;
  const Xi = rows.map((r) => [sum(r.st[0].map((v, i) => v * wPos[i] / wSum)) - sum(r.st[1].map((v, i) => v * wPos[i] / wSum))]);
  const accImpact = accuracy(logit(Xi.slice(0, cut), Y.slice(0, cut)), Xi.slice(cut), Y.slice(cut));
  const accAvg = accuracy(logit(Xa.slice(0, cut), Y.slice(0, cut)), Xa.slice(cut), Y.slice(cut));
  // win rate by the player's proficiency on the champion they played
  const B = [[0, 100], [100, 200], [200, 350], [350, 500], [500, 1e9]].map(([lo, hi]) => ({ lo, hi, g: 0, w: 0 }));
  for (const g of m.games) for (const s of [0, 1]) g.picks[s].forEach((c, i) => {
    const p = g.players[s][i]; if (!p) return;
    const v = A[p.aid]?.prof?.[c]?.[0] ?? 50; const b = B.find((x) => v >= x.lo && v < x.hi);
    b.g++; if (g.winner === s) b.w++;
  });
  return (m._winFactors = { weights, raw, bImp, bProf, accImpact, accAvg, n: rows.length, test: rows.length - cut, profBuckets: B });
}

export function impactOf(m, a) {
  const f = winFactors(m);
  if (!a?.stat) return 0;
  if (!f) return a.rating;
  return sum(a.stat.map((v, i) => v * f.weights[i]));
}
// Win chance change from swapping one player for another of `delta` more impact.
export const winGainImpact = (f, delta) => (f ? sigmoid(f.bImp * delta / 5) - 0.5 : 0);
// Win chance change in games where one player is on a champion with `delta` more proficiency.
export const winGainProf = (f, delta) => (f ? sigmoid(f.bProf * delta / 100 / 5) - 0.5 : 0);

// ---------- salaries ----------
// What the market pays for a player, fitted on every contract in the save.
export function salaryModel(m) {
  if (m._salary) return m._salary;
  const feats = (a) => { const imp = impactOf(m, a), age = a.age || 22; return [1, imp, a.potential ?? imp, age, age * age]; };
  const rows = m.athletes.filter((a) => !a.bad && a.team >= 0 && a.contract?.salary > 0);
  const beta = rows.length > 50 ? ols(rows.map(feats), rows.map((a) => Math.log(a.contract.salary))) : null;
  const fair = (a) => (beta ? Math.exp(sum(feats(a).map((v, i) => v * beta[i]))) : a.contract?.salary || 0);
  return (m._salary = { fair });
}

const endYear = (a) => Number((a.contract?.end || '9999').slice(0, 4));

// ---------- the advice ----------
export function managerAdvice(m, opts = {}) {
  const my = m.myTeam;
  if (my == null) return { error: 'Your team was not found in the save header.' };
  const f = winFactors(m);
  const sal = salaryModel(m);
  const year = Number(String(m.db.date).slice(0, 4));
  const roster = (m.roster.get(my) || []).filter((a) => !a.bad && a.pos);
  for (const a of [...m.athletes]) if (!a.bad && a.stat) { a._impact = impactOf(m, a); }
  const imp = (a) => a?._impact ?? 0;

  // ----- lineup -----
  const current = (m.starters.get(my) || [null, null, null, null, null]).map((id) => (id == null ? null : m.athletes[id]));
  const best = bestLineup(roster, imp);
  const lineup = current.map((a, r) => a || best[r]);
  const lineupActions = [];
  ROLES.forEach((role, r) => {
    const cur = current[r], b = best[r];
    if (!b || b === cur) return;
    const d = imp(b) - imp(cur);
    if (cur && d < 1.5) return;
    lineupActions.push({ cat: 'lineup', gain: winGainImpact(f, d), title: `Start ${b.name} at ${role}${cur ? ` over ${cur.name}` : ''}`,
      why: cur ? `${b.name} has ${d.toFixed(1)} more impact (${imp(b).toFixed(1)} vs ${imp(cur).toFixed(1)}) and a ${role} rating of ${b.pos[r]}.` : `Nobody started at ${role} in your last game.`,
      players: [b.id, cur?.id].filter((x) => x != null) });
  });

  // ----- champion training -----
  let games = m.games.filter((g) => g.patch === m.patches[m.patches.length - 1]);
  for (let i = m.patches.length - 2; games.length < 300 && i >= 0; i--) games = games.concat(m.games.filter((g) => g.patch === m.patches[i]));
  const stats = m.champStats(games);
  const patchLabel = [...new Set(games.map((g) => g.patch))].sort().join(', ');
  const strong = ROLES.map((_, r) => Object.values(stats)
    .filter((s) => s.roles[r] >= Math.max(8, 0.25 * s.picks))
    .map((s) => ({ c: s.c, win: wr(winsInRole(games, s.c, r), s.roles[r]), games: s.roles[r], share: s.roles[r] / (2 * games.length), ban: s.banRate }))
    .filter((x) => x.win >= 0.52)
    .sort((a, b) => b.win - a.win).slice(0, 6));
  const knownBy = (c) => lineup.filter((a) => a && (a.prof?.[c]?.[0] ?? 0) >= KNOWN);
  const training = [], coverage = [];
  ROLES.forEach((role, r) => {
    const a = lineup[r]; if (!a) return;
    const list = strong[r];
    const known = list.filter((x) => (a.prof?.[x.c]?.[0] ?? 0) >= KNOWN);
    coverage.push({ r, a, known: known.length, of: list.length, list });
    let n = 0;
    for (const x of list) {
      const p = a.prof?.[x.c]?.[0] ?? 50;
      if (p >= KNOWN) continue;
      if (knownBy(x.c).length) continue; // someone else in the five already plays it
      const dislikes = a.dislike?.includes(x.c), likes = a.like?.includes(x.c);
      if (dislikes) { training.push({ cat: 'experience', gain: 0, title: `${a.name} dislikes ${m.champName(x.c)}, a strong ${role} pick`, why: `It wins ${(x.win * 100).toFixed(0)}% in ${role} on patch ${patchLabel}, but training a champion the player dislikes is bad for them. Pick it with someone else, or leave it.`, players: [a.id], champ: x.c }); continue; }
      const gain = winGainProf(f, Math.min(TARGET, PROF_CAP) - Math.min(p, PROF_CAP));
      const base = a.prof?.[x.c]?.[1] ?? 80;
      training.push({ cat: 'training', gain, rank: gain * (x.win - 0.45) / 0.1 * (1 - 0.5 * x.ban), champ: x.c, win: x.win, ban: x.ban, players: [a.id], prof: p, base, likes,
        title: `Train ${m.champName(x.c)} on ${a.name} (${role})`,
        why: `${m.champName(x.c)} wins ${(x.win * 100).toFixed(0)}% in ${role} over ${x.games} games on patch ${patchLabel}${x.ban >= 0.3 ? ` (banned in ${(x.ban * 100).toFixed(0)}% of games)` : ''}, and nobody in your five plays it. ${a.name} is at ${p} proficiency; at ${TARGET} it's worth about ${(gain * 100).toFixed(1)} points of win chance in every game you pick it.${likes ? ` ${a.name} likes this champion.` : ''}${base > 80 ? ` Starting proficiency ${base}, above the usual 80.` : ''}` });
      if (++n >= 2) break;
    }
    // champions they have trained that are weak now
    const weak = Object.entries(a.prof || {}).filter(([c, [p]]) => p >= KNOWN && stats[c] && stats[c].roles[r] >= 10 && wr(winsInRole(games, c, r), stats[c].roles[r]) < 0.47)
      .sort((x, y) => y[1][0] - x[1][0]).slice(0, 2);
    if (weak.length) coverage[coverage.length - 1].weak = weak.map(([c]) => c);
  });
  training.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));

  // ----- contracts -----
  const starterIds = new Set(lineup.filter(Boolean).map((a) => a.id));
  const roleOf = (a) => { const r = lineup.findIndex((x) => x && x.id === a.id); return r >= 0 ? r : a.mainRole; };
  const backup = ROLES.map((_, r) => roster.filter((a) => !starterIds.has(a.id) && a.pos[r] >= MIN_ROLE).sort((x, y) => imp(y) - imp(x))[0] || null);
  const contracts = [];
  const payroll = sum(roster.map((a) => a.contract?.salary || 0));
  const prospect = (a) => (a.age || 99) <= 21 && (a.potential ?? 0) >= 60;
  const bench = [], overpaid = [];
  for (const a of roster) {
    const s = a.contract?.salary || 0, fair = sal.fair(a), r = roleOf(a), end = endYear(a);
    const starter = starterIds.has(a.id), isBackup = backup.includes(a);
    if (end <= year) {
      if (starter) contracts.push({ cat: 'contracts', pri: 3, title: `Re-sign ${a.name} (${ROLES[r]} starter)`, players: [a.id], saving: 0,
        why: `Contract ends ${a.contract.end.slice(0, 10)}. The market rate for this player is about ${fmt(fair)} a year; they are on ${fmt(s)}.${replacementNote(m, a, r, imp, sal, year)}` });
      else if (!prospect(a)) contracts.push({ cat: 'contracts', pri: 1, title: `Let ${a.name}'s contract run out`, players: [a.id], saving: s,
        why: `Contract ends ${a.contract.end.slice(0, 10)}. ${isBackup ? `Your best backup at ${ROLES[r]}, but` : 'Not a starter, and'} ${imp(a).toFixed(1)} impact. Frees ${fmt(s)} a year.` });
      continue;
    }
    if (starter && end === year + 1 && fair > s * 1.15) contracts.push({ cat: 'contracts', pri: 2, title: `Extend ${a.name} early`, players: [a.id], saving: (fair - s),
      why: `On ${fmt(s)} until ${a.contract.end.slice(0, 10)}, but players like this get about ${fmt(fair)}. Locking in now saves around ${fmt(fair - s)} a year.` });
    if (starter && s > fair * 1.6 && s > 1e6) overpaid.push({ a, s, fair, r });
    if (!starter && !isBackup && !prospect(a)) bench.push(a);
  }
  if (bench.length) {
    const save = sum(bench.map((a) => a.contract?.salary || 0));
    contracts.push({ cat: 'contracts', pri: 2, saving: save, players: bench.map((a) => a.id),
      title: `Trim the bench: ${bench.length} player${bench.length > 1 ? 's' : ''} you don't need`,
      why: `They don't start, aren't the best backup in their role, and aren't young prospects (21 or under with potential 60+). Together they cost ${fmt(save)} a year (${Math.round(save / Math.max(1, payroll) * 100)}% of your payroll). Players who don't play add nothing to your win chance.` });
  }
  if (overpaid.length) {
    const extra = sum(overpaid.map((x) => x.s - x.fair));
    contracts.push({ cat: 'contracts', pri: 1, saving: extra, players: overpaid.map((x) => x.a.id),
      title: `${overpaid.length} starter${overpaid.length > 1 ? 's are' : ' is'} paid well above the market rate`,
      why: overpaid.map((x) => `${x.a.name} (${ROLES[x.r]}) gets ${fmt(x.s)}, where players with the same impact, potential and age get about ${fmt(x.fair)}`).join('; ')
        + `. That is ${fmt(extra)} a year over the market. When their contracts come up, check the signings below for the same impact for less.` });
  }
  contracts.sort((a, b) => b.pri - a.pri || b.saving - a.saving);

  // ----- signings -----
  const maxSalary = opts.maxSalary > 0 ? opts.maxSalary : Math.max(...roster.map((a) => a.contract?.salary || 0), 1e6) * 1.5;
  const pool = [];
  for (const a of m.athletes) {
    if (a.bad || !a.pos || a.team === my || a.retired) continue;
    for (let r = 0; r < 5; r++) {
      if (a.pos[r] < 80) continue;
      const cur = lineup[r]; const d = imp(a) - imp(cur);
      if (d < 2) continue;
      const fair = sal.fair(a), ask = Math.max(fair, a.team >= 0 ? a.contract.salary || 0 : 0);
      if (ask > maxSalary) continue;
      const avail = a.team < 0 ? 'free' : endYear(a) <= year ? 'expiring' : 'contract';
      const gain = winGainImpact(f, d);
      pool.push({ a, r, d, gain, ask, fair, avail, value: gain / Math.max(0.2, ask / 1e6), fee: a.team >= 0 && avail === 'contract' ? a.contract.value || 0 : 0 });
    }
  }
  const easy = (x) => x.avail !== 'contract';
  pool.sort((x, y) => (easy(y) - easy(x)) || y.value - x.value);
  const signings = [];
  const seen = new Set();
  for (const x of pool) {
    if (signings.length >= 6) break;
    if (seen.has(x.a.id) || signings.filter((s) => s.r === x.r).length >= 2) continue;
    seen.add(x.a.id);
    const cur = lineup[x.r];
    signings.push({ cat: 'signings', r: x.r, gain: x.gain, players: [x.a.id, cur?.id].filter((v) => v != null), cand: x,
      title: x.avail === 'free' ? `Sign ${x.a.name} (${ROLES[x.r]}, free agent)` : x.avail === 'expiring' ? `Sign ${x.a.name} when their contract ends (${ROLES[x.r]}, ${m.teamName(x.a.team)})` : `Bid for ${x.a.name} (${ROLES[x.r]}, ${m.teamName(x.a.team)})`,
      why: `${x.d.toFixed(1)} more impact than ${cur ? cur.name : 'your current option'}: about +${(x.gain * 100).toFixed(1)} points of win chance per game. Expected salary ${fmt(x.ask)} a year${x.avail === 'expiring' ? `; contract ends ${x.a.contract.end.slice(0, 10)}, so no transfer fee after that` : x.avail === 'free' ? ', no transfer fee' : ''}. Age ${x.a.age}, ${ROLES[x.r]} rating ${x.a.pos[x.r]}.` });
  }
  const bestPerRole = ROLES.map((_, r) => pool.filter((x) => x.r === r).sort((a, b) => b.value - a.value).slice(0, 8));

  // ----- fans and standing -----
  const t = m.teams[my], lg = m.league(t.league);
  const stand = m.standings(t.league);
  const rank = stand.findIndex((s) => s.team.id === my) + 1;
  const upper = lg && lg.division > 0 ? m.leagues.find((l) => l.region === lg.region && l.division < lg.division) : null;
  const fans = { league: lg, rank, of: stand.length, row: stand[rank - 1], upper, leader: stand[0] };

  // ----- player experience -----
  const experience = training.filter((x) => x.cat === 'experience');
  for (const a of lineup) {
    if (!a?.dislike?.length) continue;
    const played = a.log.filter((l) => l.team === my && a.dislike.includes(l.champ));
    if (played.length) experience.push({ cat: 'experience', gain: 0, players: [a.id], title: `${a.name} keeps playing champions they dislike`,
      why: `${played.length} of their games for you were on ${[...new Set(played.map((l) => m.champName(l.champ)))].join(', ')}. Pick something else for them when you can.` });
  }

  const trainingOnly = training.filter((x) => x.cat === 'training');
  const top = [
    ...lineupActions.map((x) => ({ ...x, score: x.gain })),
    ...trainingOnly.slice(0, 3).map((x) => ({ ...x, score: x.rank * 0.6 })),
    ...signings.slice(0, 3).map((x) => ({ ...x, score: x.gain * (x.cand.avail === 'contract' ? 0.4 : 0.8) })),
    ...contracts.filter((x) => x.pri >= 2).map((x) => ({ ...x, score: 0.01 + (x.saving / Math.max(1, payroll)) * 0.05 })),
  ].sort((a, b) => b.score - a.score).slice(0, 6);

  return {
    f, year, payroll, roster, lineup, current, best, lineupActions, strong, coverage, training: trainingOnly, patchLabel,
    contracts, maxSalary, signings, bestPerRole, fans, experience, top, imp, sal, starterIds, games: games.length,
  };
}

function winsInRole(games, c, r) {
  let w = 0;
  for (const g of games) for (const s of [0, 1]) { const i = g.picks[s].indexOf(c); if (i >= 0 && g.players[s][i]?.slot === r && g.winner === s) w++; }
  return w;
}

// Best five from the roster: highest total impact, each in a role they can play.
function bestLineup(roster, imp) {
  const cands = ROLES.map((_, r) => roster.filter((a) => a.pos[r] >= MIN_ROLE).sort((x, y) => imp(y) - imp(x)).slice(0, 4));
  let best = null, bestV = -1;
  const rec = (r, used, picked, v) => {
    if (r === 5) { if (v > bestV) { bestV = v; best = picked.slice(); } return; }
    const list = cands[r].filter((a) => !used.has(a.id));
    if (!list.length) { picked.push(null); rec(r + 1, used, picked, v); picked.pop(); return; }
    for (const a of list) { used.add(a.id); picked.push(a); rec(r + 1, used, picked, v + imp(a)); picked.pop(); used.delete(a.id); }
  };
  rec(0, new Set(), [], 0);
  return best || [null, null, null, null, null];
}

function replacementNote(m, a, r, imp, sal, year) {
  const alt = m.athletes.filter((x) => !x.bad && x.pos && x.team !== a.team && x.pos[r] >= 80 && (x.team < 0 || endYear(x) <= year) && imp(x) >= imp(a) - 1)
    .map((x) => ({ x, fair: sal.fair(x) })).filter((y) => y.fair < sal.fair(a)).sort((p, q) => p.fair - q.fair)[0];
  return alt ? ` A cheaper option at the same level: ${alt.x.name} (${alt.x.team < 0 ? 'free agent' : 'contract ending'}), about ${fmt(alt.fair)}.` : '';
}

export function fmt(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
