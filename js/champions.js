// Champion base data pulled once from the game's bundle.game_data (v0.7.3).
// Columns match data/champions.tsv.
const STAT = ['attack', 'magic_power', 'hp', 'defence', 'magic_resistance', 'move_speed', 'hp_regen', 'crit_chance'];
export async function loadChampions(url = new URL('../data/champions.tsv', import.meta.url)) {
  const text = typeof url === 'string' && !url.startsWith('http') && typeof window === 'undefined'
    ? (await import('node:fs')).readFileSync(url, 'utf8')
    : await (await fetch(url)).text();
  return parseChampions(text);
}
export function parseChampions(text) {
  const out = {};
  for (const line of text.trim().split('\n')) {
    const c = line.split('\t');
    const n = (i) => Number(c[i]);
    const stat = {}, growth = {};
    STAT.forEach((k, i) => { stat[k] = n(6 + i); growth[k] = n(14 + i); });
    out[c[0]] = {
      id: c[0], name: c[1], cat: c[2], tags: c[3].split('|'), range: n(4), attackCd: n(5),
      stat, growth, skills: [c[22], c[23], c[24]], mod: c[25] === '1',
    };
  }
  return out;
}
