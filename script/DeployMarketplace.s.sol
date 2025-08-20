// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/P2PMarketplace.sol";

contract DeployMarketplace is Script {
    function run() external {
        address token = vm.envAddress("TOKEN");   // π.χ. 0xe7f1...F0512
        address owner = vm.envAddress("OWNER");   // account του admin (π.χ. anvil account[0])

        uint256 pk = vm.envUint("PK");
        vm.startBroadcast(pk);

        P2PMarketplace mkt = new P2PMarketplace(token, owner);

        // optional ρυθμίσεις, π.χ. 0.3% fee
        // mkt.setFee(30, owner);
        // mkt.setBuybackPrice(0.00009 ether);

        vm.stopBroadcast();

        console2.log("MARKETPLACE:", address(mkt));
    }
}
