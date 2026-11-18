// bobai-xmas: the community Xmas terminal's own worker (2026-11-17). Everything is in xmas.js; this worker holds no
// key, no wallet and no binding to anything else of the project — on purpose (operator: "clean and hack-free").
import { handleXmas } from './xmas.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '').replace(/^\/xmas(?=\/|$)/, '') || '/';
    if (path === '/') return new Response(JSON.stringify({ name: 'BOBAI Xmas terminal workshop', how: 'npx bobai-xmas', themes: url.origin + '/themes' }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    try { return await handleXmas(request, env, url, path); }
    catch (e) { return new Response(JSON.stringify({ error: 'something broke on our side; nothing was changed' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
  },
};
