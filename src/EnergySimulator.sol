// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EnergySimulator {
    address public owner;
    uint256 private seed;
    bool public useFixed;
    uint256 public fixedKwh;

    constructor() { owner = msg.sender; seed = 1; }
    modifier onlyOwner(){ require(msg.sender==owner,"not owner"); _; }

    function setFixedKwh(uint256 v) external onlyOwner { fixedKwh=v; useFixed=true; }
    function clearFixed() external onlyOwner { useFixed=false; }

    // ΑΥΤΟ ΧΡΕΙΑΖΕΤΑΙ το KWHToken
    function simulateConsumption() external returns (uint256 kwh) {
        if (useFixed) return fixedKwh;
        unchecked { seed = uint256(keccak256(abi.encodePacked(block.timestamp,msg.sender,seed))); }
        kwh = (seed % 5) + 1; // 1..5 kWh για demo
    }
}
