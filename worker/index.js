// Cloudflare Worker — triggers BOBAI Buy & Burn bot every 10 minutes
// More reliable than GitHub Actions cron for low-activity repos

export default {
  async scheduled(event, env) {
    const res = await fetch(
      'https://api.github.com/repos/mmxrealQQ/bobai-buyburn/actions/workflows/bob-buyback.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'BOBAI-Cron-Worker',
        },
        body: JSON.stringify({ ref: 'master' }),
      }
    );
    console.log(`Triggered workflow: HTTP ${res.status}`);
  },
};
