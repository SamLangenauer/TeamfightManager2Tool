// Decodes a save off the main thread.
import { readContainer, inflate, decodeBody } from './decoder.js';
import { parseChampions } from './champions.js';

self.onmessage = async (ev) => {
  const { file, champText } = ev.data;
  const post = (stage, f) => self.postMessage({ type: 'progress', stage, f });
  try {
    const champs = parseChampions(champText);
    post('Reading header', 0);
    const c = readContainer(file);
    post('Decompressing', 0.01);
    const body = await inflate(file, c.gzipOffset);
    const db = decodeBody(body, Object.keys(champs), post);
    db.meta = { teamName: c.strings[0] || null, manager: c.strings.find((s, i) => i > 0 && !s.includes(':')) || null,
      logo: c.strings.find((s) => s.includes('logo')) || null, bodySize: body.length };
    // keep each lineup's average stats (used to learn which stats win games), then
    // trim the per-player stat copies to keep the cached save small
    for (const g of db.games) {
      if (g.players.every((side) => side.every((p) => p && p.stat))) {
        g.teamStat = g.players.map((side) => Array.from({ length: 12 }, (_, i) => Math.round(side.reduce((t, p) => t + p.stat[i], 0) / 5 * 10) / 10));
      }
    }
    for (const g of db.games) for (const side of g.players) for (const p of side) if (p) delete p.stat;
    const png = c.png;
    self.postMessage({ type: 'done', db, png }, [png.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
