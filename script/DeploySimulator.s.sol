// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/EnergySimulator.sol";

contract DeploySimulator is Script {
    function run() external {
        uint256 pk = vm.envUint("PK");
        vm.startBroadcast(pk);

        EnergySimulator sim = new EnergySimulator();
        console2.log("SIMULATOR:", address(sim));

        vm.stopBroadcast();
    }
}
