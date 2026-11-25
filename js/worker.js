// Decodes a save off the main thread.
import { decodeSave } from './decodesave.js';

self.onmessage = async (ev) => {
  const { file, champText } = ev.data;
  const post = (stage, f) => self.postMessage({ type: 'progress', stage, f });
  try {
    const { db, png } = await decodeSave(file, champText, post);
    self.postMessage({ type: 'done', db, png }, [png.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
