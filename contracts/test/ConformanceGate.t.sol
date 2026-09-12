// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ConformanceGate} from "../src/ConformanceGate.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes calldata) external;
}

contract ConformanceGateTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;

    ConformanceGate private gate;
    address private serviceSigner;

    function setUp() public {
        serviceSigner = vm.addr(SIGNER_KEY);
        gate = new ConformanceGate(serviceSigner, keccak256("policy-v1"));
    }

    function testRecordValidRawSignature() public {
        bytes32 signalHash = keccak256("signed-verdict");
        bytes memory sig = _sign(signalHash, SIGNER_KEY);

        gate.record(signalHash, gate.CONFORMANT(), keccak256("transfer"), keccak256("payment"), sig);

        require(gate.recorded(signalHash), "decision not recorded");
    }

    function testRejectsForgedSignature() public {
        bytes32 signalHash = keccak256("signed-verdict");
        bytes memory sig = _sign(signalHash, 0xB0B);
        address recovered = vm.addr(0xB0B);
        uint8 verdict = gate.CONFORMANT();

        vm.expectRevert(abi.encodeWithSelector(ConformanceGate.BadVerdictSignature.selector, recovered));
        gate.record(signalHash, verdict, bytes32(0), bytes32(0), sig);
    }

    function testRejectsUnknownVerdict() public {
        bytes32 signalHash = keccak256("signed-verdict");
        vm.expectRevert(abi.encodeWithSelector(ConformanceGate.UnknownVerdict.selector, uint8(4)));
        gate.record(signalHash, 4, bytes32(0), bytes32(0), _sign(signalHash, SIGNER_KEY));
    }

    function testRejectsReplay() public {
        bytes32 signalHash = keccak256("signed-verdict");
        bytes memory sig = _sign(signalHash, SIGNER_KEY);
        uint8 verdict = gate.STALE();
        gate.record(signalHash, verdict, bytes32(0), bytes32(0), sig);

        vm.expectRevert(abi.encodeWithSelector(ConformanceGate.AlreadyRecorded.selector, signalHash));
        gate.record(signalHash, verdict, bytes32(0), bytes32(0), sig);
    }

    function testAnchorDigestMatchesPackedEncoding() public view {
        bytes32 signalHash = keccak256("signal");
        bytes32 opHash = keccak256("op");
        bytes32 expected = keccak256(abi.encodePacked("0.0.123@1.2", signalHash, opHash, uint8(1), "2026-09-12T00:00:00Z"));
        require(
            gate.anchorDigest("0.0.123@1.2", signalHash, opHash, 1, "2026-09-12T00:00:00Z") == expected,
            "digest mismatch"
        );
    }

    function testRejectsZeroSigner() public {
        vm.expectRevert(abi.encodeWithSelector(ConformanceGate.InvalidSigner.selector));
        new ConformanceGate(address(0), bytes32(0));
    }

    function _sign(bytes32 digest, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
