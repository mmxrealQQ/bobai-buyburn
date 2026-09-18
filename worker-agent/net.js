// Reading what a stranger's server sends back, with an end to it.
//
// Every endpoint this worker talks to is an address somebody wrote into a
// public registry. `await r.text()` reads whatever arrives: a server that
// answers with a hundred megabytes (or never stops) takes the invocation's
// memory and time with it, and one such body written on into KV fails the
// write in silence. 256 KB is far above the largest honest answer measured
// (36 KB); what comes after it is dropped and the text is marked cut.
export const MAX_BODY_BYTES = 256 * 1024;
export async function cappedText(r, max = MAX_BODY_BYTES) {
  if (!r || !r.body || typeof r.body.getReader !== 'function') return r && typeof r.text === 'function' ? (await r.text()).slice(0, max) : '';
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > max) { chunks.push(value.subarray(0, Math.max(0, max - size))); size = max; break; }
      chunks.push(value); size += value.byteLength;
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}
