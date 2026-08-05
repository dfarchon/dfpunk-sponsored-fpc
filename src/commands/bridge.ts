import { AztecAddress } from "@aztec/aztec.js/addresses";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";

import { createNetworkClients, loadConfig, runNetworkPreflight } from "../config.js";
import { readAccountSecrets } from "../lib/accounts.js";
import { parsePositiveAmount, topUpAmount } from "../lib/amount.js";
import {
  getStringFlag,
  hasFlag,
  parseArgs,
  rejectUnknownFlags,
} from "../lib/args.js";
import {
  bridgeFeeJuice,
  claimToFpc,
  getL1FundingSnapshot,
  isClaimReady,
  printL1FundingSnapshot,
} from "../lib/bridge.js";
import {
  isActionableClaim,
  listClaims,
  loadClaim,
  saveClaim,
  sumClaimedAmount,
  updateClaim,
  type ClaimRecord,
} from "../lib/claim-store.js";
import { loadDeployment } from "../lib/deployment-store.js";
import { deriveSponsoredFpc, parseSalt } from "../lib/sponsored-fpc.js";
import { createOperatorWallet } from "../lib/wallets.js";

function assertNoPositionals(positionals: readonly string[]): void {
  if (positionals.length) throw new Error(`Unexpected argument: ${positionals[0]}`);
}

export async function createOperatorClaimPayload(
  operatorAddress: AztecAddress,
  claim: Pick<
    ClaimRecord,
    "amount" | "claimSecret" | "messageLeafIndex"
  >,
) {
  const paymentMethod = new FeeJuicePaymentMethodWithClaim(operatorAddress, {
    claimAmount: BigInt(claim.amount),
    claimSecret: Fr.fromString(claim.claimSecret),
    messageLeafIndex: BigInt(claim.messageLeafIndex),
  });
  return paymentMethod.getExecutionPayload();
}

function configFromArgs(args: ReturnType<typeof parseArgs>) {
  const envFile = getStringFlag(args, "secrets-file");
  return loadConfig(envFile ? { envFile } : {});
}

async function resolveFpcAddress(
  addressText?: string,
  saltText?: string,
): Promise<AztecAddress> {
  if (addressText) return AztecAddress.fromStringUnsafe(addressText);
  if (saltText) return (await deriveSponsoredFpc(parseSalt(saltText))).address;
  const deployment = loadDeployment();
  if (!deployment) {
    throw new Error("No deployment manifest. Pass --address or --salt.");
  }
  return AztecAddress.fromStringUnsafe(deployment.address);
}

function requireExecuteConfirmation(args: ReturnType<typeof parseArgs>): void {
  if (hasFlag(args, "execute") && !hasFlag(args, "confirm-mainnet")) {
    throw new Error("Mainnet transactions require --execute --confirm-mainnet.");
  }
}

export async function fpcTopUp(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "amount",
    "target-balance",
    "address",
    "salt",
    "secrets-file",
    "execute",
    "confirm-mainnet",
  ]);
  assertNoPositionals(args.positionals);
  requireExecuteConfirmation(args);
  const amountText = getStringFlag(args, "amount");
  const targetText = getStringFlag(args, "target-balance");
  if ((amountText ? 1 : 0) + (targetText ? 1 : 0) !== 1) {
    throw new Error("Pass exactly one of --amount or --target-balance.");
  }

  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);
  const accounts = await readAccountSecrets(config.envFile);
  const fpcAddress = await resolveFpcAddress(
    getStringFlag(args, "address"),
    getStringFlag(args, "salt"),
  );
  const [currentBalance, snapshot] = await Promise.all([
    getFeeJuiceBalance(fpcAddress, clients.aztecNode),
    getL1FundingSnapshot(
      clients.aztecNode,
      config.ethereumRpcUrl,
      accounts.ethereumPrivateKey,
    ),
  ]);
  const amount = amountText
    ? parsePositiveAmount(amountText, snapshot.decimals)
    : topUpAmount(
        currentBalance,
        parsePositiveAmount(targetText!, snapshot.decimals),
      );

  console.log(`SponsoredFPC:       ${fpcAddress.toString()}`);
  console.log(`Current L2 balance:${currentBalance.toString()} base units`);
  console.log(`Bridge amount:     ${amount.toString()} base units`);
  printL1FundingSnapshot(snapshot);
  if (amount === 0n) {
    console.log("Target balance is already satisfied; nothing to bridge.");
    return undefined;
  }
  if (snapshot.tokenBalance < amount) {
    throw new Error("Insufficient L1 Fee Juice for this top-up.");
  }
  if (!hasFlag(args, "execute")) {
    console.log(
      "Dry run only. No L1 transaction sent; add --execute --confirm-mainnet.",
    );
    return undefined;
  }

  const claim = await bridgeFeeJuice(
    clients.aztecNode,
    config.ethereumRpcUrl,
    accounts.ethereumPrivateKey,
    fpcAddress,
    amount,
    "fpc",
  );
  saveClaim(claim);
  console.log(`Saved claim ${claim.id}.`);
  console.log("After inclusion, run claim --id <id> --execute --confirm-mainnet.");
  return claim;
}

export async function bridgeOperator(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "amount",
    "secrets-file",
    "execute",
    "confirm-mainnet",
  ]);
  assertNoPositionals(args.positionals);
  requireExecuteConfirmation(args);
  const amountText = getStringFlag(args, "amount");
  if (!amountText) throw new Error("--amount is required.");
  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);
  const accounts = await readAccountSecrets(config.envFile);
  const snapshot = await getL1FundingSnapshot(
    clients.aztecNode,
    config.ethereumRpcUrl,
    accounts.ethereumPrivateKey,
  );
  const amount = parsePositiveAmount(amountText, snapshot.decimals);
  printL1FundingSnapshot(snapshot);
  console.log(`Operator recipient: ${accounts.aztecAddress}`);
  console.log(`Bridge amount: ${amount.toString()} base units`);
  if (snapshot.tokenBalance < amount) {
    throw new Error("Insufficient L1 Fee Juice for operator bootstrap.");
  }
  if (!hasFlag(args, "execute")) {
    console.log("Dry run only; no L1 transaction sent.");
    return undefined;
  }
  const claim = await bridgeFeeJuice(
    clients.aztecNode,
    config.ethereumRpcUrl,
    accounts.ethereumPrivateKey,
    AztecAddress.fromStringUnsafe(accounts.aztecAddress),
    amount,
    "operator",
  );
  saveClaim(claim);
  console.log(`Saved operator bootstrap claim ${claim.id}.`);
  return claim;
}

export async function claimsStatus(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, ["id", "secrets-file"]);
  assertNoPositionals(args.positionals);
  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);
  const id = getStringFlag(args, "id");
  const claims = id ? [loadClaim(id)] : listClaims();
  for (const claim of claims) {
    let ready = claim.status === "claimed" || claim.status === "ready";
    if (claim.status === "deposited") {
      ready = await isClaimReady(clients.aztecNode, claim);
      if (ready) {
        updateClaim(claim.id, { status: "ready" });
      }
    }
    const displayStatus =
      claim.status === "failed"
        ? "failed"
        : claim.status === "claimed"
          ? "claimed"
          : ready
            ? "ready"
            : "waiting";
    console.log(
      `${claim.id} ${claim.kind} ${claim.amount} ${displayStatus}`,
    );
  }
  return claims;
}

async function claimOne(
  claim: ClaimRecord,
  args: ReturnType<typeof parseArgs>,
): Promise<boolean> {
  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);
  if (claim.status === "claimed") {
    console.log(`${claim.id}: already claimed.`);
    return false;
  }
  let ready = await isClaimReady(clients.aztecNode, claim);
  if (!ready && hasFlag(args, "wait")) {
    const timeoutText = getStringFlag(args, "timeout-minutes") ?? "120";
    const pollText = getStringFlag(args, "poll-seconds") ?? "15";
    if (!/^\d+$/.test(timeoutText) || !/^\d+$/.test(pollText)) {
      throw new Error("--timeout-minutes and --poll-seconds must be integers.");
    }
    const deadline = Date.now() + Number(timeoutText) * 60_000;
    const pollMs = Math.max(1, Number(pollText)) * 1_000;
    while (!ready && Date.now() < deadline) {
      console.log(`${claim.id}: waiting for L1→L2 inclusion...`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      ready = await isClaimReady(clients.aztecNode, claim);
    }
  }
  if (!ready) {
    console.log(`${claim.id}: waiting for L1→L2 inclusion.`);
    return false;
  }
  updateClaim(claim.id, { status: "ready" });
  if (!hasFlag(args, "execute")) {
    console.log(`${claim.id}: ready; dry run only.`);
    return false;
  }

  const accounts = await readAccountSecrets(config.envFile);
  const operator = await createOperatorWallet(
    clients.aztecNode,
    {
      salt: accounts.aztecAccountSalt.toString(),
      secretKey: accounts.aztecSecretKey.toString(),
      signingKey: accounts.aztecSigningKey.toString(),
      address: accounts.aztecAddress,
    },
  );
  try {
    let txHash: string;
    if (claim.kind === "operator") {
      if (claim.recipient.toLowerCase() !== accounts.aztecAddress.toLowerCase()) {
        throw new Error("Operator claim recipient does not match configured keys.");
      }
      const payload = await createOperatorClaimPayload(
        operator.address,
        claim,
      );
      const result = await operator.wallet.sendTx(payload, {
        from: operator.address,
        wait: {},
      });
      if (!result.receipt.hasExecutionSucceeded()) {
        throw new Error(result.receipt.toString());
      }
      txHash = result.receipt.txHash.toString();
    } else {
      const result = await claimToFpc(
        operator.wallet,
        operator.address,
        claim,
      );
      if (!result.receipt.hasExecutionSucceeded()) {
        throw new Error(result.receipt.toString());
      }
      txHash = result.receipt.txHash.toString();
    }
    updateClaim(claim.id, {
      status: "claimed",
      claimedAt: new Date().toISOString(),
      l2TransactionHash: txHash,
      error: undefined,
    });
    const recipient = AztecAddress.fromStringUnsafe(claim.recipient);
    const balance = await getFeeJuiceBalance(recipient, clients.aztecNode);
    const cumulative = sumClaimedAmount(claim.recipient);
    console.log(`${claim.id}: claimed in ${txHash}`);
    console.log(`Recipient balance: ${balance.toString()} base units`);
    console.log(`Locally recorded claimed total: ${cumulative.toString()}`);
    return true;
  } catch (error) {
    updateClaim(claim.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await operator.wallet.stop();
  }
}

export async function claimCommand(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "id",
    "all-ready",
    "secrets-file",
    "execute",
    "confirm-mainnet",
    "wait",
    "timeout-minutes",
    "poll-seconds",
  ]);
  assertNoPositionals(args.positionals);
  requireExecuteConfirmation(args);
  const id = getStringFlag(args, "id");
  const allReady = hasFlag(args, "all-ready");
  if ((id ? 1 : 0) + (allReady ? 1 : 0) !== 1) {
    throw new Error("Pass exactly one of --id or --all-ready.");
  }
  const claims = id
    ? [loadClaim(id)]
    : listClaims().filter(isActionableClaim);
  let claimed = 0;
  for (const claim of claims) {
    if (await claimOne(claim, args)) claimed += 1;
  }
  console.log(`Claims completed: ${claimed}`);
  return claimed;
}
