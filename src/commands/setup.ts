import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils";

import { createNetworkClients, loadConfig } from "../config.js";
import { readAccountSecrets } from "../lib/accounts.js";
import {
  getStringFlag,
  hasFlag,
  parseArgs,
  rejectUnknownFlags,
} from "../lib/args.js";
import { isActionableClaim, listClaims } from "../lib/claim-store.js";
import { loadDeployment } from "../lib/deployment-store.js";
import { bridgeOperator, claimCommand, fpcTopUp } from "./bridge.js";
import { fpcDeploy } from "./fpc.js";
import { preflightCommand, verifyCommand } from "./ops.js";

function passThrough(args: ReturnType<typeof parseArgs>): string[] {
  const result: string[] = [];
  const envFile = getStringFlag(args, "secrets-file");
  if (envFile) result.push("--secrets-file", envFile);
  if (hasFlag(args, "execute")) result.push("--execute");
  if (hasFlag(args, "confirm-mainnet")) result.push("--confirm-mainnet");
  return result;
}

function claimWaitArgs(args: ReturnType<typeof parseArgs>): string[] {
  const result: string[] = [];
  if (hasFlag(args, "wait")) result.push("--wait");
  const timeout = getStringFlag(args, "timeout-minutes");
  const poll = getStringFlag(args, "poll-seconds");
  if (timeout) result.push("--timeout-minutes", timeout);
  if (poll) result.push("--poll-seconds", poll);
  return result;
}

export async function mainnetSetup(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "salt",
    "operator-amount",
    "fpc-amount",
    "target-balance",
    "secrets-file",
    "execute",
    "confirm-mainnet",
    "wait",
    "timeout-minutes",
    "poll-seconds",
  ]);
  if (args.positionals.length) {
    throw new Error(`Unexpected argument: ${args.positionals[0]}`);
  }
  if (hasFlag(args, "execute") && !hasFlag(args, "confirm-mainnet")) {
    throw new Error("--execute requires --confirm-mainnet.");
  }
  const common = passThrough(args);
  await preflightCommand(
    getStringFlag(args, "secrets-file")
      ? ["--secrets-file", getStringFlag(args, "secrets-file")!]
      : [],
  );

  const envFile = getStringFlag(args, "secrets-file");
  const config = loadConfig(envFile ? { envFile } : {});
  const clients = createNetworkClients(config);
  const accounts = await readAccountSecrets(config.envFile);
  const operatorAddress = AztecAddress.fromStringUnsafe(accounts.aztecAddress);
  let operatorBalance = await getFeeJuiceBalance(
    operatorAddress,
    clients.aztecNode,
  );
  if (operatorBalance === 0n) {
    const pendingOperator = listClaims().filter(
      (claim) => claim.kind === "operator" && isActionableClaim(claim),
    );
    if (pendingOperator.length) {
      console.log("Operator bootstrap claim exists; attempting ready claims.");
      await claimCommand([
        "--all-ready",
        ...claimWaitArgs(args),
        ...common,
      ]);
      operatorBalance = await getFeeJuiceBalance(
        operatorAddress,
        clients.aztecNode,
      );
      if (operatorBalance === 0n) {
        console.log("Operator funding is still pending. Rerun setup later.");
        return { stage: "operator-claim-pending" };
      }
    } else {
      const operatorAmount = getStringFlag(args, "operator-amount");
      if (!operatorAmount) {
        throw new Error(
          "Operator has no Fee Juice. Pass --operator-amount for bootstrap.",
        );
      }
      await bridgeOperator(["--amount", operatorAmount, ...common]);
      const submitted = hasFlag(args, "execute");
      console.log(
        submitted
          ? "Operator deposit submitted. Rerun after L1→L2 inclusion."
          : "Operator deposit dry-run completed.",
      );
      return {
        stage: submitted
          ? "operator-deposit-submitted"
          : "operator-deposit-dry-run",
      };
    }
  }

  const salt = getStringFlag(args, "salt");
  await fpcDeploy([...(salt ? ["--salt", salt] : []), ...common]);
  const deployment = loadDeployment();
  if (!deployment?.publiclyDeployed) {
    console.log("FPC deployment is still dry-run or pending.");
    return { stage: "fpc-deployment-pending" };
  }

  const fpcAddress = AztecAddress.fromStringUnsafe(deployment.address);
  let fpcBalance = await getFeeJuiceBalance(fpcAddress, clients.aztecNode);
  const pendingFpc = listClaims().filter(
    (claim) => claim.kind === "fpc" && isActionableClaim(claim),
  );
  if (pendingFpc.length) {
    await claimCommand([
      "--all-ready",
      ...claimWaitArgs(args),
      ...common,
    ]);
    fpcBalance = await getFeeJuiceBalance(fpcAddress, clients.aztecNode);
  }
  const fpcAmount = getStringFlag(args, "fpc-amount");
  const targetBalance = getStringFlag(args, "target-balance");
  if (fpcBalance === 0n || fpcAmount || targetBalance) {
    if (pendingFpc.length) {
      console.log("FPC top-up claim is still pending. Rerun setup later.");
      return { stage: "fpc-claim-pending" };
    }
    if (!fpcAmount && !targetBalance) {
      throw new Error(
        "FPC has no Fee Juice. Pass --fpc-amount or --target-balance.",
      );
    }
    await fpcTopUp([
      ...(fpcAmount
        ? ["--amount", fpcAmount]
        : ["--target-balance", targetBalance!]),
      ...common,
    ]);
    const submitted = hasFlag(args, "execute");
    console.log(
      submitted
        ? "FPC top-up submitted. Rerun after L1→L2 inclusion."
        : "FPC top-up dry-run completed.",
    );
    return {
      stage: submitted ? "fpc-deposit-submitted" : "fpc-deposit-dry-run",
    };
  }

  await verifyCommand(common);
  return { stage: "complete" };
}
