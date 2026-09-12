// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ConformanceGate
/// @notice On-chain record of conformance decisions for The Conformance Desk.
///         The chain — not our code — checks that a verdict was signed by the
///         registered conformance service key. A judge can verify any decision
///         without running anything of ours.
/// @dev Deployed on Hedera testnet (chain 296) and verified via Sourcify.
contract ConformanceGate {
    /// @dev Verdict codes. Must match packages/signal/src/types.ts VERDICT_CODE.
    uint8 public constant CONFORMANT = 0;
    uint8 public constant NON_CONFORMANT = 1;
    uint8 public constant STALE = 2;
    uint8 public constant DISAGREEMENT = 3;

    /// @notice Address of the conformance service's verdict-signing key.
    address public immutable signer;

    /// @notice keccak256 of the committed policy document, fixed at deploy.
    ///         Change the policy and this diverges — visible to anyone.
    bytes32 public immutable policyHash;

    /// @notice One per decision, on both the executed and the refused path.
    /// @param signalHash keccak256 of the canonical verdict payload (minus signature)
    /// @param verdict    one of the constants above
    /// @param opHash     keccak256 of the ATS lifecycle-op calldata, or 0 when refused
    /// @param paymentRef keccak256 of the x402 payment tx id that bought this verdict
    event Decision(
        bytes32 indexed signalHash,
        uint8 indexed verdict,
        bytes32 opHash,
        bytes32 paymentRef,
        address recorder
    );

    error BadVerdictSignature(address recovered);
    error InvalidSigner();
    error BadSignatureLength(uint256 length);
    error UnknownVerdict(uint8 verdict);
    error AlreadyRecorded(bytes32 signalHash);

    /// @notice Guards against a decision being anchored twice.
    mapping(bytes32 => bool) public recorded;

    constructor(address _signer, bytes32 _policyHash) {
        if (_signer == address(0)) revert InvalidSigner();
        signer = _signer;
        policyHash = _policyHash;
    }

    /// @notice Anchor a decision. Reverts unless `sig` is the registered signer's
    ///         signature over `signalHash`, so an unsigned or forged verdict cannot
    ///         be recorded even by the contract deployer.
    function record(
        bytes32 signalHash,
        uint8 verdict,
        bytes32 opHash,
        bytes32 paymentRef,
        bytes calldata sig
    ) external {
        if (verdict > DISAGREEMENT) revert UnknownVerdict(verdict);
        if (recorded[signalHash]) revert AlreadyRecorded(signalHash);

        address got = _recover(signalHash, sig);
        if (got != signer) revert BadVerdictSignature(got);

        recorded[signalHash] = true;
        emit Decision(signalHash, verdict, opHash, paymentRef, msg.sender);
    }

    /// @notice Recompute the anchor digest the HCS message commits to.
    /// @dev Mirrors packages/signal/src/sign.ts `anchorDigest`.
    function anchorDigest(
        string calldata paymentTxId,
        bytes32 signalHash,
        bytes32 opCalldataHash,
        uint8 verdict,
        string calldata ts
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(paymentTxId, signalHash, opCalldataHash, verdict, ts));
    }

    /// @dev Raw secp256k1 over the 32-byte digest — no EIP-191 prefix. The signer
    ///      side uses ethers `SigningKey.sign(digest)`, which matches this exactly.
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert BadSignatureLength(sig.length);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
