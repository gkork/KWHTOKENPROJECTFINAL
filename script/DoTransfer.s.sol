// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/KWHToken.sol";

contract DoTransfer is Script {
    // Βάλε εδώ τη διεύθυνση του KWHToken
    address constant TOKEN = 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9;



    // Anvil default #1 ως sender
    uint256 constant SENDER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Anvil default #2 ως παραλήπτης
    address  constant RECIPIENT = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    // 10 KWH (18 decimals)
    uint256 constant AMOUNT = 10 ether;

    function run() external {
        require(TOKEN != address(0), "Set TOKEN address first");

        KWHToken token = KWHToken(TOKEN);
        address sender = vm.addr(SENDER_PK);

        console2.log("KWHToken   :", TOKEN);
        console2.log("Sender     :", sender);
        console2.log("Recipient  :", RECIPIENT);
        console2.log("Amount     :", AMOUNT);

        uint256 sBefore = token.balanceOf(sender);
        uint256 rBefore = token.balanceOf(RECIPIENT);
        console2.log("Sender(before)   :", sBefore);
        console2.log("Recipient(before):", rBefore);

        vm.startBroadcast(SENDER_PK);
        token.transfer(RECIPIENT, AMOUNT);
        vm.stopBroadcast();

        uint256 sAfter = token.balanceOf(sender);
        uint256 rAfter = token.balanceOf(RECIPIENT);
        console2.log("Sender(after)    :", sAfter);
        console2.log("Recipient(after) :", rAfter);
    }
}
