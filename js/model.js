// Turns the decoded save into indexes and analytics used by every view.
import { STAT_KEYS, HIDDEN_KEYS } from './decoder.js';

export const ROLES = ['Top', 'Jungle', 'Mid', 'Bottom', 'Support'];
export const STAT_LABELS = ['Last hit', 'Skill dodge', 'Skill accuracy', 'Positioning', 'Control speed', 'Concentration',
  'Mental', 'Judgement', 'Teamwork', 'Roaming', 'Aggression', 'Ego'];
export const HIDDEN_LABELS = ['True potential', 'Stamina recovery (min)', 'Stamina recovery (max)', 'Stamina cost per set (min)',
  'Stamina cost per set (max)', 'Stress sensitivity', 'Condition baseline', 'Condition swing', 'Condition cycle (days)',
  'Condition phase', 'Big-match sensitivity'];
export const REGIONS = ['Korea', 'China', 'Europe', 'North America', 'South America', 'Japan'];
const LEAGUE_LABEL = { tack: 'KR Div 1', tacc: 'CN Div 1', tace: 'EU Div 1', taca: 'NA Div 1', tacs: 'SA Div 1', tacj: 'JP Div 1',
  tack2: 'KR Div 2', tacc2: 'CN Div 2', tace2: 'EU Div 2', taca2: 'NA Div 2', tacs2: 'SA Div 2', tacj2: 'JP Div 2' };
export { STAT_KEYS, HIDDEN_KEYS };

// Smoothed win rate: pulls small samples toward 50%.
export const wr = (w, g, k = 10) => (w + k / 2) / (g + k);

export class Model {
  constructor(db, champs) {
    this.db = db; this.champs = champs;
    this.champIds = Object.keys(champs);
    this.leagues = db.leagues.map((l) => ({ ...l, label: LEAGUE_LABEL[l.key] || l.name, regionName: REGIONS[l.region] || `Region ${l.region}` }));
    this.teams = db.teams;
    this.athletes = db.athletes;
    this.games = db.games.filter((g) => g.teams[0] < this.teams.length && g.teams[1] < this.teams.length);
    this.myTeam = this.teams.find((t) => t.name === db.meta?.teamName)?.id ?? null;
    this.patches = [...new Set(this.games.map((g) => g.patch))].sort();
    this.#index();
  }

  #index() {
    const { athletes, teams, games } = this;
    for (const a of athletes) {
      a.team = a.contract?.team ?? -1;
      a.rating = a.stat ? Math.round(a.stat.reduce((x, y) => x + y, 0) / 12) : 0;
      a.mainRole = a.pos ? a.pos.indexOf(Math.max(...a.pos)) : 0;
      a.roleRating = a.pos ? Math.max(...a.pos) : 0;
      a.potential = a.hidden?.[0] ?? null;
      a.log = [];
    }
    this.roster = new Map(teams.map((t) => [t.id, []]));
    for (const a of athletes) if (this.roster.has(a.team)) this.roster.get(a.team).push(a);
    this.teamGames = new Map(teams.map((t) => [t.id, []]));
    for (const g of games) {
      g.league = this.teams[g.teams[0]].league === this.teams[g.teams[1]].league ? this.teams[g.teams[0]].league : null;
      for (const side of [0, 1]) {
        this.teamGames.get(g.teams[side]).push(g);
        g.players[side].forEach((p, i) => {
          if (!p) return;
          const a = athletes[p.aid]; if (!a) return;
          const s = g.sum[side];
          a.log.push({ g, side, champ: g.picks[side][i], role: p.slot, win: g.winner === side,
            k: s.k[i], d: s.d[i], gold: s.gold[i], cs: s.cs[i], dmg: s.dmg[i], team: g.teams[side], opp: g.teams[1 - side] });
        });
      }
    }
    // current starters: the five players of the team's latest game
    this.starters = new Map();
    for (const t of teams) {
      const tg = this.teamGames.get(t.id); const last = tg[tg.length - 1];
      if (!last) continue;
      const side = last.teams[0] === t.id ? 0 : 1;
      const five = [null, null, null, null, null];
      last.players[side].forEach((p) => { if (p && p.slot < 5) five[p.slot] = p.aid; });
      this.starters.set(t.id, five);
    }
  }

  league(id) { return this.leagues.find((l) => l.id === id); }
  teamName(id) { return id >= 0 ? this.teams[id]?.name ?? `Team ${id}` : 'Free agent'; }
  champName(id) { return this.champs[id]?.name ?? id; }

  filterGames({ patches, league, team } = {}) {
    return this.games.filter((g) => (!patches || patches.includes(g.patch))
      && (league == null || league === '' || this.teams[g.teams[0]].league === +league || this.teams[g.teams[1]].league === +league)
      && (team == null || g.teams.includes(team)));
  }

  // Champion meta table for a set of games.
  champStats(games) {
    const s = Object.fromEntries(this.champIds.map((c) => [c, { c, picks: 0, wins: 0, bans: 0, roles: [0, 0, 0, 0, 0], k: 0, d: 0, dmg: 0, gold: 0 }]));
    for (const g of games) {
      for (const side of [0, 1]) {
        g.picks[side].forEach((c, i) => {
          const x = s[c]; if (!x) return;
          x.picks++; if (g.winner === side) x.wins++;
          const p = g.players[side][i]; if (p) x.roles[p.slot]++;
          const sm = g.sum[side]; x.k += sm.k[i]; x.d += sm.d[i]; x.dmg += sm.dmg[i]; x.gold += sm.gold[i];
        });
        for (const c of g.bans[side]) if (s[c]) s[c].bans++;
      }
    }
    const n = games.length || 1;
    for (const x of Object.values(s)) {
      x.pickRate = x.picks / n; x.banRate = x.bans / n; x.presence = (x.picks + x.bans) / n;
      x.winRate = x.picks ? x.wins / x.picks : null; x.adjWin = wr(x.wins, x.picks);
      x.kda = x.picks ? (x.k / Math.max(1, x.d)) : null;
      x.mainRole = x.roles.indexOf(Math.max(...x.roles));
    }
    return s;
  }

  // Pair tables: same-team synergy and cross-team matchups.
  pairStats(games) {
    const syn = new Map(), vs = new Map();
    const add = (m, key, win) => { const v = m.get(key) || [0, 0]; v[0]++; if (win) v[1]++; m.set(key, v); };
    for (const g of games) {
      for (const side of [0, 1]) {
        const mine = g.picks[side], theirs = g.picks[1 - side], win = g.winner === side;
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            if (i !== j) add(syn, mine[i] + '|' + mine[j], win);
            add(vs, mine[i] + '|' + theirs[j], win);
          }
        }
      }
    }
    return { syn, vs };
  }

  // Standings for a league from league games (both teams in the league).
  standings(leagueId, patches) {
    const rows = new Map(this.teams.filter((t) => t.league === leagueId).map((t) => [t.id, { team: t, w: 0, l: 0, k: 0, d: 0 }]));
    for (const g of this.games) {
      if (patches && !patches.includes(g.patch)) continue;
      const [a, b] = g.teams; if (!rows.has(a) || !rows.has(b)) continue;
      for (const side of [0, 1]) {
        const r = rows.get(g.teams[side]);
        if (g.winner === side) r.w++; else r.l++;
        r.k += g.sum[side].kills; r.d += g.sum[side].deaths;
      }
    }
    return [...rows.values()].sort((x, y) => (y.w - y.l) - (x.w - x.l) || y.w - x.w || (y.k - y.d) - (x.k - x.d));
  }

  // What a team picks and bans, and what gets banned against it.
  teamTendencies(teamId, games) {
    const picks = {}, bans = {}, bannedVs = {}, wins = {};
    for (const g of games) {
      const side = g.teams[0] === teamId ? 0 : g.teams[1] === teamId ? 1 : -1; if (side < 0) continue;
      for (const c of g.picks[side]) { picks[c] = (picks[c] || 0) + 1; if (g.winner === side) wins[c] = (wins[c] || 0) + 1; }
      for (const c of g.bans[side]) bans[c] = (bans[c] || 0) + 1;
      for (const c of g.bans[1 - side]) bannedVs[c] = (bannedVs[c] || 0) + 1;
    }
    return { picks, bans, bannedVs, wins };
  }

  // A player's comfort on a champion, 0..1, from proficiency and games played.
  comfort(a, c) {
    if (!a) return 0;
    const prof = a.prof?.[c]?.[0] ?? 50;
    const profScore = Math.max(0, Math.min(1, (prof - 60) / 500));
    let g = 0, w = 0;
    for (const l of a.log) if (l.champ === c) { g++; if (l.win) w++; }
    const exp = Math.min(1, g / 8);
    const form = g ? wr(w, g, 6) - 0.5 : 0;
    return Math.max(0, Math.min(1, 0.65 * profScore + 0.25 * exp + 0.5 * form + 0.1));
  }

  champPool(a, n = 8) {
    const rows = this.champIds.map((c) => {
      let g = 0, w = 0, k = 0, d = 0;
      for (const l of a.log) if (l.champ === c) { g++; if (l.win) w++; k += l.k; d += l.d; }
      return { c, prof: a.prof?.[c]?.[0] ?? 0, base: a.prof?.[c]?.[1] ?? 0, g, w, k, d, comfort: this.comfort(a, c) };
    });
    rows.sort((x, y) => y.comfort - x.comfort || y.prof - x.prof);
    return n ? rows.slice(0, n) : rows;
  }
}

export function fmtMoney(v) {
  if (v == null) return '';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
export const pct = (x, d = 0) => (x == null ? '–' : (x * 100).toFixed(d) + '%');
