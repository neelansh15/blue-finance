# Aave V3 protocol

This directory is for the Blue-operated Aave V3 pool described in [Architecture v3](../architecture-v3.md). It will hold the new contracts, deployment scripts, and tests for one shared USDT reserve and stock-specific borrowing controls.

Start by pinning the upstream release for the local prototype, then deploy one USDT reserve and two mock stock reserves on a BNB Chain fork. Verify the stock-specific borrow gate and debt accounting before connecting the frontend to the pool.

The working Morpho contracts and Foundry commands are documented in the [Morpho protocol README](../protocol-old/README.md). The existing fork demo uses that implementation.
