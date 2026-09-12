// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Minimal ATS v8 hold surface used by the clearing desk.
interface IHoldByPartition {
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

    function createHoldByPartition(bytes32 partition, Hold calldata hold)
        external
        returns (bool success, uint256 holdId);
    function executeHoldByPartition(HoldIdentifier calldata hold, address to, uint256 amount)
        external
        returns (bool success, bytes32 partition);
    function releaseHoldByPartition(HoldIdentifier calldata hold, uint256 amount) external returns (bool success);
    function reclaimHoldByPartition(HoldIdentifier calldata hold) external returns (bool success);
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

/// @title ClearingEscrow
/// @notice Executes or releases one exact ATS hold after validating a single-use,
///         EIP-712 clearing authorization. Anyone may relay an authorization, but
///         nobody receives issuer, controller, or token-holder authority.
contract ClearingEscrow {
    uint8 public constant APPROVE = 1;
    uint8 public constant DENY = 2;

    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "Verdict(uint256 chainId,address verifyingContract,address security,bytes32 partition,address seller,address buyer,uint256 amount,uint256 holdId,uint256 holdExpiry,uint8 action,bytes32 policyHash,bytes32 evidenceHash,bytes32 paymentRef,uint256 issuedAt,uint256 authorizationExpiry,bytes32 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("AI Clearing Desk");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Authorization {
        uint256 chainId;
        address verifyingContract;
        address security;
        bytes32 partition;
        address seller;
        address buyer;
        uint256 amount;
        uint256 holdId;
        uint256 holdExpiry;
        uint8 action;
        bytes32 policyHash;
        bytes32 evidenceHash;
        bytes32 paymentRef;
        uint256 issuedAt;
        uint256 authorizationExpiry;
        bytes32 nonce;
    }

    address public immutable signer;
    bytes32 public immutable policyHash;
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(bytes32 => bool) public usedNonces;

    event HoldSettled(
        bytes32 indexed tradeDigest,
        address indexed security,
        uint256 indexed holdId,
        uint8 action,
        bytes32 evidenceHash,
        bytes32 paymentRef,
        bytes32 nonce,
        address relayer
    );

    error InvalidSigner();
    error InvalidPolicy();
    error InvalidAction(uint8 action);
    error WrongChain(uint256 got);
    error WrongVerifyingContract(address got);
    error WrongPolicy(bytes32 got);
    error InvalidTrade();
    error InvalidTimeWindow();
    error AuthorizationExpired(uint256 expiry);
    error HoldExpired(uint256 expiry);
    error NonceAlreadyUsed(bytes32 nonce);
    error BadSignature();
    error HoldMismatch();
    error AtsOperationFailed();

    constructor(address trustedSigner, bytes32 committedPolicyHash) {
        if (trustedSigner == address(0)) revert InvalidSigner();
        if (committedPolicyHash == bytes32(0)) revert InvalidPolicy();
        signer = trustedSigner;
        policyHash = committedPolicyHash;
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
                || authorization.buyer == address(0) || authorization.amount == 0 || authorization.nonce == bytes32(0)
                || authorization.evidenceHash == bytes32(0) || authorization.paymentRef == bytes32(0)
        ) revert InvalidTrade();
        if (authorization.chainId != block.chainid) revert WrongChain(authorization.chainId);
        if (authorization.verifyingContract != address(this)) {
            revert WrongVerifyingContract(authorization.verifyingContract);
        }
        if (authorization.policyHash != policyHash) revert WrongPolicy(authorization.policyHash);
        if (authorization.issuedAt > authorization.authorizationExpiry) revert InvalidTimeWindow();
        if (authorization.issuedAt > block.timestamp) revert InvalidTimeWindow();
        if (block.timestamp > authorization.authorizationExpiry) {
            revert AuthorizationExpired(authorization.authorizationExpiry);
        }
        if (block.timestamp >= authorization.holdExpiry) revert HoldExpired(authorization.holdExpiry);
        if (usedNonces[authorization.nonce]) revert NonceAlreadyUsed(authorization.nonce);

        tradeDigest = hashAuthorization(authorization);
        if (_recover(tradeDigest, signature) != signer) revert BadSignature();

        IHoldByPartition.HoldIdentifier memory identifier = IHoldByPartition.HoldIdentifier({
            partition: authorization.partition,
            tokenHolder: authorization.seller,
            holdId: authorization.holdId
        });
        (uint256 liveAmount, uint256 liveExpiry, address liveEscrow, address liveBuyer,,,) =
            IHoldByPartition(authorization.security).getHoldForByPartition(identifier);
        if (
            liveAmount != authorization.amount || liveExpiry != authorization.holdExpiry || liveEscrow != address(this)
                || liveBuyer != authorization.buyer
        ) revert HoldMismatch();

        // Consume before interaction. An ATS revert rolls this write back atomically.
        usedNonces[authorization.nonce] = true;
        bool success;
        if (authorization.action == APPROVE) {
            (success,) = IHoldByPartition(authorization.security).executeHoldByPartition(
                identifier, authorization.buyer, authorization.amount
            );
        } else {
            success = IHoldByPartition(authorization.security).releaseHoldByPartition(identifier, authorization.amount);
        }
        if (!success) revert AtsOperationFailed();

        _emitSettlement(tradeDigest, authorization);
    }

    function hashAuthorization(Authorization calldata authorization) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, authorization));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _emitSettlement(bytes32 tradeDigest, Authorization calldata authorization) private {
        emit HoldSettled(
            tradeDigest,
            authorization.security,
            authorization.holdId,
            authorization.action,
            authorization.evidenceHash,
            authorization.paymentRef,
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
