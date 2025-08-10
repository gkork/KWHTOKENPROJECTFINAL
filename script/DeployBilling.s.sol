// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/EnergyBilling.sol";

contract DeployBilling is Script {
    function run() external {
        uint256 pk = vm.envUint("PK");
        address token = vm.envAddress("TOKEN");

        vm.startBroadcast(pk);

        EnergyBilling billing = new EnergyBilling(token);
        console2.log("BILLING:", address(billing));

        vm.stopBroadcast();
    }
}
