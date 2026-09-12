// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ClearingEscrow, IHoldByPartition} from "../src/ClearingEscrow.sol";

interface VmEscrowTest {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes calldata reason) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockAtsHold is IHoldByPartition {
    struct StoredHold {
        uint256 amount;
        uint256 expirationTimestamp;
        address escrow;
        address to;
        bytes data;
        bool exists;
    }

    mapping(bytes32 => StoredHold) private holds;
    bool public failNextOperation;
    bool public returnFalse;
    address public lastRecipient;
    uint256 public lastExecutedAmount;
    uint256 public lastReleasedAmount;

    error NotEscrow();
    error MissingHold();
    error ForcedFailure();

    function seedHold(HoldIdentifier calldata identifier, Hold calldata hold) external {
        holds[_key(identifier)] =
            StoredHold(hold.amount, hold.expirationTimestamp, hold.escrow, hold.to, hold.data, true);
    }

    function setFailNextOperation(bool value) external {
        failNextOperation = value;
    }

    function setReturnFalse(bool value) external {
        returnFalse = value;
    }

    function createHoldByPartition(bytes32, Hold calldata) external pure returns (bool, uint256) {
        revert("test helper uses seedHold");
    }

    function executeHoldByPartition(HoldIdentifier calldata identifier, address to, uint256 amount)
        external
        returns (bool, bytes32)
    {
        StoredHold storage hold = _authorized(identifier);
        if (failNextOperation) revert ForcedFailure();
        if (returnFalse) return (false, identifier.partition);
        require(to == hold.to && amount == hold.amount, "wrong execution");
        hold.amount = 0;
        lastRecipient = to;
        lastExecutedAmount = amount;
        return (true, identifier.partition);
    }

    function releaseHoldByPartition(HoldIdentifier calldata identifier, uint256 amount) external returns (bool) {
        StoredHold storage hold = _authorized(identifier);
        if (failNextOperation) revert ForcedFailure();
        if (returnFalse) return false;
        require(amount == hold.amount, "wrong release");
        hold.amount = 0;
        lastReleasedAmount = amount;
        return true;
    }

    function reclaimHoldByPartition(HoldIdentifier calldata identifier) external returns (bool) {
        StoredHold storage hold = holds[_key(identifier)];
        if (!hold.exists) revert MissingHold();
        require(block.timestamp >= hold.expirationTimestamp, "not expired");
        hold.amount = 0;
        return true;
    }

    function getHoldForByPartition(HoldIdentifier calldata identifier)
        external
        view
        returns (uint256, uint256, address, address, bytes memory, bytes memory, uint8)
    {
        StoredHold storage hold = holds[_key(identifier)];
        if (!hold.exists) revert MissingHold();
        return (hold.amount, hold.expirationTimestamp, hold.escrow, hold.to, hold.data, "", 0);
    }

    function _authorized(HoldIdentifier calldata identifier) private view returns (StoredHold storage hold) {
        hold = holds[_key(identifier)];
        if (!hold.exists) revert MissingHold();
        if (msg.sender != hold.escrow) revert NotEscrow();
    }

    function _key(HoldIdentifier calldata identifier) private pure returns (bytes32) {
        return keccak256(abi.encode(identifier.partition, identifier.tokenHolder, identifier.holdId));
    }
}

contract ClearingEscrowTest {
    VmEscrowTest private constant vm = VmEscrowTest(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant WRONG_SIGNER_KEY = 0xB0B;
    uint256 private constant SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    bytes32 private constant PARTITION = bytes32(uint256(1));
    bytes32 private constant POLICY = keccak256("private-credit-policy-v1");
    address private constant SELLER = address(0x51);
    address private constant BUYER = address(0xB0);
    address private constant OUTSIDER = address(0xBAD);
    uint256 private constant AMOUNT = 25_000_000;
    uint256 private constant HOLD_ID = 7;

    ClearingEscrow private escrow;
    MockAtsHold private ats;

    function setUp() public {
        vm.warp(1_789_220_000);
        ats = new MockAtsHold();
        escrow = new ClearingEscrow(vm.addr(SIGNER_KEY), POLICY);
        _seed(_authorization(escrow.APPROVE(), keccak256("nonce-1")));
    }

    function testApprovedAuthorizationExecutesExactHold() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("approve"));
        _seed(authorization);

        bytes32 digest = escrow.settle(authorization, _sign(authorization, SIGNER_KEY));

        require(digest == escrow.hashAuthorization(authorization), "wrong trade digest");
        require(ats.lastRecipient() == BUYER, "wrong buyer");
        require(ats.lastExecutedAmount() == AMOUNT, "wrong executed amount");
        require(escrow.usedNonces(authorization.nonce), "nonce not consumed");
    }

    function testDeniedAuthorizationReleasesExactHold() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.DENY(), keccak256("deny"));
        _seed(authorization);

        escrow.settle(authorization, _sign(authorization, SIGNER_KEY));

        require(ats.lastExecutedAmount() == 0, "units moved");
        require(ats.lastReleasedAmount() == AMOUNT, "wrong released amount");
    }

    function testOutsiderCannotBypassEscrow() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("outsider"));
        _seed(authorization);
        IHoldByPartition.HoldIdentifier memory identifier = _identifier(authorization);

        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(MockAtsHold.NotEscrow.selector));
        ats.executeHoldByPartition(identifier, BUYER, AMOUNT);
    }

    function testTamperedTradeFieldsRejectBeforeAtsMutation() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("tamper"));
        _seed(authorization);
        bytes memory signature = _sign(authorization, SIGNER_KEY);
        authorization.amount += 1;

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.BadSignature.selector));
        escrow.settle(authorization, signature);

        require(ats.lastExecutedAmount() == 0, "tampering mutated ATS");
        require(!escrow.usedNonces(authorization.nonce), "tampered nonce consumed");
    }

    function testExactLiveHoldFieldsAreRequired() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("live-mismatch"));
        ClearingEscrow.Authorization memory differentHold = authorization;
        differentHold.buyer = address(0xD1FF);
        _seed(differentHold);
        // Memory struct assignments alias; restore the signed trade after seeding
        // a deliberately different live hold.
        authorization.buyer = BUYER;
        bytes memory signature = _sign(authorization, SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.HoldMismatch.selector));
        escrow.settle(authorization, signature);
        require(!escrow.usedNonces(authorization.nonce), "mismatch consumed nonce");
    }

    function testExpiredAuthorizationRejects() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("expired"));
        authorization.authorizationExpiry = block.timestamp - 1;
        authorization.issuedAt = block.timestamp - 2;
        _seed(authorization);
        bytes memory signature = _sign(authorization, SIGNER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(ClearingEscrow.AuthorizationExpired.selector, authorization.authorizationExpiry)
        );
        escrow.settle(authorization, signature);
    }

    function testWrongSignerRejects() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("wrong-signer"));
        _seed(authorization);
        bytes memory signature = _sign(authorization, WRONG_SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.BadSignature.selector));
        escrow.settle(authorization, signature);
    }

    function testHighSMalleableSignatureRejects() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("high-s"));
        _seed(authorization);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, escrow.hashAuthorization(authorization));
        bytes memory signature =
            abi.encodePacked(r, bytes32(SECP256K1_ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.BadSignature.selector));
        escrow.settle(authorization, signature);
    }

    function testConstructorRejectsMissingAuthorityOrPolicy() public {
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidSigner.selector));
        new ClearingEscrow(address(0), POLICY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidPolicy.selector));
        new ClearingEscrow(vm.addr(SIGNER_KEY), bytes32(0));
    }

    function testWrongDomainPolicyActionAndFutureIssueReject() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("domain"));
        _seed(authorization);

        authorization.chainId += 1;
        bytes memory signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.WrongChain.selector, authorization.chainId));
        escrow.settle(authorization, signature);
        authorization.chainId = block.chainid;

        authorization.verifyingContract = address(0xCAFE);
        signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.WrongVerifyingContract.selector, address(0xCAFE)));
        escrow.settle(authorization, signature);
        authorization.verifyingContract = address(escrow);

        authorization.policyHash = keccak256("wrong-policy");
        signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.WrongPolicy.selector, authorization.policyHash));
        escrow.settle(authorization, signature);
        authorization.policyHash = POLICY;

        authorization.action = 3;
        signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidAction.selector, uint8(3)));
        escrow.settle(authorization, signature);
        authorization.action = escrow.APPROVE();

        authorization.issuedAt = block.timestamp + 1;
        signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidTimeWindow.selector));
        escrow.settle(authorization, signature);
    }

    function testZeroEvidenceAndPaymentReferencesReject() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("zero-ref"));
        _seed(authorization);
        authorization.evidenceHash = bytes32(0);
        bytes memory signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidTrade.selector));
        escrow.settle(authorization, signature);

        authorization.evidenceHash = keccak256("graph-evidence");
        authorization.paymentRef = bytes32(0);
        signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.InvalidTrade.selector));
        escrow.settle(authorization, signature);
    }

    function testAtsFalseReturnRollsNonceBack() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.DENY(), keccak256("false-return"));
        _seed(authorization);
        ats.setReturnFalse(true);

        bytes memory signature = _sign(authorization, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.AtsOperationFailed.selector));
        escrow.settle(authorization, signature);

        require(!escrow.usedNonces(authorization.nonce), "false return consumed nonce");
        require(ats.lastReleasedAmount() == 0, "ATS changed on false return");
    }

    function testReplayRejects() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.DENY(), keccak256("replay"));
        _seed(authorization);
        bytes memory signature = _sign(authorization, SIGNER_KEY);
        escrow.settle(authorization, signature);

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.NonceAlreadyUsed.selector, authorization.nonce));
        escrow.settle(authorization, signature);
    }

    function testAtsRevertRollsNonceBackAtomically() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("atomic"));
        _seed(authorization);
        ats.setFailNextOperation(true);
        bytes memory signature = _sign(authorization, SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(MockAtsHold.ForcedFailure.selector));
        escrow.settle(authorization, signature);

        require(!escrow.usedNonces(authorization.nonce), "nonce survived reverted call");
        require(ats.lastExecutedAmount() == 0, "ATS changed on revert");
    }

    function testExpiredHoldRejectsAndRemainsReclaimable() public {
        ClearingEscrow.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("hold-expired"));
        authorization.holdExpiry = block.timestamp;
        _seed(authorization);
        bytes memory signature = _sign(authorization, SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrow.HoldExpired.selector, block.timestamp));
        escrow.settle(authorization, signature);
        ats.reclaimHoldByPartition(_identifier(authorization));
    }

    function _authorization(uint8 action, bytes32 nonce)
        private
        view
        returns (ClearingEscrow.Authorization memory authorization)
    {
        authorization = ClearingEscrow.Authorization({
            chainId: block.chainid,
            verifyingContract: address(escrow),
            security: address(ats),
            partition: PARTITION,
            seller: SELLER,
            buyer: BUYER,
            amount: AMOUNT,
            holdId: HOLD_ID,
            holdExpiry: block.timestamp + 1 hours,
            action: action,
            policyHash: POLICY,
            evidenceHash: keccak256("graph-evidence"),
            paymentRef: keccak256("x402-payment"),
            issuedAt: block.timestamp,
            authorizationExpiry: block.timestamp + 5 minutes,
            nonce: nonce
        });
    }

    function _identifier(ClearingEscrow.Authorization memory authorization)
        private
        pure
        returns (IHoldByPartition.HoldIdentifier memory)
    {
        return IHoldByPartition.HoldIdentifier(authorization.partition, authorization.seller, authorization.holdId);
    }

    function _seed(ClearingEscrow.Authorization memory authorization) private {
        ats.seedHold(
            _identifier(authorization),
            IHoldByPartition.Hold(
                authorization.amount, authorization.holdExpiry, address(escrow), authorization.buyer, ""
            )
        );
    }

    function _sign(ClearingEscrow.Authorization memory authorization, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.hashAuthorization(authorization));
        return abi.encodePacked(r, s, v);
    }
}
