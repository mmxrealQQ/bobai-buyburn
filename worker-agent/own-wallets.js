// The wallets that are this project's own. A payment or a job from one of
// them is a test of ours, never a stranger's custom: every figure that says
// "somebody bought this" is split by this list (earnings on /stats, delivered
// jobs on the registry).
export const OWN_WALLETS = new Set([
  '0x15ba17075ef5e0736292b030e3715d9100fe3d38', // creator / dev
  '0xdefc0e900dfc83e207902cf22265ae63f94c01ce', // buyback bot
  '0xbfb4b49787ce948c1ee304f6c197a0e8b038ddb2', // NFT relayer (the test buyer)
  '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', // DeFi agent
  '0x690e950214980bc329823a2db2fd90c06bd54de4', // x402 income
  '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', // agent provider
  '0xc5a17b5295fc50badb1f9f9c09b412fe5e84f7d3', // Altana admin
  '0x5e4102520a71b2aa18a1208330d4848dea4bd105', // prize pool
  '0x5c82d2f12ee6ac09297784f94ebf9331277bdc3c', // operator
  '0x4fa13c52724bcadffefef91676cc429fa6216a48', // operator (builder #3)
]);
export const isOwnWallet = (a) => OWN_WALLETS.has(String(a || '').toLowerCase());
