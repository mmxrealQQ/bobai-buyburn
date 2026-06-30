// BOBAI NFT Metadata Worker — Cloudflare Worker
// Serves OpenSea-spec JSON metadata per token: GET /meta/<id>(.json)
// Looks up tier/rarity on-chain and returns image URL + traits.

import { createPublicClient, http, parseAbi } from 'viem';
import { bsc } from 'viem/chains';

const NFT_ABI = parseAbi([
  'function tierOf(uint256) view returns (uint8)',
  'function rarityOf(uint256) view returns (uint8)',
  'function nextId() view returns (uint256)',
]);

const RPC_DATASEED = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
];

const TIER_INFO = [
  { slug: 'nice-buy',    label: 'NICE BUY',    threshold: '$100+',  emoji: '💰' },
  { slug: 'big-buy',     label: 'BIG BUY',     threshold: '$150+',  emoji: '💎' },
  { slug: 'huge-buy',    label: 'HUGE BUY',    threshold: '$250+',  emoji: '🚀' },
  { slug: 'whale-buy',   label: 'WHALE BUY',   threshold: '$500+',  emoji: '🐋' },
  { slug: 'thunder-buy', label: 'THUNDER BUY', threshold: '$1000+', emoji: '⚡' },
  { slug: 'kraken-buy',  label: 'KRAKEN BUY',  threshold: '$2500+', emoji: '🦑' },
];

const RARITY_INFO = [
  { slug: 'common',    label: 'Common',    hex: '#b0c3d9' },
  { slug: 'uncommon',  label: 'Uncommon',  hex: '#5e98d9' },
  { slug: 'rare',      label: 'Rare',      hex: '#4b69ff' },
  { slug: 'mythical',  label: 'Mythical',  hex: '#8847ff' },
  { slug: 'legendary', label: 'Legendary', hex: '#d32ce6' },
  { slug: 'ancient',   label: 'Ancient',   hex: '#eb4b4b' },
  { slug: 'immortal',  label: 'Immortal',  hex: '#b28a33' },
];

const COLLECTION_NAME = 'BOBAI Buy Drops';
const COLLECTION_DESC =
  'Auto-minted NFTs awarded for qualifying $BOBAI buys on BNB Chain. ' +
  'Every buy of $100 or more earns a NFT with a fixed buy-tier motif and ' +
  'a rarity drawn from the drop matrix. Collection capped at 1,925 NFTs.';
const EXTERNAL_URL = 'https://brainonbnb.com';

function json(body, opts = {}) {
  return new Response(JSON.stringify(body), {
    status: opts.status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Short cache so wallet/marketplace indexers (Element, Trust, MM) refresh
      // quickly after a contract metadata change. Image URL itself is long-cached
      // by the dashboard origin, so the marginal cost of a 30s JSON fetch is tiny.
      'Cache-Control': opts.cache || 'public, max-age=30, s-maxage=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// 42 card filenames live both at brainonbnb.com (primary) and in the Pinata pin
// (IPFS fallback). The /img route below proxies primary→IPFS so the public
// image URL on each NFT is independent of brainonbnb.com being reachable.
const ALLOWED_TIERS = new Set(['nice-buy','big-buy','huge-buy','whale-buy','thunder-buy','kraken-buy']);
const ALLOWED_RARS  = new Set(['common','uncommon','rare','mythical','legendary','ancient','immortal']);
const PINATA_CID = 'bafybeibc7nydc4tgk5lrccmvneyfdllnlt5hveaml6lfocj5u4ivw4xiae';

async function fetchImageWithFallback(file) {
  const primary  = `https://brainonbnb.com/nft/cards/${file}`;
  const fallback = `https://${PINATA_CID}.ipfs.dweb.link/${file}`;

  try {
    const r = await fetch(primary, {
      cf: { cacheTtl: 86400, cacheEverything: true },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      return new Response(r.body, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=14400, s-maxage=86400',
          'Access-Control-Allow-Origin': '*',
          'X-Image-Source': 'origin',
        },
      });
    }
  } catch (_e) { /* fall through to IPFS */ }

  const r = await fetch(fallback, { cf: { cacheTtl: 86400, cacheEverything: true } });
  return new Response(r.body, {
    status: r.status,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': r.ok ? 'public, max-age=14400, s-maxage=86400' : 'public, max-age=30',
      'Access-Control-Allow-Origin': '*',
      'X-Image-Source': 'ipfs',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // GET /img/<tier>-<rarity>.jpg — origin→IPFS failover proxy.
    // Wallets call this URL; if brainonbnb.com is down/lapsed/blocked, the
    // worker silently serves the same bytes from the Pinata IPFS pin.
    const mImg = path.match(/^\/img\/([a-z]+-buy)-([a-z]+)\.jpg$/i);
    if (mImg) {
      const tier = mImg[1].toLowerCase();
      const rar  = mImg[2].toLowerCase();
      if (!ALLOWED_TIERS.has(tier) || !ALLOWED_RARS.has(rar)) {
        return new Response('Not found', { status: 404 });
      }
      return fetchImageWithFallback(`${tier}-${rar}.jpg`);
    }

    // GET /meta/<id> or /meta/<id>.json
    const m = path.match(/^\/meta\/(\d+)(?:\.json)?$/);
    if (!m) {
      if (path === '/' || path === '/health') {
        return json({ name: COLLECTION_NAME, status: 'ok' });
      }
      return new Response('Not found', { status: 404 });
    }

    const tokenId = BigInt(m[1]);
    if (tokenId === 0n) {
      return json({ error: 'token id must be >= 1' }, { status: 400 });
    }

    const client = createPublicClient({ chain: bsc, transport: http(RPC_DATASEED[0]) });
    const contract = env.NFT_CONTRACT_ADDRESS;

    // Resolve tier/rarity from chain. Fail soft if token not yet minted.
    let tier, rarity, nextId;
    try {
      [tier, rarity, nextId] = await Promise.all([
        client.readContract({ address: contract, abi: NFT_ABI, functionName: 'tierOf',   args: [tokenId] }),
        client.readContract({ address: contract, abi: NFT_ABI, functionName: 'rarityOf', args: [tokenId] }),
        client.readContract({ address: contract, abi: NFT_ABI, functionName: 'nextId' }),
      ]);
    } catch (e) {
      return json({ error: 'chain read failed', detail: e.shortMessage || e.message }, { status: 502 });
    }

    if (tokenId >= nextId) {
      return json({ error: 'token not minted yet' }, { status: 404 });
    }

    const tierIdx = Number(tier);
    const rarIdx  = Number(rarity);
    if (tierIdx > 5 || rarIdx > 6) {
      return json({ error: 'bad tier or rarity from chain', tier: tierIdx, rarity: rarIdx }, { status: 500 });
    }

    const tInfo = TIER_INFO[tierIdx];
    const rInfo = RARITY_INFO[rarIdx];
    // image: points at this worker's own /img route, which transparently proxies
    // brainonbnb.com first and falls back to the Pinata IPFS pin on origin failure.
    // Keeps wallet-facing URL stable forever as long as this CF account lives —
    // domain renewal, origin outage, even a full brainonbnb.com loss are absorbed.
    const cardsBase = (env.CARDS_BASE_URL || `${url.origin}/img`).replace(/\/$/, '');

    const meta = {
      name: `${COLLECTION_NAME} #${tokenId}`,
      description:
        `${COLLECTION_DESC}\n\n` +
        `This piece: ${tInfo.emoji} ${tInfo.label} motif (${tInfo.threshold}) ` +
        `in ${rInfo.label} rarity (${rInfo.hex}).`,
      image: `${cardsBase}/${tInfo.slug}-${rInfo.slug}.jpg`,
      // `image_url` is an older alias some indexers (Bitget/DeBank-Rabby etc.)
      // read instead of `image`. Same URL — kept in sync — for max wallet reach.
      image_url: `${cardsBase}/${tInfo.slug}-${rInfo.slug}.jpg`,
      external_url: EXTERNAL_URL,
      background_color: rInfo.hex.replace('#', ''),
      attributes: [
        { trait_type: 'Buy Tier', value: tInfo.label },
        { trait_type: 'Tier Threshold', value: tInfo.threshold },
        { trait_type: 'Rarity', value: rInfo.label },
        { trait_type: 'Rarity Color', value: rInfo.hex },
        { trait_type: 'Serial', display_type: 'number', value: Number(tokenId) },
        { trait_type: 'Collection Size', display_type: 'number', value: 1925 },
      ],
    };

    return json(meta);
  },
};
