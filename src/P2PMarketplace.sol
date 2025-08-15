// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./KWHToken.sol";

contract P2PMarketplace {
    struct Offer {
        address seller;
        uint256 amount;
        uint256 pricePerToken; // wei
        bool    active;
    }

    KWHToken public immutable token;
    Offer[]  public offers;

    constructor(address tokenAddr) {
        token = KWHToken(tokenAddr);
    }

    function createOffer(uint256 amount, uint256 pricePerToken) external {
        require(token.balanceOf(msg.sender) >= amount, "insufficient balance");
        token.transferFrom(msg.sender, address(this), amount);

        offers.push(
            Offer({
                seller: msg.sender,
                amount: amount,
                pricePerToken: pricePerToken,
                active: true
            })
        );
    }

    function buy(uint256 id, uint256 qty) external payable {
        Offer storage off = offers[id];
        require(off.active, "inactive");
        require(qty <= off.amount, "qty too big");

        uint256 cost = qty * off.pricePerToken;
        require(msg.value >= cost, "not enough ETH");

        token.transfer(msg.sender, qty);
        payable(off.seller).transfer(cost);

        off.amount -= qty;
        if (off.amount == 0) off.active = false;
    }

    function getOffers() external view returns (Offer[] memory) {
        return offers;
    }
}
