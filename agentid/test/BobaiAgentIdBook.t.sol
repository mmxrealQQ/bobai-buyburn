// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BobaiAgentIdBook, IIdentityRegistry} from "../src/BobaiAgentIdBook.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
    function deal(address, uint256) external;
}

/// Fork test against BNB Chain mainnet: forge test --fork-url <rpc>
contract BobaiAgentIdBookTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    // holds 1 Agent ID on mainnet (operator's Agentic Wallet "brainonbnb.ai")
    address constant HOLDER = 0xcCCf2F2198e229027f6F61379a36E82D8F45958c;
    // holds no Agent ID
    address constant STRANGER = 0x000000000000000000000000000000000000dEaD;

    BobaiAgentIdBook book;

    function setUp() public {
        book = new BobaiAgentIdBook();
    }

    function _assert(bool ok, string memory why) internal pure {
        require(ok, why);
    }

    function test_holderDetected() public view {
        _assert(book.hasAgentId(HOLDER), "holder not detected");
        _assert(!book.hasAgentId(STRANGER), "stranger detected");
    }

    function test_strangerCannotSign() public {
        vm.prank(STRANGER);
        vm.expectRevert(BobaiAgentIdBook.NoAgentId.selector);
        book.sign("hi");
    }

    function test_strangerCannotVouch() public {
        vm.prank(STRANGER);
        vm.expectRevert(BobaiAgentIdBook.NoAgentId.selector);
        book.vouch(49467, true);
    }

    function test_signThenChangeNote() public {
        vm.warp(1_800_000_000);
        vm.prank(HOLDER);
        book.sign("first");
        (uint256 place, uint256 signedAt,, string memory note) = book.entryOf(HOLDER);
        _assert(place == 1, "place");
        _assert(signedAt == 1_800_000_000, "signedAt");
        _assert(keccak256(bytes(note)) == keccak256("first"), "note");
        _assert(book.signerCount() == 1, "count");

        vm.warp(1_800_000_100);
        vm.prank(HOLDER);
        book.sign("second");
        uint256 updatedAt;
        (place, signedAt, updatedAt, note) = book.entryOf(HOLDER);
        _assert(place == 1 && signedAt == 1_800_000_000 && updatedAt == 1_800_000_100, "update keeps place");
        _assert(keccak256(bytes(note)) == keccak256("second"), "note 2");
        _assert(book.signerCount() == 1, "no second place");

        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.Unchanged.selector);
        book.sign("second");

        address[] memory s = book.signers(0, 10);
        _assert(s.length == 1 && s[0] == HOLDER, "signers page");
        _assert(book.signers(5, 10).length == 0, "empty page");
    }

    function test_noteTooLong() public {
        bytes memory b = new bytes(141);
        for (uint256 i; i < 141; i++) b[i] = "a";
        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.NoteTooLong.selector);
        book.sign(string(b));
        bytes memory ok = new bytes(140);
        for (uint256 i; i < 140; i++) ok[i] = "a";
        vm.prank(HOLDER);
        book.sign(string(ok));
    }

    function _foreignAgent() internal view returns (uint256) {
        // first low id that exists and is not owned by HOLDER
        IIdentityRegistry r = book.ERC8004();
        for (uint256 id = 1; id < 50; id++) {
            try r.ownerOf(id) returns (address o) {
                if (o != address(0) && o != HOLDER) return id;
            } catch {}
        }
        revert("no foreign agent found");
    }

    function test_vouchAndWithdraw() public {
        uint256 id = _foreignAgent();
        vm.prank(HOLDER);
        book.vouch(id, true);
        _assert(book.vouchCount(id) == 1 && book.vouched(id, HOLDER) && book.vouchesGiven(HOLDER) == 1, "vouch on");

        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.Unchanged.selector);
        book.vouch(id, true);

        vm.prank(HOLDER);
        book.vouch(id, false);
        _assert(book.vouchCount(id) == 0 && !book.vouched(id, HOLDER) && book.vouchesGiven(HOLDER) == 0, "vouch off");

        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.Unchanged.selector);
        book.vouch(id, false);
    }

    function test_unknownAgent() public {
        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.UnknownAgent.selector);
        book.vouch(type(uint256).max, true);
    }

    function test_ownAgentRejected() public {
        // HOLDER owns ERC-8004 agent #421197 (setAgentURI sent from it on 25.11.)
        _assert(book.ERC8004().ownerOf(421197) == HOLDER, "fixture: 421197 owner");
        vm.prank(HOLDER);
        vm.expectRevert(BobaiAgentIdBook.OwnAgent.selector);
        book.vouch(421197, true);
    }

    function test_rejectsBnb() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(book).call{value: 1}("");
        _assert(!ok, "accepted BNB");
        _assert(address(book).balance == 0, "balance");
    }
}
