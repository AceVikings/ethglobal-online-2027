// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ConformanceGate} from "../src/ConformanceGate.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function envBytes32(string calldata name) external returns (bytes32);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployConformanceGate {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ConformanceGate gate) {
        address signer = vm.envAddress("VERDICT_SIGNER_ADDRESS");
        bytes32 policyHash = vm.envBytes32("POLICY_HASH");
        vm.startBroadcast();
        gate = new ConformanceGate(signer, policyHash);
        vm.stopBroadcast();
    }
}
