// The Binance Web3 API signature, once.
//
// Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body)), where the
// signed requestPath carries the /build base-path prefix and the raw query
// string exactly as sent. The docs call omitting the prefix the number one
// cause of "40102 Invalid signature", so the prefix lives here and both the
// URL and the signature are built from the same string.
//
// Two things learned on 2026-09-02 that the docs do not say:
//   - curl and plain fetch get an empty HTTP 202 from web3.binance.com. That is
//     a WAF answering a non-browser client, not a dead API: the same request
//     with a browser user agent gets the real response. So one is sent.
//   - Error 40001 names the missing parameter, and the names are not the ones
//     the signing examples use: token search wants `chains` and `search`, the
//     aggregator quote wants `binanceChainId`, `fromTokenAddress`,
//     `toTokenAddress` and `amount` (raw integer string).
//
// Read-only by construction: this file cannot sign a transaction, only a
// request. It runs from a machine, never from a worker that holds money.
import { createHmac } from 'node:crypto';

export const HOST = 'https://web3.binance.com';
export const PREFIX = '/build';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export function sign({ secret, timestamp, method, requestPath, body = '' }) {
  const preHash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return { preHash, signature: createHmac('sha256', secret).update(preHash, 'utf8').digest('base64') };
}

export function headersFor({ apiKey, secret, method, path, body = '' }) {
  const requestPath = path.startsWith(PREFIX) ? path : PREFIX + path;
  const timestamp = new Date().toISOString();
  const { signature } = sign({ secret, timestamp, method, requestPath, body });
  return {
    url: HOST + requestPath,
    headers: {
      'X-OC-APIKEY': apiKey,
      'X-OC-TIMESTAMP': timestamp,
      'X-OC-SIGN': signature,
      'Content-Type': 'application/json',
      'user-agent': UA,
      accept: 'application/json',
    },
  };
}

export function credentials(env = process.env) {
  const apiKey = env.BINANCE_WEB3_API_KEY, secret = env.BINANCE_WEB3_API_SECRET;
  return apiKey && secret ? { apiKey, secret } : null;
}

// One signed call, parsed. Throws with the API's own message on a non-zero
// code so a caller never mistakes {"code":40001} for data.
export async function callWeb3({ apiKey, secret, method = 'GET', path, body = null, timeoutMs = 20000 }) {
  const raw = body == null ? '' : JSON.stringify(body);
  const { url, headers } = headersFor({ apiKey, secret, method, path, body: raw });
  const r = await fetch(url, { method, headers, body: raw || undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!text) throw new Error(`empty HTTP ${r.status} from ${path} — the WAF sink, not an answer`);
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`); }
  if (j.code !== 0 && j.code !== '0') throw new Error(`${j.code}: ${j.msg || j.errorData || 'error'}`);
  return j.data;
}
