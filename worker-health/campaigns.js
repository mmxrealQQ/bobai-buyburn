// THE CAMPAIGN WATCH (2026-11-27, operator: "du musst jeweils immer wissen wenn binance.com oder bnbchain.org solche
// aktionen hat. wir muessen immer present sein"). The Agent ID Hackathon started on 18.11. and reached us on 27.11.;
// nine days lost. Every hour (the light cron) this reads Binance's announcement lists (Latest Activities, Latest News)
// and BNB Chain's hackathon and blog pages, keeps what is about builders, agents, AI, hackathons, grants and campaigns,
// and tells the operator privately on Telegram about anything not seen before. Read-only, no key, nothing posted publicly.
export const CAMPAIGN_SEEN = 'health:campaigns-seen';
export const RELEVANT = /hackathon|\bhack\b|\bagents?\b|agentic|\bai\b|builder|developer|\bdapps?\b|grant|incubat|accelerat|\bmvb\b|bounty|\bbuild\b|bnb chain|meme coin|memecoin|four\.meme|launchpad|\bx402\b|erc-?8004/i;
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'accept-language': 'en' };
const BINANCE_CATALOGS = [[93, 'Binance · Latest Activities'], [49, 'Binance · Latest News']];

export async function readSources(doFetch = fetch) {
  const items = [], errors = [];
  for (const [cat, label] of BINANCE_CATALOGS) {
    try {
      const j = await doFetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${cat}&pageNo=1&pageSize=50`, { headers: UA }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      for (const a of j?.data?.catalogs?.[0]?.articles || []) items.push({ id: 'bn:' + a.code, source: label, title: a.title, url: `https://www.binance.com/en/support/announcement/detail/${a.code}`, at: a.releaseDate ? new Date(a.releaseDate).toISOString().slice(0, 10) : '' });
    } catch (e) { errors.push(`${label}: ${e && e.message || e}`); }
  }
  // BNB Chain's pages answer a Cloudflare worker with a challenge; its sitemaps do not (2026-11-27)
  // (the hackathon pages are in no sitemap; BNB Chain announces every hackathon on its blog, so the blog is the source)
  for (const [map, label, re, always] of [['https://www.bnbchain.org/en/blog/sitemap.xml', 'BNB Chain · Blog', /<loc>(https:\/\/www\.bnbchain\.org\/en\/blog\/[a-z0-9-]+)\/?<\/loc>/g, false]]) {
    try {
      const xml = await doFetch(map, { headers: UA }).then((r) => r.text());
      const urls = [...new Set([...xml.matchAll(re)].map((m) => m[1]))];
      if (!urls.length) { errors.push(`${label}: sitemap read, no links in it (blocked or changed)`); continue; }
      for (const u of urls) { const s = u.split('/').pop(); items.push({ id: 'bnb:' + u.replace('https://www.bnbchain.org', ''), source: label, title: s.replace(/-/g, ' '), url: u, at: '', always }); }
    } catch (e) { errors.push(`${label}: ${e && e.message || e}`); }
  }
  return { items, errors };
}

// which items are new and worth telling; the first run only learns what is there (no flood of old posts)
export function pickNew(items, seen) {
  const known = new Set(seen || []);
  const fresh = items.filter((i) => !known.has(i.id));
  // a source never read before (BNB Chain refuses Cloudflare today) is learned silently the first time it answers
  const srcOf = (id) => (id.startsWith('bnb:') ? id.split('/').slice(0, 3).join('/') : id.split(':')[0]);
  const knownSrc = new Set([...known].map(srcOf));
  const tell = seen ? fresh.filter((i) => knownSrc.has(srcOf(i.id)) && (i.always || RELEVANT.test(i.title))) : [];
  return { fresh, tell, seenNext: [...new Set([...(seen || []), ...items.map((i) => i.id)])].slice(-3000) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const renderCampaigns = (tell) => `🆕 <b>New at Binance / BNB Chain</b> (${tell.length})\n` + tell.slice(0, 12).map((i) => `• ${esc(i.source)}${i.at ? ' · ' + i.at : ''}\n<a href="${i.url}">${esc(i.title)}</a>`).join('\n') + (tell.length > 12 ? `\n… and ${tell.length - 12} more` : '') + '\nCheck: deadline, what we already have, how BOBAI can be present.';

export async function campaignWatch(env, { send, notify = true, doFetch = fetch } = {}) {
  const { items, errors } = await readSources(doFetch);
  if (!items.length) return { ok: false, errors };
  const seen = JSON.parse((await env.AGENT.get(CAMPAIGN_SEEN)) || 'null');
  const { tell, seenNext, fresh } = pickNew(items, seen);
  let sent = null;
  if (tell.length && notify) sent = await send(renderCampaigns(tell));
  // remember only once told (or nothing to tell), so a failed message is tried again next hour
  if (notify && (!tell.length || sent)) await env.AGENT.put(CAMPAIGN_SEEN, JSON.stringify(seenNext));
  return { ok: true, read: items.length, fresh: fresh.length, tell: tell.map((i) => i.title), sent, first_run: !seen, errors };
}
