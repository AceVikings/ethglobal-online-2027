# Privy to Hedera x402 signing PoC

This package connects a Privy Ethereum server wallet's raw secp256k1 signer to
the payer signature expected by Hedera-native x402.

The adapter freezes the same `TransferTransaction` shape used by
`@x402/hedera`, hashes each canonical protobuf `TransactionBody` with
Keccak-256, sends that 32-byte digest to a Privy-compatible `rawSign` callback,
and injects the returned compact 64-byte `r || s` signature through Hiero's
`Transaction.signWith` API.

Run it with:

```sh
npm test --workspace @desk/privy-hedera-poc
```

The HTTP client uses Privy's required Basic Auth and `privy-app-id` headers. It
can create or retrieve a wallet by external ID and calls `POST
/v1/wallets/{wallet_id}/rpc` with `secp256k1_sign`. Because that response is a
compact `r || s` signature (optionally followed by `v`), the adapter uses the
provided recovery parity or tries both when it is absent. It accepts only the
compressed public key whose Ethereum address matches Privy's wallet record and
inserts only `r || s` into Hedera.

The test suite uses a local provider double to prove the request contract,
authentication headers, fail-closed errors, public-key recovery, and exact
Hedera transaction signing without broadcasting or exposing secrets. That
double is test-only and is never used by the product or demo path.

Run the non-broadcasting live authentication and raw-sign check with an existing
server wallet:

```sh
PRIVY_APP_ID=... PRIVY_APP_SECRET=... PRIVY_WALLET_ID=... \
  npm run live-check --workspace @desk/privy-hedera-poc
```

It signs a fixed probe digest, verifies the recovered key against the wallet's
public address, emits only redacted public identifiers, and never builds or
broadcasts a transaction. The project has separately live-validated a Hedera
testnet account controlled by that recovered key. The qualification proof still
requires a funded x402 request through Blocky402 `/verify` and `/settle`; see the
root README for current status and public evidence.

References:

- [Privy secp256k1 signing API](https://docs.privy.io/api-reference/wallets/ethereum/secp256k1-sign)
- [Privy other-chain signing](https://docs.privy.io/wallets/using-wallets/other-chains)
- [x402 Hedera package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera)
- [Hiero JavaScript SDK](https://github.com/hiero-ledger/hiero-sdk-js)
