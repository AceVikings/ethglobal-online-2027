// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ClearingEscrow} from "../src/ClearingEscrow.sol";

interface VmClearingEscrow {
    function envAddress(string calldata name) external returns (address);
    function envBytes32(string calldata name) external returns (bytes32);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployClearingEscrow {
    VmClearingEscrow private constant vm = VmClearingEscrow(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ClearingEscrow escrow) {
        address signer = vm.envAddress("VERDICT_SIGNER_ADDRESS");
        bytes32 policyHash = vm.envBytes32("POLICY_HASH");
        vm.startBroadcast();
        escrow = new ClearingEscrow(signer, policyHash);
        vm.stopBroadcast();
    }
}
