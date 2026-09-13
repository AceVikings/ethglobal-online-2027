// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ClearingEscrowV2} from "../src/ClearingEscrowV2.sol";

interface VmClearingEscrowV2 {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployClearingEscrowV2 {
    VmClearingEscrowV2 private constant vm =
        VmClearingEscrowV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ClearingEscrowV2 escrow) {
        address signer = vm.envAddress("VERDICT_SIGNER_ADDRESS");
        vm.startBroadcast();
        escrow = new ClearingEscrowV2(signer);
        vm.stopBroadcast();
    }
}
