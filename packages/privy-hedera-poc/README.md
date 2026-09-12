# Privy to Hedera x402 signing PoC

This isolated PoC answers one question: can a Privy Ethereum server wallet's
raw secp256k1 signer produce the payer signature expected by Hedera-native x402?

The adapter freezes the same `TransferTransaction` shape used by
`@x402/hedera`, hashes each canonical protobuf `TransactionBody` with
Keccak-256, sends that 32-byte digest to a Privy-compatible `rawSign` callback,
and injects the returned compact 64-byte `r || s` signature through Hiero's
`Transaction.signWith` API.

Run it with:

```sh
npm test --workspace @desk/privy-hedera-poc
```

The test uses a deterministic local ECDSA key to emulate Privy's
`secp256k1_sign` response. It proves serialization and cryptographic compatibility without
network access or secrets. It does **not** prove that Privy authorization,
wallet policy, Hedera account provisioning, or Blocky402 settlement works live.

The smallest remaining live test is:

1. Create a Privy Ethereum server wallet and obtain its compressed public key.
2. Create or update a Hedera testnet account so that public key controls it.
3. Replace the local `rawSign` callback with Privy's `POST
   /v1/wallets/{wallet_id}/rpc` call using the `secp256k1_sign` method.
4. Submit the resulting payment through Blocky402 `/verify` and `/settle`.

References:

- [Privy secp256k1 signing API](https://docs.privy.io/api-reference/wallets/ethereum/secp256k1-sign)
- [Privy other-chain signing](https://docs.privy.io/wallets/using-wallets/other-chains)
- [x402 Hedera package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera)
- [Hiero JavaScript SDK](https://github.com/hiero-ledger/hiero-sdk-js)
