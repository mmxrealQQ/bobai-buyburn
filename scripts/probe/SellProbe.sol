// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The sell probe. It is never deployed: its runtime bytecode is placed at a
// fresh address by an eth_call state override, so the scanner can sell a token
// on the PancakeSwap V2 router from an address with no history and read back
// what came out — in ONE call, on the public node, at this block.
//
// Why this exists: the router's fee-on-transfer swap returns nothing, so the
// earlier simulation could only say "the sell went through" and the sell tax
// stayed "GoPlus's figure, unverified" whenever nobody had sold in the last
// 5,000 blocks. With a contract as the seller, the BNB received is measured
// and the tax is arithmetic: what the pair would have paid for the whole
// amount against what it paid for the part that arrived after the tax.
//
// Compile with scripts/probe/build-probe.mjs; the runtime bytecode is pasted
// into dashboard/scanner-chain.js as SELL_PROBE_CODE with the compiler version
// beside it. The source stays here so the bytes can be reproduced.
interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

interface IRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable;
}

contract SellProbe {
    receive() external payable {}

    // Sell `amount` of path[0] for BNB. Returns what the router's quote said
    // the whole amount would fetch, and what actually arrived. The balance of
    // the token must already be at this address (the caller overrides it).
    function sell(address router, uint256 amount, address[] calldata path)
        external
        returns (uint256 quoted, uint256 received)
    {
        IERC20(path[0]).approve(router, amount);
        quoted = IRouter(router).getAmountsOut(amount, path)[path.length - 1];
        uint256 before = address(this).balance;
        IRouter(router).swapExactTokensForETHSupportingFeeOnTransferTokens(amount, 0, path, address(this), block.timestamp + 600);
        received = address(this).balance - before;
    }

    // Buy path[last] with the BNB sent along. Returns the router's quote for
    // that BNB and the tokens that actually landed here.
    function buy(address router, address[] calldata path)
        external
        payable
        returns (uint256 quoted, uint256 received)
    {
        IERC20 token = IERC20(path[path.length - 1]);
        quoted = IRouter(router).getAmountsOut(msg.value, path)[path.length - 1];
        uint256 before = token.balanceOf(address(this));
        IRouter(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(0, path, address(this), block.timestamp + 600);
        received = token.balanceOf(address(this)) - before;
    }
}
