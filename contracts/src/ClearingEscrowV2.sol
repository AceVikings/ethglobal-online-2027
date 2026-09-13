// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Payment {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IHoldByPartitionV2 {
    struct Hold {
        uint256 amount;
        uint256 expirationTimestamp;
        address escrow;
        address to;
        bytes data;
    }

    struct HoldIdentifier {
        bytes32 partition;
        address tokenHolder;
        uint256 holdId;
    }

    function executeHoldByPartition(HoldIdentifier calldata hold, address to, uint256 amount)
        external
        returns (bool success, bytes32 partition);
    function releaseHoldByPartition(HoldIdentifier calldata hold, uint256 amount) external returns (bool success);
    function getHoldForByPartition(HoldIdentifier calldata hold)
        external
        view
        returns (
            uint256 amount,
            uint256 expirationTimestamp,
            address escrow,
            address destination,
            bytes memory data,
            bytes memory operatorData,
            uint8 thirdPartyType
        );
}

/// @title ClearingEscrowV2
/// @notice Atomically exchanges a held ATS security for an exact ERC-20
/// consideration after a short-lived, mandate-bound deterministic verdict.
contract ClearingEscrowV2 {
    uint8 public constant APPROVE = 1;
    uint8 public constant DENY = 2;

    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "VerdictV2(uint256 chainId,address verifyingContract,address security,bytes32 partition,address seller,address receiver,address payer,uint256 amount,uint256 holdId,uint256 holdExpiry,uint8 action,bytes32 policyHash,bytes32 mandateHash,bytes32 evidenceHash,bytes32 evidencePaymentRef,address paymentToken,uint256 consideration,uint256 quoteExpiry,uint256 issuedAt,uint256 authorizationExpiry,bytes32 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("AI Clearing Desk");
    bytes32 private constant VERSION_HASH = keccak256("2");
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Authorization {
        uint256 chainId;
        address verifyingContract;
        address security;
        bytes32 partition;
        address seller;
        address receiver;
        address payer;
        uint256 amount;
        uint256 holdId;
        uint256 holdExpiry;
        uint8 action;
        bytes32 policyHash;
        bytes32 mandateHash;
        bytes32 evidenceHash;
        bytes32 evidencePaymentRef;
        address paymentToken;
        uint256 consideration;
        uint256 quoteExpiry;
        uint256 issuedAt;
        uint256 authorizationExpiry;
        bytes32 nonce;
    }

    address public immutable signer;
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(bytes32 => bool) public usedNonces;

    event TradeSettled(
        bytes32 indexed tradeDigest,
        bytes32 indexed mandateHash,
        address indexed security,
        uint256 holdId,
        uint8 action,
        address paymentToken,
        uint256 consideration,
        bytes32 evidenceHash,
        bytes32 evidencePaymentRef,
        bytes32 nonce,
        address relayer
    );

    error InvalidSigner();
    error InvalidAction(uint8 action);
    error InvalidTrade();
    error WrongChain(uint256 got);
    error WrongVerifyingContract(address got);
    error InvalidTimeWindow();
    error AuthorizationExpired(uint256 expiry);
    error QuoteExpired(uint256 expiry);
    error HoldExpired(uint256 expiry);
    error NonceAlreadyUsed(bytes32 nonce);
    error BadSignature();
    error HoldMismatch();
    error PaymentFailed();
    error AtsOperationFailed();

    constructor(address trustedSigner) {
        if (trustedSigner == address(0)) revert InvalidSigner();
        signer = trustedSigner;
        DOMAIN_SEPARATOR = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function settle(Authorization calldata authorization, bytes calldata signature)
        external
        returns (bytes32 tradeDigest)
    {
        if (authorization.action != APPROVE && authorization.action != DENY) {
            revert InvalidAction(authorization.action);
        }
        if (
            authorization.security == address(0) || authorization.seller == address(0)
                || authorization.receiver == address(0) || authorization.payer == address(0)
                || authorization.amount == 0
                || authorization.policyHash == bytes32(0) || authorization.mandateHash == bytes32(0)
                || authorization.evidenceHash == bytes32(0) || authorization.evidencePaymentRef == bytes32(0)
                || authorization.paymentToken == address(0) || authorization.consideration == 0
                || authorization.nonce == bytes32(0)
        ) revert InvalidTrade();
        if (authorization.chainId != block.chainid) revert WrongChain(authorization.chainId);
        if (authorization.verifyingContract != address(this)) {
            revert WrongVerifyingContract(authorization.verifyingContract);
        }
        if (
            authorization.issuedAt > authorization.authorizationExpiry
                || authorization.issuedAt > authorization.quoteExpiry || authorization.issuedAt > block.timestamp
        ) revert InvalidTimeWindow();
        if (block.timestamp > authorization.authorizationExpiry) {
            revert AuthorizationExpired(authorization.authorizationExpiry);
        }
        if (block.timestamp > authorization.quoteExpiry) revert QuoteExpired(authorization.quoteExpiry);
        if (block.timestamp >= authorization.holdExpiry) revert HoldExpired(authorization.holdExpiry);
        if (usedNonces[authorization.nonce]) revert NonceAlreadyUsed(authorization.nonce);

        tradeDigest = hashAuthorization(authorization);
        if (_recover(tradeDigest, signature) != signer) revert BadSignature();

        IHoldByPartitionV2.HoldIdentifier memory identifier = IHoldByPartitionV2.HoldIdentifier({
            partition: authorization.partition,
            tokenHolder: authorization.seller,
            holdId: authorization.holdId
        });
        (uint256 liveAmount, uint256 liveExpiry, address liveEscrow, address liveBuyer,,,) =
            IHoldByPartitionV2(authorization.security).getHoldForByPartition(identifier);
        if (
            liveAmount != authorization.amount || liveExpiry != authorization.holdExpiry
                || liveEscrow != address(this) || liveBuyer != authorization.receiver
        ) revert HoldMismatch();

        usedNonces[authorization.nonce] = true;
        bool success;
        if (authorization.action == APPROVE) {
            if (
                !IERC20Payment(authorization.paymentToken).transferFrom(
                    authorization.payer, authorization.seller, authorization.consideration
                )
            ) revert PaymentFailed();
            (success,) = IHoldByPartitionV2(authorization.security).executeHoldByPartition(
                identifier, authorization.receiver, authorization.amount
            );
        } else {
            success = IHoldByPartitionV2(authorization.security).releaseHoldByPartition(identifier, authorization.amount);
        }
        if (!success) revert AtsOperationFailed();

        _emitSettlement(tradeDigest, authorization);
    }

    function hashAuthorization(Authorization calldata authorization) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, authorization));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _emitSettlement(bytes32 tradeDigest, Authorization calldata authorization) private {
        emit TradeSettled(
            tradeDigest,
            authorization.mandateHash,
            authorization.security,
            authorization.holdId,
            authorization.action,
            authorization.paymentToken,
            authorization.consideration,
            authorization.evidenceHash,
            authorization.evidencePaymentRef,
            authorization.nonce,
            msg.sender
        );
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address recovered) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > SECP256K1_HALF_ORDER) revert BadSignature();
        recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert BadSignature();
    }
}
