// Groups the census by operator instead of by registry id.
//
// Why this exists, in one measurement: of 784 reachable agents, 72 hosts. Of
// 103 that speak MCP, 7 hosts — and 96 of those 103 return the identical five
// tools from the identical provider. Counting registry ids is the right way to
// describe the registry and the wrong way to describe a market. Fifty entries
// that are one service reads as fifty options, which is not a small error of
// presentation: it is the same "a directory lists claims" problem the census
// was built to expose, arriving through the back door.
//
// So: an operator is one entry, its instances are a number beside it. The
// census keeps every id. The market shows who is actually out there.

// Registry entries pointing at code hosts are not agent endpoints — 46 point at
// github.com. Reachable, certainly; a repository page answering 200 is not an
// agent, and letting them into the market list would be padding.
const NOT_AN_AGENT_HOST = /^(www\.)?(github\.com|gitlab\.com|x\.com|twitter\.com|t\.me|medium\.com|linktr\.ee|notion\.so|docs\.google\.com)$/i;

// Placeholders and things that were never an endpoint. Someone registered
// "https://google.com"; another left api.example.com from a tutorial. Both
// answer HTTP, so a reachability check passes them — and both would sit in a
// list of "agents on BNB Chain" as if they were one.
const PLACEHOLDER_HOST = /^(www\.)?(google\.[a-z.]+|example\.(com|org|net)|localhost|127\.0\.0\.1|test\.com|yourdomain\.[a-z]+|domain\.com|site\.com)$/i;

// We publish this list, which makes us its publisher. A registration is
// somebody else's text, but the page it appears on is ours — and one entry in
// the registry carries a racial slur as its agent name. It is excluded from
// what we present. The census still counts it as a reachable endpoint, because
// that is a measurement and measurements do not get edited; what we decline to
// do is put the word on our page. Matching is on word boundaries against the
// name only, so ordinary names that happen to contain a substring are safe.
const SLUR = /\b(nigg[ae]r?s?|f[a4]gg?ots?|k[i1]kes?|ch[i1]nks?|sp[i1]cs?|tr[a4]nn(y|ies)|ret[a4]rds?)\b/i;

export function hostOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.replace(/^www\./, '');
  } catch { return null; }
}

// Instances of one product usually differ only in subdomain or path
// (app.singularry.org/agents/12, /agents/13, …). Grouping on the registrable
// domain catches that without merging genuinely different operators who happen
// to share a platform.
export function operatorOf(agent) {
  const first = (agent.endpoints || []).map(hostOf).find(Boolean);
  if (!first) return null;
  const parts = first.split('.');
  if (parts.length <= 2) return first;
  // Keep three labels for known multi-level suffixes, two otherwise.
  const twoLevelTld = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(first);
  return parts.slice(twoLevelTld ? -3 : -2).join('.');
}

const toolSignature = (a) =>
  (a.tools || []).map((t) => t.name).sort().join('|') || (a.skills || []).slice().sort().join('|');

export function groupByOperator(agents) {
  const groups = new Map();

  for (const a of agents) {
    const host = (a.endpoints || []).map(hostOf).find(Boolean);
    const op0 = operatorOf(a);
    // Checked against the registrable domain, not the full host: the first
    // version tested "api.example.com" against /^example\.com$/ and let it
    // through. Subdomains of a placeholder are still placeholders.
    if (!host || NOT_AN_AGENT_HOST.test(host) || PLACEHOLDER_HOST.test(host)
        || (op0 && PLACEHOLDER_HOST.test(op0))) continue;
    if (SLUR.test(String(a.name || '')) || SLUR.test(String(a.description || ''))) continue;
    const op = op0;
    if (!op) continue;

    if (!groups.has(op)) {
      groups.set(op, {
        operator: op,
        instances: 0,
        ids: [],
        names: new Set(),
        speaks: new Set(),
        signatures: new Map(),
        best: null,
        descriptions: new Set(),
      });
    }
    const g = groups.get(op);
    g.instances++;
    g.ids.push(a.id);
    if (a.name) g.names.add(a.name);
    (a.speaks || []).forEach((s) => g.speaks.add(s));
    if (a.description) g.descriptions.add(a.description);

    const sig = toolSignature(a);
    if (sig) g.signatures.set(sig, (g.signatures.get(sig) || 0) + 1);

    // The representative is the richest instance: an operator running fifty
    // identical agents and one elaborate one should be judged on the elaborate
    // one, because that is what it can actually do.
    const rank = (x) => (x.tools?.length || 0) * 2 + (x.skills?.length || 0) + (x.speaks?.length || 0);
    if (!g.best || rank(a) > rank(g.best)) g.best = a;
  }

  return [...groups.values()]
    .map((g) => ({
      operator: g.operator,
      instances: g.instances,
      // A single agent and a fleet of clones are different things, and the
      // difference should be visible rather than inferred from a count.
      distinct_capabilities: g.signatures.size,
      ids: g.ids.slice(0, 50),
      name: g.best?.name || [...g.names][0] || null,
      description: g.best?.description || [...g.descriptions][0] || null,
      image: g.best?.image || null,
      speaks: [...g.speaks],
      endpoints: g.best?.endpoints || [],
      ...(g.best?.tools?.length ? { tools: g.best.tools } : {}),
      ...(g.best?.skills?.length ? { skills: g.best.skills } : {}),
      ...(g.best?.agent_card ? { agent_card: g.best.agent_card } : {}),
      ...(g.best?.trust_models?.length ? { trust_models: g.best.trust_models } : {}),
    }))
    // Ordered by what an operator can do, not how many ids it registered.
    // Registering a thousand identities must not buy a better position.
    .sort((a, b) => {
      const cap = (x) => (x.tools?.length || 0) * 2 + (x.skills?.length || 0);
      return (b.speaks.length - a.speaks.length)
        || (cap(b) - cap(a))
        || (b.distinct_capabilities - a.distinct_capabilities)
        || a.operator.localeCompare(b.operator);
    });
}
