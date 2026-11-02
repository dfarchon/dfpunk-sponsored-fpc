# Aztec 5.0.1 Mainnet Sponsored FPC

Operational TypeScript CLI for deriving and experimentally publishing Aztec's
built-in `SponsoredFPC` on Alpha (Ethereum mainnet), bridging real Fee Juice,
claiming it to the FPC, and testing sponsored fee payment.

All Aztec dependencies are pinned to `5.0.1`. Transaction commands are dry-run
unless both `--execute` and `--confirm-mainnet` are supplied.

## Important limitation

Aztec documents the built-in `SponsoredFPC` as testnet/devnet/local-only. This
project deliberately implements the requested mainnet publication path, but it
does not hide that limitation. `verify` performs the decisive Alpha simulation
and reports a public setup allowlist rejection if the network refuses this FPC.
Publishing and funding an address does not prove it can act as a fee payer.

Never bridge a large amount before `verify` succeeds with a small balance.

## Requirements

- Node.js 24+
- pnpm
- Aztec Alpha node version `5.0.1`, `5.1.0`, or `5.2.0`
- Ethereum mainnet RPC
- L1 ETH for approval/deposit gas
- L1 Fee Juice (`$AZTEC`) for bridging

Install:

```bash
pnpm install
cp .env.example .env.mainnet.5.0.1.local
```

Set `ETHEREUM_RPC_URL` in `.env.mainnet.5.0.1.local`. The Aztec RPC defaults to
`https://aztec-mainnet.drpc.org`.

## Generate Ethereum and Aztec accounts

```bash
pnpm accounts:generate
pnpm accounts:show
```

This creates:

- Ethereum private key and EOA address
- Aztec Schnorr initializerless account secret/signing key/salt/address

Secrets are written atomically to `.env.mainnet.5.0.1.local` with mode `0600`.
Existing secrets are not overwritten unless `--force` is supplied. Private
keys are never printed.

Use `--secrets-file <path>` on any command to select another secrets file.

## Preflight

```bash
pnpm preflight
```

Preflight requires:

- Ethereum chain ID `1`
- Aztec L1 chain ID `1`
- Aztec node version `5.0.1`, `5.1.0`, or `5.2.0` (the SponsoredFPC artifact remains pinned to `5.0.1`)
- non-zero Fee Juice and portal addresses returned by the node

## Derive and publish a custom-salt SponsoredFPC

Derivation is offline:

```bash
pnpm fpc:derive --salt 1
pnpm fpc:derive --salt 0x1234
pnpm fpc:derive --salt random
```

Dry-run the publication:

```bash
pnpm fpc:deploy --salt 0x1234
```

Publish the contract class and universal instance with the funded Aztec
operator:

```bash
pnpm fpc:deploy --salt 0x1234 --execute --confirm-mainnet
```

The idempotent deployment manifest is stored in
`deployments/mainnet-5.0.1.json`. It records the salt, deterministic address, class
ID, artifact SHA-256, transaction hash, version, and publication state.

## Bootstrap the Aztec operator

The operator needs Fee Juice to publish the FPC and later claim deposits made
to the FPC. Bridge a small amount to the operator:

```bash
pnpm operator:bridge --amount 10
pnpm operator:bridge --amount 10 --execute --confirm-mainnet
```

After the L1-to-L2 message is included:

```bash
pnpm status
pnpm claim --id operator-... --execute --confirm-mainnet
```

The operator claim uses `FeeJuicePaymentMethodWithClaim`. An initializerless
account is ready after local registration and needs no deployment; its first
signed transaction claims Fee Juice and uses it to pay that transaction's fee.

## Fund or top up SponsoredFPC

Query the current public Fee Juice balance (uses the deployment manifest by
default):

```bash
pnpm fpc:balance
pnpm fpc:balance --address <aztec-address>
```

Bridge an exact additional amount:

```bash
pnpm fpc:topup --amount 100
pnpm fpc:topup --amount 100 --execute --confirm-mainnet
```

Top up only the difference to a target L2 balance:

```bash
pnpm fpc:topup --target-balance 1000
pnpm fpc:topup --target-balance 1000 --execute --confirm-mainnet
```

By default the FPC comes from `deployments/mainnet-5.0.1.json`. It can also be
selected with `--address <aztec-address>` or `--salt <field>`. Every top-up
creates a separate mode-`0600` claim record under `claims/mainnet`; repeated
top-ups never overwrite previous claim secrets.

Inspect and claim:

```bash
pnpm status
pnpm status --id fpc-...
pnpm claim --wait --timeout-minutes 120 --poll-seconds 15 \
  --execute --confirm-mainnet
pnpm claim --id fpc-... --execute --confirm-mainnet
pnpm claim --all-ready --execute --confirm-mainnet
```

FPC claim ids are written to `claims/mainnet/fpc-ids.txt`. `pnpm claim`
without `--id` claims pending FPC records automatically. `--all-ready`
also includes operator bootstrap claims.

An FPC claim is sent by the funded operator and calls canonical
`FeeJuice.claim(fpcAddress, amount, secret, leafIndex)`.

## Verify sponsorship

```bash
pnpm verify
pnpm verify --execute --confirm-mainnet
```

Verification checks:

1. manifest salt re-derives the recorded address;
2. the class and public instance exist on Alpha;
3. the FPC has Fee Juice;
4. an empty application transaction simulates with
   `SponsoredFeePaymentMethod`;
5. with `--execute`, the minimal sponsored probe is broadcast.

## Idempotent setup orchestration

The setup command advances one safe stage at a time and can be rerun after L1
message inclusion:

```bash
pnpm mainnet:setup \
  --salt 0x1234 \
  --operator-amount 10 \
  --fpc-amount 100
```

Execute:

```bash
pnpm mainnet:setup \
  --salt 0x1234 \
  --operator-amount 10 \
  --fpc-amount 100 \
  --wait \
  --execute --confirm-mainnet
```

Stages are:

`preflight → operator bridge/claim → FPC publish → FPC bridge/claim → verify`

If a claim is pending, the command does not create a duplicate deposit. Rerun
it after inclusion. `--target-balance` can replace `--fpc-amount`.

## Agent runbook

When asked to deploy:

1. Run `pnpm preflight`.
2. Run `pnpm accounts:show`; if no keys exist, run
   `pnpm accounts:generate` and ask the operator to fund only the printed L1
   address.
3. Dry-run `pnpm mainnet:setup` with the requested salt and amounts.
4. Before any real transaction, show the recipient, amount and current
   balances.
5. Execute only with explicit user authorization using
   `--execute --confirm-mainnet`.
6. Rerun setup after message inclusion until it reaches `complete`.

When asked to add more money:

1. Do not redeploy the FPC.
2. Run `pnpm fpc:topup --amount X` or
   `pnpm fpc:topup --target-balance X`.
3. After confirmation, add `--execute --confirm-mainnet`.
4. Run `pnpm claim --wait --execute --confirm-mainnet`.
5. Report the new FPC balance and locally recorded cumulative claimed amount.

## Development checks

```bash
pnpm typecheck
pnpm test
ETHEREUM_RPC_URL=https://your-mainnet-rpc pnpm test:alpha
```
