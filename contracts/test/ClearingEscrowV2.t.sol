// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ClearingEscrowV2, IHoldByPartitionV2, IERC20Payment} from "../src/ClearingEscrowV2.sol";

interface VmV2Test {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes calldata reason) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockPaymentToken is IERC20Payment {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount && balanceOf[from] >= amount, "payment rejected");
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockAtsV2 is IHoldByPartitionV2 {
    Hold private liveHold;
    HoldIdentifier private liveId;
    bool public failExecution;
    uint256 public executed;
    uint256 public released;

    function seed(HoldIdentifier calldata id, Hold calldata hold) external { liveId = id; liveHold = hold; }
    function setFailExecution(bool value) external { failExecution = value; }
    function executeHoldByPartition(HoldIdentifier calldata id, address to, uint256 amount) external returns (bool, bytes32) {
        require(!failExecution, "ATS failed");
        require(msg.sender == liveHold.escrow && _same(id) && to == liveHold.to && amount == liveHold.amount, "bad hold");
        executed = amount;
        liveHold.amount = 0;
        return (true, id.partition);
    }
    function releaseHoldByPartition(HoldIdentifier calldata id, uint256 amount) external returns (bool) {
        require(msg.sender == liveHold.escrow && _same(id) && amount == liveHold.amount, "bad hold");
        released = amount;
        liveHold.amount = 0;
        return true;
    }
    function getHoldForByPartition(HoldIdentifier calldata id) external view returns (uint256, uint256, address, address, bytes memory, bytes memory, uint8) {
        require(_same(id), "missing hold");
        return (liveHold.amount, liveHold.expirationTimestamp, liveHold.escrow, liveHold.to, "", "", 0);
    }
    function _same(HoldIdentifier calldata id) private view returns (bool) {
        return id.partition == liveId.partition && id.tokenHolder == liveId.tokenHolder && id.holdId == liveId.holdId;
    }
}

contract ClearingEscrowV2Test {
    VmV2Test private constant vm = VmV2Test(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;
    bytes32 private constant PARTITION = bytes32(uint256(1));
    bytes32 private constant POLICY = keccak256("personal-vault-policy-v2");
    bytes32 private constant MANDATE = keccak256("signed-vault-mandate");
    address private constant SELLER = address(0x51);
    address private constant BUYER = address(0xB0);
    uint256 private constant UNITS = 25_000_000;
    uint256 private constant PRINCIPAL = 12_500_000;

    ClearingEscrowV2 private escrow;
    MockAtsV2 private ats;
    MockPaymentToken private usdc;

    function setUp() public {
        vm.warp(1_789_220_000);
        ats = new MockAtsV2();
        usdc = new MockPaymentToken();
        escrow = new ClearingEscrowV2(vm.addr(SIGNER_KEY));
        usdc.mint(BUYER, PRINCIPAL * 2);
        vm.prank(BUYER);
        usdc.approve(address(escrow), PRINCIPAL * 2);
    }

    function testApprovalAtomicallyPaysPrincipalAndDeliversUnits() public {
        ClearingEscrowV2.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("approve"));
        _seed(authorization);
        uint256 buyerBefore = usdc.balanceOf(BUYER);

        escrow.settle(authorization, _sign(authorization));

        require(ats.executed() == UNITS, "units not delivered");
        require(usdc.balanceOf(BUYER) == buyerBefore - PRINCIPAL, "buyer principal mismatch");
        require(usdc.balanceOf(SELLER) == PRINCIPAL, "seller not paid");
    }

    function testDenialReleasesWithoutMovingPrincipal() public {
        ClearingEscrowV2.Authorization memory authorization = _authorization(escrow.DENY(), keccak256("deny"));
        _seed(authorization);
        uint256 buyerBefore = usdc.balanceOf(BUYER);

        escrow.settle(authorization, _sign(authorization));

        require(ats.released() == UNITS, "hold not released");
        require(usdc.balanceOf(BUYER) == buyerBefore && usdc.balanceOf(SELLER) == 0, "principal moved on denial");
    }

    function testAtsFailureRollsBackPrincipalTransferAndNonce() public {
        ClearingEscrowV2.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("rollback"));
        _seed(authorization);
        ats.setFailExecution(true);
        uint256 buyerBefore = usdc.balanceOf(BUYER);
        bytes memory signature = _sign(authorization);

        vm.expectRevert(abi.encodeWithSignature("Error(string)", "ATS failed"));
        escrow.settle(authorization, signature);

        require(usdc.balanceOf(BUYER) == buyerBefore && usdc.balanceOf(SELLER) == 0, "principal was not atomic");
        require(!escrow.usedNonces(authorization.nonce), "nonce survived revert");
    }

    function testExpiredQuoteRejectsBeforePayment() public {
        ClearingEscrowV2.Authorization memory authorization = _authorization(escrow.APPROVE(), keccak256("expired-quote"));
        authorization.quoteExpiry = block.timestamp - 1;
        authorization.issuedAt = block.timestamp - 2;
        _seed(authorization);
        bytes memory signature = _sign(authorization);

        vm.expectRevert(abi.encodeWithSelector(ClearingEscrowV2.QuoteExpired.selector, authorization.quoteExpiry));
        escrow.settle(authorization, signature);
        require(usdc.balanceOf(SELLER) == 0, "expired quote paid");
    }

    function _authorization(uint8 action, bytes32 nonce) private view returns (ClearingEscrowV2.Authorization memory) {
        return ClearingEscrowV2.Authorization({
            chainId: block.chainid,
            verifyingContract: address(escrow),
            security: address(ats),
            partition: PARTITION,
            seller: SELLER,
            buyer: BUYER,
            amount: UNITS,
            holdId: 7,
            holdExpiry: block.timestamp + 1 hours,
            action: action,
            policyHash: POLICY,
            mandateHash: MANDATE,
            evidenceHash: keccak256("graph-evidence"),
            evidencePaymentRef: keccak256("x402-payment"),
            paymentToken: address(usdc),
            consideration: PRINCIPAL,
            quoteExpiry: block.timestamp + 10 minutes,
            issuedAt: block.timestamp,
            authorizationExpiry: block.timestamp + 5 minutes,
            nonce: nonce
        });
    }

    function _seed(ClearingEscrowV2.Authorization memory authorization) private {
        ats.seed(
            IHoldByPartitionV2.HoldIdentifier(PARTITION, SELLER, authorization.holdId),
            IHoldByPartitionV2.Hold(UNITS, authorization.holdExpiry, address(escrow), BUYER, "")
        );
    }

    function _sign(ClearingEscrowV2.Authorization memory authorization) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, escrow.hashAuthorization(authorization));
        return abi.encodePacked(r, s, v);
    }
}
