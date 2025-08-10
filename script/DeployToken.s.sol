// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/KWHToken.sol";

contract DeployToken is Script {
    function run() external {
        uint256 pk = vm.envUint("PK");
        address owner = vm.addr(pk);

        address simulator = vm.envAddress("SIMULATOR"); // ΠΕΡΝΑΣ το address απ' έξω

        vm.startBroadcast(pk);

        // ctor: KWHToken(address simulator, address initialOwner)
        KWHToken token = new KWHToken(simulator, owner);
        console2.log("TOKEN:", address(token));

        vm.stopBroadcast();
    }
}
