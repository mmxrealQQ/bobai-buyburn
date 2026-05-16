// BOBAI Telegram Bot — Cloudflare Worker
// Combined: Buy Alert Bot + Burn Alert Bot + Anti-Spam Guard Bot
// Runs 24/7 via cron (every minute) + Telegram Webhook

let TG_BOT_TOKEN = '';
const TG_CHAT_ID = '-1003791636543';
const BOBAI_PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const CAPTCHA_TIMEOUT = 60;

// GeckoTerminal API
const GECKO_TRADES_URL = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}/trades`;
const GECKO_POOL_URL = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}`;

// Multiple BSC RPC endpoints for burn queries
const RPC_ENDPOINTS = [
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed4.binance.org',
  'https://bsc-dataseed1.bnbchain.org',
];

// Photo file_ids (uploaded once via bot, reusable)
const PHOTO_WELCOME = 'AgACAgQAAyEGAATh_8g_AAPfadI1EORIV-4JDTPKnQmo3il3NPsAAkYNaxtDCplSMrzv51Lm4QEBAAMCAAN4AAM7BA';
const PHOTO_BIGBUY = 'AgACAgQAAyEGAATh_8g_AAPgadI1EEm5Qa4VhE6mqWf0m6PuFMYAAkcNaxtDCplSLzBgWf5z1mMBAAMCAAN4AAM7BA';
const PHOTO_BURN = 'AgACAgQAAyEGAATh_8g_AAIB0mnWDmHKwNjMTlDUC3WLJRO30ii_AAKBDGsbUeywUgNqPnsGFkssAQADAgADeAADOwQ';

// Known bot/system wallets to ignore in buy alerts
const IGNORED_WALLETS = new Set([
  '0xdefc0e900dfc83e207902cf22265ae63f94c01ce', // buyback bot
  '0x15ba17075ef5e0736292b030e3715d9100fe3d38', // dev buyback bot
]);

// ==================== TELEGRAM API ====================

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ==================== RPC HELPERS ====================

async function rpcCall(method, params) {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const data = await res.json();
      if (data.result !== undefined && data.result !== null) return data.result;
    } catch {}
  }
  return null;
}

function hexToBigInt(hex) {
  return BigInt(hex || '0x0');
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

function formatUsd(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function shortenAddress(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function priceChangeArrow(pct) {
  const n = parseFloat(pct);
  if (n > 0) return `🟢 +${n.toFixed(1)}%`;
  if (n < 0) return `🔴 ${n.toFixed(1)}%`;
  return `⚪ 0%`;
}

// ==================== GECKO TERMINAL API ====================

async function fetchPoolData() {
  try {
    const res = await fetch(GECKO_POOL_URL, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.attributes || null;
  } catch {
    return null;
  }
}

async function fetchRecentTrades() {
  try {
    const res = await fetch(`${GECKO_TRADES_URL}?_=${Date.now()}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.error('[GECKO API ERROR]', err.message || err);
    return [];
  }
}

// ==================== BURN STATS ====================

async function getBurnedTokens() {
  const balanceData = '0x70a08231' + DEAD.slice(2).padStart(64, '0');
  const burnedHex = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: balanceData }, 'latest']);
  return Number(hexToBigInt(burnedHex)) / 1e18;
}

async function getTotalSupply() {
  const totalData = '0x18160ddd';
  const totalHex = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data: totalData }, 'latest']);
  return Number(hexToBigInt(totalHex)) / 1e18;
}

async function getBurnStats() {
  try {
    const [burnedTokens, totalSupply] = await Promise.all([getBurnedTokens(), getTotalSupply()]);
    const percent = totalSupply > 0 ? (burnedTokens / totalSupply * 100).toFixed(1) : '?';
    return { burnedTokens, percent };
  } catch {
    return { burnedTokens: 0, percent: '?' };
  }
}

// ==================== BUY BOT ====================

function getBuyEmojis(usdValue) {
  // Each 🧠 = $10, no max
  const count = Math.max(Math.floor(usdValue / 10), 1);
  const bar = '🧠'.repeat(count);
  let icon;
  if (usdValue >= 2500) icon = '🦑 KRAKEN BUY!';
  else if (usdValue >= 1000) icon = '⚡ THUNDER BUY!';
  else if (usdValue >= 500) icon = '🐋 WHALE BUY!';
  else if (usdValue >= 250) icon = '🚀 HUGE BUY!';
  else if (usdValue >= 150) icon = '💎 BIG BUY!';
  else icon = '💰 NICE BUY!';
  return { bar, icon };
}

function getBurnEmojis(usdValue) {
  const count = Math.max(Math.floor(usdValue / 2), 1);
  const bar = '🔥'.repeat(count);
  let icon;
  if (usdValue >= 250) icon = '💥 SUPERNOVA BURN!';
  else if (usdValue >= 150) icon = '☄️ APOCALYPSE BURN!';
  else if (usdValue >= 50) icon = '💀 MEGA BURN!';
  else if (usdValue >= 15) icon = '🌋 BIG BURN!';
  else if (usdValue >= 5) icon = '🔥 NICE BURN!';
  else icon = '♻️ BURN';
  return { bar, icon };
}

async function postBuyAlert(trade, burnedPct) {
  try {
    const { bnbAmount, bobaiAmount, usdValue, buyer, txHash } = trade;
    const { bar, icon } = getBuyEmojis(usdValue);
    const pricePerToken = bobaiAmount > 0 ? usdValue / bobaiAmount : 0;

    const message = `${bar}
<b>${icon}</b>

🪙 <b>${formatNumber(bobaiAmount)} BOBAI</b>
💎 ${bnbAmount.toFixed(4)} BNB <b>(${formatUsd(usdValue)})</b>
💵 Price: $${pricePerToken.toFixed(8)}
👤 <a href="https://bscscan.com/address/${buyer}">${shortenAddress(buyer)}</a>

🔗 <a href="https://bscscan.com/tx/${txHash}">TX</a> · <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a> · <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>

🔥 Burned: ${burnedPct}% of supply`;

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_BIGBUY,
      caption: message,
      parse_mode: 'HTML',
    });
    return result?.ok === true;
  } catch (err) {
    console.error('[POST BUY ERROR]', err.message || err);
    return false;
  }
}

// ==================== BURN BOT ====================

async function postBurnAlert(newBurned, prevBurned, totalSupply, tokenPrice) {
  try {
    const burnedDelta = newBurned - prevBurned;
    const burnedUsd = burnedDelta * tokenPrice;
    const percent = totalSupply > 0 ? (newBurned / totalSupply * 100).toFixed(1) : '?';
    const { bar, icon } = getBurnEmojis(burnedUsd);

    const message = `${bar}
<b>${icon}</b>

🪙 <b>+${formatNumber(burnedDelta)} BOBAI</b> burned <b>(${formatUsd(burnedUsd)})</b>
📊 Total burned: <b>${formatNumber(newBurned)} BOBAI</b>
🔥 That's <b>${percent}%</b> of total supply!

💡 <i>Every trade makes BOBAI more scarce!</i>

🔗 <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${DEAD}">View Burns</a> · <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a>`;

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_BURN,
      caption: message,
      parse_mode: 'HTML',
    });
    return result?.ok === true;
  } catch (err) {
    console.error('[POST BURN ERROR]', err.message || err);
    return false;
  }
}

// ==================== GUARD BOT ====================

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { question: `${a} + ${b}`, answer: (a + b).toString() };
}

function generateButtons(correctAnswer) {
  const correct = parseInt(correctAnswer);
  const options = new Set([correct]);
  while (options.size < 4) {
    const wrong = correct + Math.floor(Math.random() * 7) - 3;
    if (wrong > 0 && wrong !== correct) options.add(wrong);
  }
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  return [shuffled.map(n => ({ text: n.toString(), callback_data: `cap_${n}` }))];
}

// ==================== CAPTCHA INDEX HELPERS ====================

async function getCaptchaIndex(env) {
  const raw = await env.KV.get('captcha_index');
  return raw ? JSON.parse(raw) : [];
}

async function addToCaptchaIndex(env, userId) {
  const index = await getCaptchaIndex(env);
  if (!index.includes(userId)) {
    index.push(userId);
    await env.KV.put('captcha_index', JSON.stringify(index));
  }
}

async function removeFromCaptchaIndex(env, userId) {
  const index = await getCaptchaIndex(env);
  const filtered = index.filter(id => id !== userId);
  await env.KV.put('captcha_index', JSON.stringify(filtered));
}

// ==================== GUARD BOT HANDLERS ====================

async function handleNewMember(msg, env) {
  const members = msg.new_chat_members || [];
  for (const member of members) {
    if (member.is_bot) continue;

    const userId = member.id;
    const name = member.first_name || 'User';
    const { question, answer } = generateCaptcha();

    await tg('restrictChatMember', {
      chat_id: TG_CHAT_ID,
      user_id: userId,
      permissions: { can_send_messages: false, can_send_media_messages: false, can_send_other_messages: false },
    });

    const result = await tg('sendPhoto', {
      chat_id: TG_CHAT_ID,
      photo: PHOTO_WELCOME,
      caption: `👋 Welcome <b>${name}</b> to BOBAI!\n\n🛡 Quick verification — solve this:\n\n🧮 <b>${question} = ?</b>\n\n⏱ You have 60 seconds`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: generateButtons(answer) },
    });

    await env.KV.put(`captcha_${userId}`, JSON.stringify({
      answer,
      messageId: result.result?.message_id,
      name,
      timestamp: Date.now(),
    }), { expirationTtl: 600 });

    await addToCaptchaIndex(env, userId);
  }
}

async function handleCallback(callback, env) {
  const userId = callback.from.id;
  const data = callback.data;
  if (!data.startsWith('cap_')) return;

  const stored = await env.KV.get(`captcha_${userId}`);
  if (!stored) {
    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: 'Expired or not for you.' });
    return;
  }

  const entry = JSON.parse(stored);
  const selected = data.replace('cap_', '');

  if (selected === entry.answer) {
    await env.KV.delete(`captcha_${userId}`);
    await removeFromCaptchaIndex(env, userId);

    await tg('restrictChatMember', {
      chat_id: TG_CHAT_ID,
      user_id: userId,
      permissions: { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true },
    });

    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: '✅ Verified! Welcome!' });

    if (entry.messageId) {
      await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
    }

    await tg('sendMessage', {
      chat_id: TG_CHAT_ID,
      text: `✅ <b>${entry.name}</b> joined the BOBAI community! Welcome! 🚀`,
      parse_mode: 'HTML',
    });
  } else {
    await env.KV.delete(`captcha_${userId}`);
    await removeFromCaptchaIndex(env, userId);
    await tg('answerCallbackQuery', { callback_query_id: callback.id, text: '❌ Wrong answer. Try joining again.' });
    await tg('banChatMember', { chat_id: TG_CHAT_ID, user_id: userId });
    await tg('unbanChatMember', { chat_id: TG_CHAT_ID, user_id: userId });
    if (entry.messageId) {
      await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
    }
  }
}

async function cleanupExpiredCaptchas(env) {
  // Uses captcha_index (KV.get = read) instead of KV.list (= write-category)
  const index = await getCaptchaIndex(env);
  const remaining = [];

  for (const userId of index) {
    const data = await env.KV.get(`captcha_${userId}`);
    if (!data) {
      // Already expired via TTL or handled — skip
      continue;
    }
    const entry = JSON.parse(data);
    if (Date.now() - entry.timestamp > CAPTCHA_TIMEOUT * 1000) {
      await env.KV.delete(`captcha_${userId}`);
      try {
        if (entry.messageId) {
          await tg('deleteMessage', { chat_id: TG_CHAT_ID, message_id: entry.messageId });
        }
        await tg('sendMessage', {
          chat_id: TG_CHAT_ID,
          text: `👋 <b>${entry.name}</b> didn't verify in time. Bye bye!`,
          parse_mode: 'HTML',
        });
        await tg('banChatMember', { chat_id: TG_CHAT_ID, user_id: parseInt(userId) });
        await tg('unbanChatMember', { chat_id: TG_CHAT_ID, user_id: parseInt(userId) });
      } catch {}
    } else {
      remaining.push(userId);
    }
  }

  // Update index to only keep active captchas
  if (remaining.length !== index.length) {
    await env.KV.put('captcha_index', JSON.stringify(remaining));
  }
}

// ==================== BOT COMMAND MENU SETUP ====================

const BOT_COMMANDS = [
  { command: 'alerts',   description: 'Buy & burn alert tiers' },
  { command: 'burn',     description: 'Burn stats & progress' },
  { command: 'buy',      description: 'How to buy BOBAI' },
  { command: 'ca',       description: 'Contract address' },
  { command: 'help',     description: 'Show all commands' },
  { command: 'price',    description: 'Live price, volume & market stats' },
  { command: 'security', description: 'Anti-scam reminder & official links' },
  { command: 'social',   description: 'All project links' },
];

const COMMANDS_VERSION = 'v3-security';

async function ensureCommandsRegistered(env) {
  const current = await env.KV.get('commands_version');
  if (current === COMMANDS_VERSION) return;
  const res = await tg('setMyCommands', { commands: BOT_COMMANDS });
  if (res?.ok) {
    await env.KV.put('commands_version', COMMANDS_VERSION);
    console.log('[COMMANDS] Registered', COMMANDS_VERSION);
  } else {
    console.error('[COMMANDS] Failed:', JSON.stringify(res));
  }
}

// ==================== CHAT COMMANDS ====================

async function handleCommand(msg) {
  const text = (msg.text || '').toLowerCase().trim().split('@')[0];
  const chatId = msg.chat.id;
  let reply = null;

  switch (text) {
    case '/buy':
    case 'buy': {
      reply = `🛒 <b>How to Buy BOBAI</b>

<b>Step 1:</b> Get BNB in your wallet
<i>MetaMask, Trust Wallet, or Binance Web3</i>

<b>Step 2:</b> Swap BNB → BOBAI
🔶 <a href="https://web3.binance.com/en/token/bsc/${BOBAI_TOKEN}">Binance Wallet</a>
🤚 <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>
🥞 <a href="https://pancakeswap.finance/swap?outputCurrency=${BOBAI_TOKEN}">PancakeSwap</a>

<b>Step 3:</b> Set slippage to 4-5%
<i>(3% tax: 1% creator, 2% burn)</i>

📋 CA: <code>${BOBAI_TOKEN}</code>`;
      break;
    }

    case '/price':
    case 'price': {
      const [pool, burn] = await Promise.all([fetchPoolData(), getBurnStats()]);
      if (!pool) {
        reply = '⚠️ Could not fetch price data. Try again in a moment!';
        break;
      }

      const price = parseFloat(pool.base_token_price_usd);
      const priceInBnb = parseFloat(pool.base_token_price_native_currency);
      const fdv = parseFloat(pool.fdv_usd);
      const liq = parseFloat(pool.reserve_in_usd);
      const vol24 = parseFloat(pool.volume_usd?.h24 || 0);
      const pct = pool.price_change_percentage || {};
      const txns = pool.transactions?.h24 || {};

      reply = `📊 <b>BOBAI Live Price</b>

💰 <b>$${price.toFixed(8)}</b>
💎 ${priceInBnb.toFixed(10)} BNB

📈 <b>Price Change</b>
1h: ${priceChangeArrow(pct.h1)}  ·  6h: ${priceChangeArrow(pct.h6)}  ·  24h: ${priceChangeArrow(pct.h24)}

📊 <b>Market Stats</b>
🏷 FDV: ${formatUsd(fdv)}
💧 Liquidity: ${formatUsd(liq)}
📦 24h Volume: ${formatUsd(vol24)}
🔄 24h Trades: ${txns.buys || 0} buys / ${txns.sells || 0} sells

🔥 Burned: ${burn.percent}% (${formatNumber(burn.burnedTokens)} BOBAI)

📈 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a> · 🦎 <a href="https://www.geckoterminal.com/bsc/pools/${BOBAI_PAIR}">GeckoTerminal</a>`;
      break;
    }

    case '/burn':
    case 'burn': {
      const burn = await getBurnStats();

      reply = `🔥 <b>BOBAI Burn Dashboard</b>

🔥 Burned: <b>${formatNumber(burn.burnedTokens)} BOBAI</b>
📊 That's <b>${burn.percent}%</b> of total supply!

⚙️ <b>How it works:</b>
♻️ 3% tax on every buy & sell
🔥 1% BOB burn + 1% BOBAI burn
💰 1% to creator (funds the bot)
👤 Contract ownership renounced

💡 <i>Every trade makes BOBAI more scarce!</i>

🔗 <a href="https://bscscan.com/token/${BOBAI_TOKEN}?a=${DEAD}">View Burns on BscScan</a>`;
      break;
    }

    case '/social':
    case 'social':
    case 'socials':
    case '/links':
    case 'links': {
      reply = `🧠 <b>BOBAI — All Links</b>

🌍 <a href="https://brainonbnb.ai">Website & Dashboard</a>

🔷 <a href="https://blockspot.io/coin/brain-on-bnb-ai/">Blockspot.io</a>
🔍 <a href="https://bscscan.com/token/${BOBAI_TOKEN}">BscScan</a>
🦎 <a href="https://www.coingecko.com/en/coins/brain-on-bnb-ai">CoinGecko</a>
🦅 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">DEX Screener</a>
🌐 <a href="https://www.dextools.io/token/bobai">DEXTools.io</a>
🦎 <a href="https://www.geckoterminal.com/bsc/pools/${BOBAI_PAIR}">GeckoTerminal</a>

🔶 <a href="https://web3.binance.com/en/token/bsc/${BOBAI_TOKEN}">Binance Wallet</a>
🤚 <a href="https://four.meme/token/${BOBAI_TOKEN}">Four.Meme</a>
🥞 <a href="https://pancakeswap.finance/swap?outputCurrency=${BOBAI_TOKEN}">PancakeSwap</a>

🐦 <a href="https://x.com/BrainOnBNB">X Official</a>
🗣 <a href="https://x.com/BrainOnBNBAI">X Community</a>

📋 CA: <code>${BOBAI_TOKEN}</code>`;
      break;
    }

    case '/contract':
    case 'contract':
    case '/ca':
    case 'ca': {
      reply = `📋 <b>BOBAI Contract</b>

<code>${BOBAI_TOKEN}</code>

<i>Tap to copy — paste in your DEX</i>

🔍 <a href="https://bscscan.com/token/${BOBAI_TOKEN}">View on BscScan</a>`;
      break;
    }

    case '/security':
    case 'security':
    case '/scam':
    case 'scam': {
      reply = `⚠️ <b>BOBAI Security Notice</b>

🚫 Admins will <b>NEVER</b> DM you first
🚫 <b>NEVER</b> share your seed phrase or private key
🚫 <b>NEVER</b> connect your wallet to unknown sites
🚫 No giveaways, no presales, no airdrops via DM

✅ <b>Official Links Only</b>
🌍 brainonbnb.ai
💬 t.me/bobai_official
🐦 x.com/BrainOnBNB

📋 <b>Official CA:</b>
<code>${BOBAI_TOKEN}</code>

<i>Anything else = scam. Stay safe.</i>`;
      break;
    }

    case '/alerts':
    case 'alerts': {
      reply = `🔔 <b>BOBAI Alert Tiers</b>

🧠 <b>Buy Alert Tiers</b>
💰 $100+ → NICE BUY!
💎 $150+ → BIG BUY!
🚀 $250+ → HUGE BUY!
🐋 $500+ → WHALE BUY!
⚡ $1000+ → THUNDER BUY!
🦑 $2500+ → KRAKEN BUY!

🔥 <b>Burn Alert Tiers</b>
♻️ &lt; $5 → BURN
🔥 $5+ → NICE BURN!
🌋 $15+ → BIG BURN!
💀 $50+ → MEGA BURN!
☄️ $150+ → APOCALYPSE BURN!
💥 $250+ → SUPERNOVA BURN!

💡 <i>Buys under $100 are not alerted.</i>`;
      break;
    }

    case '/help':
    case 'help':
    case '/start': {
      reply = `🤖 <b>Welcome to the BOBAI Bot!</b>

Here's what I can do:

🔔 /alerts — Buy & burn alert tiers
🔥 /burn — Burn stats & progress
🛒 /buy — How to buy BOBAI
📋 /ca — Contract address
📊 /price — Live price, volume & market stats
⚠️ /security — Anti-scam reminder & official links
🧠 /social — All project links

💡 <i>I also post alerts for buys & burns!</i>

🌍 <a href="https://brainonbnb.ai">Website</a> · 📈 <a href="https://dexscreener.com/bsc/${BOBAI_TOKEN}">Chart</a>`;
      break;
    }
  }

  if (reply) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: reply,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}

// ==================== WORKER ENTRY ====================

export default {
  // Webhook handler (Telegram sends updates here)
  async fetch(request, env) {
    TG_BOT_TOKEN = env.BOT_TOKEN;
    if (request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.message?.new_chat_members) {
          await handleNewMember(update.message, env);
        }

        if (update.message?.text) {
          await handleCommand(update.message);
        }

        if (update.callback_query) {
          await handleCallback(update.callback_query, env);
        }
      } catch (err) {
        console.error('[WEBHOOK ERROR]', err.message || err);
      }
    }

    return new Response('OK');
  },

  // Cron handler (every 1 min)
  async scheduled(event, env) {
    TG_BOT_TOKEN = env.BOT_TOKEN;

    // === ENSURE BOT COMMANDS REGISTERED (idempotent, KV-flagged) ===
    await ensureCommandsRegistered(env);

    // === BUY ALERTS ===
    // Read posted txs for deduplication (1 KV read per cron)
    const postedRaw = await env.KV.get('posted_txs');
    const postedSet = new Set(postedRaw ? JSON.parse(postedRaw) : []);
    const prevSize = postedSet.size;

    // Fetch recent trades from GeckoTerminal API
    try {
      const trades = await fetchRecentTrades();
      let burnedPct = null; // lazy-load only when needed

      const now = Date.now();

      for (const trade of trades) {
        const attr = trade.attributes;
        if (attr.kind !== 'buy') continue;

        // Only process trades from the last 5 minutes
        const tradeTime = new Date(attr.block_timestamp).getTime();
        if (now - tradeTime > 5 * 60 * 1000) continue;

        const txHash = attr.tx_hash;
        if (postedSet.has(txHash)) continue;

        const usdValue = parseFloat(attr.volume_in_usd);
        if (usdValue < 100) continue;

        const buyer = attr.tx_from_address.toLowerCase();
        if (IGNORED_WALLETS.has(buyer)) continue;

        // Lazy-load burn percentage on first qualifying buy
        if (burnedPct === null) {
          const burn = await getBurnStats();
          burnedPct = burn.percent;
        }

        const bnbAmount = parseFloat(attr.from_token_amount);
        const bobaiAmount = parseFloat(attr.to_token_amount);

        const sent = await postBuyAlert({
          bnbAmount,
          bobaiAmount,
          usdValue,
          buyer: attr.tx_from_address,
          txHash,
        }, burnedPct);

        if (sent) postedSet.add(txHash);
      }
    } catch (err) {
      console.error('[BUY BOT ERROR]', err.message || err);
    }

    // Only write KV if we actually posted new buys
    if (postedSet.size > prevSize) {
      const postedArr = [...postedSet].slice(-50);
      await env.KV.put('posted_txs', JSON.stringify(postedArr));
    }

    // === BURN ALERTS ===
    // Check if burned amount increased since last check (1 KV read + RPC calls)
    try {
      const [currentBurned, totalSupply, lastBurnedRaw, poolData] = await Promise.all([
        getBurnedTokens(),
        getTotalSupply(),
        env.KV.get('last_burned'),
        fetchPoolData(),
      ]);

      const lastBurned = lastBurnedRaw ? parseFloat(lastBurnedRaw) : 0;
      const tokenPrice = poolData ? parseFloat(poolData.base_token_price_usd) : 0;

      // Only alert if burn increased by at least 1000 BOBAI (avoid spam from rounding)
      if (currentBurned > lastBurned + 1000) {
        const sent = await postBurnAlert(currentBurned, lastBurned, totalSupply, tokenPrice);
        if (sent) {
          await env.KV.put('last_burned', currentBurned.toString());
        }
      }
    } catch (err) {
      console.error('[BURN BOT ERROR]', err.message || err);
    }

    // === CAPTCHA CLEANUP (every 2 min) ===
    if (new Date().getMinutes() % 2 === 0) {
      await cleanupExpiredCaptchas(env);
    }
  },
};
