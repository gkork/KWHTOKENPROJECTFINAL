// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./KWHToken.sol";

contract EnergyBilling {
    enum PaymentModel { Unset, Prepaid, PayAsYouGo }

    struct User {
        PaymentModel model;
        uint256 pendingConsumption;   // μόνο για Pay-As-You-Go
    }

    mapping(address => User) public users;
    KWHToken public immutable token;
    address public immutable owner;
    uint256 public pricePerKWH = 0.00015 ether; // Pay-As-You-Go

    event PriceUpdated(uint256 newPrice);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address tokenAddr) {
        token  = KWHToken(tokenAddr);
        owner  = msg.sender;
    }

    function setPricePerKWH(uint256 p) external onlyOwner {
        require(p > 0, "price 0");
        pricePerKWH = p;
        emit PriceUpdated(p);
    }

    function setModel(PaymentModel m) external {
        require(users[msg.sender].model == PaymentModel.Unset, "already set");
        users[msg.sender].model = m;
    }

    function changeModel(PaymentModel m) external {
        PaymentModel cur = users[msg.sender].model;
        require(cur != PaymentModel.Unset, "not set yet");
        require(cur != m, "no change");
        if (cur == PaymentModel.PayAsYouGo) {
            require(users[msg.sender].pendingConsumption == 0, "outstanding consumption");
        }
        users[msg.sender].model = m;
    }

    function consume(address user, uint256 kwh) external onlyOwner {
        uint256 weiAmount = kwh * 1e18;

        if (users[user].model == PaymentModel.Prepaid) {
            token.burnFrom(user, weiAmount);
        } else if (users[user].model == PaymentModel.PayAsYouGo) {
            users[user].pendingConsumption += kwh;
        } else {
            revert("user unset");
        }
    }

    function payBill() external payable {
        uint256 due = users[msg.sender].pendingConsumption * pricePerKWH;
        require(due > 0, "nothing due");
        require(msg.value >= due, "not enough ETH");
        users[msg.sender].pendingConsumption = 0;
    }

    function getModel(address u) external view returns (PaymentModel) {
        return users[u].model;
    }
}
