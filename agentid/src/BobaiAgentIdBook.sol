// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev SPACE ID Agent ID (ERC-721, non-transferable, one per Binance user).
interface IAgentId {
    function balanceOf(address owner) external view returns (uint256);
}

/// @dev ERC-8004 Identity Registry on BNB Chain (agent ids are ERC-721 tokens).
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title BOBAI Agent ID Book
/// @notice Two things only an Agent ID holder can do here:
///         1. sign the book: one place per holder, numbered in the order people
///            arrive, with a short note the holder can change later;
///         2. vouch for an AI agent registered on ERC-8004: one vouch per holder
///            per agent, withdrawable. Because an Agent ID is one per Binance user
///            and cannot be transferred, a vouch count is a count of distinct
///            people, not of wallets.
/// @dev    No owner, no admin, no upgrade, no pause, no fees. The contract holds
///         no tokens, asks for no approvals and cannot receive BNB (there is no
///         receive or fallback function, and nothing is payable). Every write
///         costs the caller gas and nothing else. Both registry addresses are
///         constants, so nobody can repoint them.
contract BobaiAgentIdBook {
    IAgentId public constant AGENT_ID = IAgentId(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);
    IIdentityRegistry public constant ERC8004 = IIdentityRegistry(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);

    uint256 public constant MAX_NOTE_BYTES = 140;

    struct Entry {
        uint64 place;      // 1-based; 0 = has not signed
        uint64 signedAt;   // block timestamp of the first signature
        uint64 updatedAt;  // block timestamp of the last note change
        string note;
    }

    mapping(address => Entry) private _entries;
    address[] private _signers;

    mapping(uint256 => mapping(address => bool)) public vouched; // agentId => holder => vouched
    mapping(uint256 => uint256) public vouchCount;               // agentId => distinct holders vouching now
    mapping(address => uint256) public vouchesGiven;             // holder => agents vouched for now

    event Signed(address indexed holder, uint256 indexed place, string note);
    event NoteChanged(address indexed holder, uint256 indexed place, string note);
    event Vouched(address indexed holder, uint256 indexed agentId, bool on, uint256 count);

    error NoAgentId();
    error NoteTooLong();
    error UnknownAgent();
    error OwnAgent();
    error Unchanged();

    modifier onlyAgentIdHolder() {
        if (AGENT_ID.balanceOf(msg.sender) == 0) revert NoAgentId();
        _;
    }

    // ---------------------------------------------------------------- writes

    /// @notice Sign the book (first call) or change your note (later calls).
    function sign(string calldata note) external onlyAgentIdHolder {
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();
        Entry storage e = _entries[msg.sender];
        uint64 nowTs = uint64(block.timestamp);
        if (e.place == 0) {
            _signers.push(msg.sender);
            e.place = uint64(_signers.length);
            e.signedAt = nowTs;
            e.updatedAt = nowTs;
            e.note = note;
            emit Signed(msg.sender, e.place, note);
        } else {
            if (keccak256(bytes(e.note)) == keccak256(bytes(note))) revert Unchanged();
            e.updatedAt = nowTs;
            e.note = note;
            emit NoteChanged(msg.sender, e.place, note);
        }
    }

    /// @notice Vouch for (on = true) or withdraw your vouch from (on = false)
    ///         an ERC-8004 agent. You cannot vouch for an agent you own.
    function vouch(uint256 agentId, bool on) external onlyAgentIdHolder {
        address agentOwner;
        try ERC8004.ownerOf(agentId) returns (address o) {
            agentOwner = o;
        } catch {
            revert UnknownAgent();
        }
        if (agentOwner == address(0)) revert UnknownAgent();
        if (on && agentOwner == msg.sender) revert OwnAgent();
        if (vouched[agentId][msg.sender] == on) revert Unchanged();

        vouched[agentId][msg.sender] = on;
        if (on) {
            vouchCount[agentId] += 1;
            vouchesGiven[msg.sender] += 1;
        } else {
            vouchCount[agentId] -= 1;
            vouchesGiven[msg.sender] -= 1;
        }
        emit Vouched(msg.sender, agentId, on, vouchCount[agentId]);
    }

    // ----------------------------------------------------------------- reads

    function hasAgentId(address who) external view returns (bool) {
        return AGENT_ID.balanceOf(who) > 0;
    }

    function signerCount() external view returns (uint256) {
        return _signers.length;
    }

    function entryOf(address holder)
        external
        view
        returns (uint256 place, uint256 signedAt, uint256 updatedAt, string memory note)
    {
        Entry storage e = _entries[holder];
        return (e.place, e.signedAt, e.updatedAt, e.note);
    }

    /// @notice Signers in arrival order, `count` of them starting at index `start` (0-based).
    function signers(uint256 start, uint256 count) external view returns (address[] memory out) {
        uint256 n = _signers.length;
        if (start >= n) return new address[](0);
        uint256 end = start + count > n ? n : start + count;
        out = new address[](end - start);
        for (uint256 i = start; i < end; i++) out[i - start] = _signers[i];
    }
}
