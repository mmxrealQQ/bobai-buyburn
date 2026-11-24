// A BUILDER'S TRANSFER WHOSE FATE IS UNKNOWN (2026-11-24, Liste B point 2, operator's go). The dev sweep
// (worker-dev-buyback/index.js and its local twin dev-buyback.js) wrote a builder's share down as owed the moment its
// receipt did not come — but "no receipt" means sent and not yet seen: the transfer could land a minute later, and the
// next run paid the builder its share a second time. Now such a transfer is kept as PENDING with its hash, and the next
// run asks the chain before it pays anything:
//   mined, success          paid — nothing is owed
//   mined, reverted         its BNB came back — owed to that builder
//   unknown to the chain    dropped, it can no longer land — owed
//   in the pool, or the node did not answer clearly      the run waits and pays nothing (the BNB may still leave)
// Pure apart from the two reads passed in; amounts are wei as strings, addresses lower case.

const notFound = (e) => /NotFound/i.test(String((e && (e.name || e.constructor?.name)) || '')) || /could not be found|not found/i.test(String((e && e.message) || ''));

export async function resolvePending(pendingIn, owedIn, client) {
  const pending = { ...(pendingIn || {}) }, owed = { ...(owedIn || {}) }, notes = [];
  let waiting = false;
  const owe = (to, value) => { owed[to] = String(BigInt(owed[to] || '0') + BigInt(value)); };
  for (const [to, p] of Object.entries(pending)) {
    if (!p || !/^0x[0-9a-fA-F]{64}$/.test(String(p.hash || '')) || !/^\d+$/.test(String(p.value || ''))) { delete pending[to]; notes.push(`${to}: an unreadable pending entry, dropped`); continue; }
    let rc = null, rcErr = null;
    try { rc = await client.getTransactionReceipt({ hash: p.hash }); } catch (e) { if (!notFound(e)) rcErr = e; }
    if (rc) {
      delete pending[to];
      if (rc.status === 'success') notes.push(`${to}: ${p.hash} landed — paid`);
      else { owe(to, p.value); notes.push(`${to}: ${p.hash} reverted — owed`); }
      continue;
    }
    if (rcErr) { waiting = true; notes.push(`${to}: ${p.hash} could not be read — waiting`); continue; }
    let tx = null, txErr = null;
    try { tx = await client.getTransaction({ hash: p.hash }); } catch (e) { if (!notFound(e)) txErr = e; }
    if (tx || txErr) { waiting = true; notes.push(`${to}: ${p.hash} ${tx ? 'still in the pool' : 'could not be read'} — waiting`); continue; }
    delete pending[to]; owe(to, p.value); notes.push(`${to}: ${p.hash} unknown to the chain (dropped) — owed`);
  }
  return { pending, owed, waiting, notes };
}

// "sent, but its receipt never came" — the one failure after which a transfer may still land
export const mayStillLand = (e) => /no receipt/.test(String((e && e.message) || ''));
