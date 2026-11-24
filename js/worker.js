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
    // trim per-game stat copies to keep the cached save small
    for (const g of db.games) for (const side of g.players) for (const p of side) if (p) delete p.stat;
    const png = c.png;
    self.postMessage({ type: 'done', db, png }, [png.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
