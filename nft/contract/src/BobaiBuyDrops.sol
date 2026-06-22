// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title BOBAI Buy Drops
/// @notice Auto-minted NFTs awarded for qualifying $BOBAI buys on BNB Chain.
///         Each NFT carries a buy-tier (motif, fixed by purchase USD value) and
///         a rarity (color, rolled at mint). Per-tier hard caps sum to 1925 total.
contract BobaiBuyDrops is ERC721, Ownable {
    using Strings for uint256;

    // tier:    0=NICE  1=BIG  2=HUGE  3=WHALE  4=THUNDER  5=KRAKEN
    // rarity:  0=Common 1=Uncommon 2=Rare 3=Mythical 4=Legendary 5=Ancient 6=Immortal

    address public minter;
    string  private _base;
    uint256 public nextId = 1;

    mapping(uint256 => uint8) public tierOf;
    mapping(uint256 => uint8) public rarityOf;
    mapping(uint8 => uint256) public minted; // tier => count
    mapping(uint8 => uint256) public cap;    // tier => max

    event BuyDrop(address indexed to, uint256 indexed tokenId, uint8 tier, uint8 rarity);
    event MinterUpdated(address indexed minter);

    constructor(string memory baseURI_)
        ERC721("BOBAI Buy Drops", "BOBAIBUY")
        Ownable(msg.sender)
    {
        _base = baseURI_;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "not minter");
        _;
    }

    // ---------- admin ----------

    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterUpdated(m);
    }

    function setBaseURI(string calldata u) external onlyOwner {
        _base = u;
    }

    function setCap(uint8 tier, uint256 max_) external onlyOwner {
        require(tier <= 5, "bad tier");
        cap[tier] = max_;
    }

    function setCapBatch(uint8[] calldata tiers, uint256[] calldata maxes) external onlyOwner {
        require(tiers.length == maxes.length, "len mismatch");
        for (uint256 i; i < tiers.length; ++i) {
            require(tiers[i] <= 5, "bad tier");
            cap[tiers[i]] = maxes[i];
        }
    }

    // ---------- mint ----------

    function mintTo(address to, uint8 tier, uint8 rarity)
        external
        onlyMinter
        returns (uint256 id)
    {
        require(tier <= 5, "bad tier");
        require(rarity <= 6, "bad rarity");
        require(minted[tier] < cap[tier], "tier sold out");
        id = nextId++;
        minted[tier] += 1;
        tierOf[id] = tier;
        rarityOf[id] = rarity;
        // _mint (not _safeMint): contract wallets without onERC721Received would
        // revert _safeMint and the buyer would lose their drop.
        _mint(to, id);
        emit BuyDrop(to, id, tier, rarity);
    }

    // ---------- views ----------

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string(abi.encodePacked(_base, id.toString(), ".json"));
    }

    /// Returns minted + cap for all 6 tiers in one call (cheap dashboard read).
    function getTiers()
        external
        view
        returns (uint256[6] memory mintedArr, uint256[6] memory capArr)
    {
        for (uint8 t = 0; t < 6; ++t) {
            mintedArr[t] = minted[t];
            capArr[t] = cap[t];
        }
    }
}
