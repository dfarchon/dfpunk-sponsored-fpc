import { SponsoredFeePaymentMethod } from "@aztec-labs/aztec.js/fee/testing";
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils";
import {
  ExecutionPayload,
  mergeExecutionPayloads,
} from "@aztec-labs/aztec.js/tx";

import { createNetworkClients, loadConfig, runNetworkPreflight } from "../config.js";
import { readAccountSecrets } from "../lib/accounts.js";
import {
  getStringFlag,
  hasFlag,
  parseArgs,
  rejectUnknownFlags,
} from "../lib/args.js";
import { getL1FundingSnapshot, printL1FundingSnapshot } from "../lib/bridge.js";
import {
  deploymentPath,
  loadDeployment,
} from "../lib/deployment-store.js";
import {
  deriveSponsoredFpc,
  parseSalt,
  SponsoredFPCContractArtifact,
} from "../lib/sponsored-fpc.js";
import { createOperatorWallet } from "../lib/wallets.js";

function configFromArgs(args: ReturnType<typeof parseArgs>) {
  const envFile = getStringFlag(args, "secrets-file");
  return loadConfig(envFile ? { envFile } : {});
}

export async function preflightCommand(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, ["secrets-file"]);
  if (args.positionals.length) {
    throw new Error(`Unexpected argument: ${args.positionals[0]}`);
  }
  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  const result = await runNetworkPreflight(clients);
  console.log(`Aztec node:    ${config.aztecNodeUrl}`);
  console.log(`Aztec version: ${result.nodeInfo.nodeVersion}`);
  console.log(`L1 chain ID:   ${result.ethereumChainId}`);
  console.log(
    `Fee Juice:    ${result.nodeInfo.l1ContractAddresses.feeJuiceAddress.toString()}`,
  );
  console.log(
    `Portal:       ${result.nodeInfo.l1ContractAddresses.feeJuicePortalAddress.toString()}`,
  );
  try {
    const accounts = await readAccountSecrets(config.envFile);
    const snapshot = await getL1FundingSnapshot(
      clients.aztecNode,
      config.ethereumRpcUrl,
      accounts.ethereumPrivateKey,
    );
    printL1FundingSnapshot(snapshot);
  } catch (error) {
    console.warn(
      `Account funding check skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}

export async function verifyCommand(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "secrets-file",
    "execute",
    "confirm-mainnet",
  ]);
  if (args.positionals.length) {
    throw new Error(`Unexpected argument: ${args.positionals[0]}`);
  }
  const execute = hasFlag(args, "execute");
  if (execute && !hasFlag(args, "confirm-mainnet")) {
    throw new Error("Mainnet probe requires --execute --confirm-mainnet.");
  }
  const deployment = loadDeployment();
  if (!deployment) throw new Error(`No ${deploymentPath()} manifest.`);

  const config = configFromArgs(args);
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);
  // The manifest is trusted only after re-deriving and comparing below.
  const instance = await deriveSponsoredFpc(parseSalt(deployment.salt));
  if (instance.address.toString().toLowerCase() !== deployment.address.toLowerCase()) {
    throw new Error("Manifest salt does not derive the recorded FPC address.");
  }
  const [contractClass, deployed, balance] = await Promise.all([
    clients.aztecNode.getContractClass(instance.currentContractClassId),
    clients.aztecNode.getContract(instance.address),
    getFeeJuiceBalance(instance.address, clients.aztecNode),
  ]);
  console.log(`SponsoredFPC: ${instance.address.toString()}`);
  console.log(`Class:        ${contractClass ? "registered" : "missing"}`);
  console.log(`Instance:     ${deployed ? "publicly deployed" : "missing"}`);
  console.log(`Fee Juice:    ${balance.toString()} base units`);
  if (!contractClass || !deployed) {
    throw new Error("SponsoredFPC class/instance is not fully published.");
  }
  if (balance === 0n) throw new Error("SponsoredFPC has no Fee Juice.");

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
    await operator.wallet.registerContract(
      instance,
      SponsoredFPCContractArtifact,
    );
    const paymentMethod = new SponsoredFeePaymentMethod(instance.address);
    const payload = mergeExecutionPayloads([
      await paymentMethod.getExecutionPayload(),
      new ExecutionPayload([], [], [], []),
    ]);
    await operator.wallet.simulateTx(payload, {
      from: operator.address,
    });
    console.log("Sponsored fee simulation succeeded.");
    if (!execute) {
      console.log("Probe was simulation-only.");
      return { balance, simulated: true, sent: false };
    }
    const result = await operator.wallet.sendTx(payload, {
      from: operator.address,
      wait: {},
    });
    if (!result.receipt.hasExecutionSucceeded()) {
      throw new Error(result.receipt.toString());
    }
    console.log(`Sponsored probe transaction: ${result.receipt.txHash.toString()}`);
    return { balance, simulated: true, sent: true };
  } catch (error) {
    console.error(
      "Alpha rejected the built-in SponsoredFPC probe. No additional bridge or deployment action was attempted.",
    );
    throw error;
  } finally {
    await operator.wallet.stop();
  }
}
