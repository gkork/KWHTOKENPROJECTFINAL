// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./KWHToken.sol";
import { Ownable }        from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 }      from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * P2PMarketplace για KWH (18 decimals = 1 token -> 1 kWh).
 *
 * - Ο πωλητής κάνει list: μεταφέρει (escrow) τα KWH στο συμβόλαιο.
 * - Ο αγοραστής πληρώνει ETH = amount * price / 1e18.
 * - Προμήθεια πλατφόρμας (feeBps) σε ETH (προεπιλογή 0).
 * - Partial fills, cancel, expiry.
 * - Προαιρετικό Buyback από το “δίκτυο”: ο owner ορίζει τιμή και
 *   καταθέτει ETH ρευστότητα. Οι χρήστες πωλούν κατευθείαν στο συμβόλαιο
 *   και τα KWH καίγονται (burn) ώστε να μειώνεται η προσφορά.
 */
contract P2PMarketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for KWHToken;

    struct Listing {
        address seller;
        uint256 remaining;         // ποσότητα σε token units (18d)
        uint256 priceWeiPerKwh;    // wei per kWh (per token with 18d)
        uint64  expiry;            // unix timestamp (0 = no expiry)
        bool    active;
    }

    KWHToken public immutable token;

    // orderbook
    uint256 public nextId = 1;
    mapping(uint256 => Listing) public listings;

    // platform fee σε basis points (π.χ. 50 = 0.5%). default 0.
    uint16  public feeBps;
    address public feeRecipient;

    // buyback (δίκτυο) σε wei/kWh (0 = απενεργό)
    uint256 public buybackPriceWei;

    event Listed(uint256 indexed id, address indexed seller, uint256 amount, uint256 priceWeiPerKwh, uint64 expiry);
    event Purchased(uint256 indexed id, address indexed buyer, uint256 amount, uint256 totalCost, uint256 fee);
    event Cancelled(uint256 indexed id, uint256 returnedAmount);
    event FeeUpdated(uint16 feeBps, address feeRecipient);
    event BuybackUpdated(uint256 priceWei);
    event SoldToNetwork(address indexed seller, uint256 amount, uint256 proceeds);

    constructor(address tokenAddr, address initialOwner) Ownable(initialOwner) {
        require(tokenAddr != address(0), "token=0");
        token = KWHToken(tokenAddr);
        feeRecipient = initialOwner;
    }

    // ========= Helpers =========

    function quoteCost(uint256 amount, uint256 priceWeiPerKwh) public pure returns (uint256) {
        // amount has 18 decimals (token units)
        // priceWeiPerKwh is wei/kWh (per 1 token)
        return amount * priceWeiPerKwh / 1e18;
    }

    // ========= Owner controls =========

    function setFee(uint16 _feeBps, address _recipient) external onlyOwner {
        require(_recipient != address(0), "recipient=0");
        require(_feeBps <= 2_000, "fee too high"); // <=20% safeguard
        feeBps = _feeBps;
        feeRecipient = _recipient;
        emit FeeUpdated(_feeBps, _recipient);
    }

    function setBuybackPrice(uint256 weiPerKwh) external onlyOwner {
        buybackPriceWei = weiPerKwh; // 0 disables buyback
        emit BuybackUpdated(weiPerKwh);
    }

    // allow owner to fund or withdraw ETH liquidity for buyback
    receive() external payable {}
    function withdrawETH(address payable to, uint256 amount) external onlyOwner {
        if (amount == 0) amount = address(this).balance;
        to.transfer(amount);
    }

    // ========= Listing / Trading =========

    /**
     * Δημιουργία αγγελίας.
     * - Ο πωλητής πρέπει να έχει κάνει approve στο marketplace για `amount`.
     * - Τα tokens escrowάρονται εδώ.
     */
    function list(uint256 amount, uint256 priceWeiPerKwh, uint64 expiry)
        external
        nonReentrant
        returns (uint256 id)
    {
        require(amount > 0, "amount=0");
        require(priceWeiPerKwh > 0, "price=0");

        // escrow tokens
        token.safeTransferFrom(msg.sender, address(this), amount);

        id = nextId++;
        listings[id] = Listing({
            seller: msg.sender,
            remaining: amount,
            priceWeiPerKwh: priceWeiPerKwh,
            expiry: expiry,
            active: true
        });

        emit Listed(id, msg.sender, amount, priceWeiPerKwh, expiry);
    }

    /**
     * Αγορά μέρους ή όλου του listing.
     * - Στέλνεις ακριβώς msg.value = cost.
     */
    function purchase(uint256 id, uint256 amount)
        external
        payable
        nonReentrant
    {
        Listing storage l = listings[id];
        require(l.active, "inactive");
        require(amount > 0 && amount <= l.remaining, "bad amount");
        if (l.expiry != 0) require(block.timestamp <= l.expiry, "expired");

        uint256 cost = quoteCost(amount, l.priceWeiPerKwh);
        require(msg.value >= cost, "insufficient ETH");

        // υπολογισμός fee
        uint256 fee = (feeBps == 0) ? 0 : cost * feeBps / 10_000;
        uint256 toSeller = cost - fee;

        // ενημέρωση υπολοίπου listing
        l.remaining -= amount;
        if (l.remaining == 0) l.active = false;

        // μεταφορά token στον αγοραστή
        token.safeTransfer(msg.sender, amount);

        // πληρωμές
        if (fee > 0) payable(feeRecipient).transfer(fee);
        payable(l.seller).transfer(toSeller);

        // επιστροφή τυχόν extra ETH
        if (msg.value > cost) payable(msg.sender).transfer(msg.value - cost);

        emit Purchased(id, msg.sender, amount, cost, fee);
    }

    /**
     * Ακύρωση listing (μόνο ο seller). Επιστρέφονται τα υπόλοιπα KWH.
     */
    function cancel(uint256 id) external nonReentrant {
        Listing storage l = listings[id];
        require(l.active, "inactive");
        require(l.seller == msg.sender, "not seller");

        l.active = false;
        uint256 leftover = l.remaining;
        l.remaining = 0;

        if (leftover > 0) token.safeTransfer(msg.sender, leftover);
        emit Cancelled(id, leftover);
    }

    // ========= Sell back to the network (buyback) =========

    /**
     * Πώληση kWh πίσω στο "δίκτυο" (στο συμβόλαιο) στην τιμή buybackPriceWei.
     * Το συμβόλαιο πρέπει να έχει αρκετό ETH. Τα KWH καίγονται.
     * Απαιτείται approve(token -> marketplace, amount).
     */
    function sellToNetwork(uint256 amount) external nonReentrant {
        require(buybackPriceWei > 0, "buyback off");
        require(amount > 0, "amount=0");

        uint256 proceeds = quoteCost(amount, buybackPriceWei);
        require(address(this).balance >= proceeds, "no liquidity");

        // πάρτο από τον seller
        token.safeTransferFrom(msg.sender, address(this), amount);

        // κάψε τα tokens που έχει πλέον το συμβόλαιο (μείωση προσφοράς)
        token.burn(amount);

        // πληρωμή (χωρίς fee για απλότητα — αν θες, βάλε ίδιο fee μηχανισμό εδώ)
        payable(msg.sender).transfer(proceeds);

        emit SoldToNetwork(msg.sender, amount, proceeds);
    }
}
