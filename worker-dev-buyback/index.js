// Cloudflare Worker — triggers Dev Buyback bot every 10 hours
// Dispatches GitHub Actions workflow for BOB + BOBAI buying

export default {
  async scheduled(event, env) {
    const res = await fetch(
      'https://api.github.com/repos/mmxrealQQ/bobai-buyburn/actions/workflows/dev-buyback.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Dev-Buyback-Cron-Worker',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    console.log(`Triggered dev-buyback workflow: HTTP ${res.status}`);
  },
};
