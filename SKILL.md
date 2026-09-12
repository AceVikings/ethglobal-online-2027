---
name: get-conformance-verdict
description: Buy and verify signed Messari Lending v3.1 deployment conformance verdicts before an automated action relies on indexed data.
---

# Get a conformance verdict

Use the `get_conformance_verdict` MCP tool before an automated lifecycle or financial action relies
on a supported Messari Lending v3.1 deployment. Supply the protocol, network, deployment ID, and the
caller's policy: a pinned CID (or `null`) and maximum acceptable block lag.

Treat the four verdicts as follows:

- `CONFORMANT`: the deployment passed CID, indexing-error, freshness, schema-shape, and invariant checks.
- `NON_CONFORMANT`: the served deployment differs from the caller's pin, has indexing errors, or violates an invariant.
- `STALE`: block lag exceeds the caller's bound.
- `DISAGREEMENT`: the deployment's schema does not agree with the standard peer shape.

Only `CONFORMANT` authorizes an action. All other verdicts are first-class refusals; surface their
failed checks instead of retrying with a looser policy. The pin and freshness bound belong to the
caller, so do not invent or silently change them.

The result is a derived, signed assertion, not raw Graph data. Verify the configured expected signer
and retain the request ID, signature, query hash, block, and payment reference with the decision.
Never request or expose the seller's Graph API key or verdict signing key.
