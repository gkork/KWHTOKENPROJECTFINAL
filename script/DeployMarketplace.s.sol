// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/P2PMarketplace.sol";

contract DeployMarketplace is Script {
    function run() external {
        uint256 pk = vm.envUint("PK");
        address token = vm.envAddress("TOKEN");

        vm.startBroadcast(pk);

        P2PMarketplace m = new P2PMarketplace(token);
        console2.log("MARKET:", address(m));

        vm.stopBroadcast();
    }
}
