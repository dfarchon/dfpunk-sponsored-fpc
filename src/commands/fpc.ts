import { createHash } from "node:crypto";

import {
  AZTEC_VERSION,
  createNetworkClients,
  loadConfig,
  runNetworkPreflight,
} from "../config.js";
import { readAccountSecrets } from "../lib/accounts.js";
import {
  getStringFlag,
  hasFlag,
  parseArgs,
  rejectUnknownFlags,
} from "../lib/args.js";
import {
  loadDeployment,
  saveDeployment,
  type DeploymentManifest,
} from "../lib/deployment-store.js";
import {
  createSponsoredFpcDeployMethod,
  deriveSponsoredFpc,
  parseSalt,
  SponsoredFPCContractArtifact,
} from "../lib/sponsored-fpc.js";
import { createOperatorWallet } from "../lib/wallets.js";

function assertNoPositionals(positionals: readonly string[]): void {
  if (positionals.length) {
    throw new Error(`Unexpected argument: ${positionals[0]}`);
  }
}

export async function fpcDerive(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, ["salt"]);
  assertNoPositionals(args.positionals);
  const salt = parseSalt(getStringFlag(args, "salt"));
  const instance = await deriveSponsoredFpc(salt);
  const result = {
    salt: salt.toString(),
    address: instance.address.toString(),
    contractClassId: instance.currentContractClassId.toString(),
  };
  console.log(`Salt:              ${result.salt}`);
  console.log(`SponsoredFPC:      ${result.address}`);
  console.log(`Contract class ID: ${result.contractClassId}`);
  return result;
}

export async function fpcDeploy(argv: readonly string[]) {
  const args = parseArgs(argv);
  rejectUnknownFlags(args, [
    "salt",
    "secrets-file",
    "execute",
    "confirm-mainnet",
  ]);
  assertNoPositionals(args.positionals);
  const execute = hasFlag(args, "execute");
  if (execute && !hasFlag(args, "confirm-mainnet")) {
    throw new Error("Mainnet deployment requires --execute --confirm-mainnet.");
  }

  const envFile = getStringFlag(args, "secrets-file");
  const config = loadConfig(envFile ? { envFile } : {});
  const clients = createNetworkClients(config);
  await runNetworkPreflight(clients);

  const existing = loadDeployment();
  const requestedSalt = getStringFlag(args, "salt");
  const salt = parseSalt(requestedSalt ?? existing?.salt);
  const derived = await deriveSponsoredFpc(salt);
  if (
    existing &&
    existing.address.toLowerCase() !== derived.address.toString().toLowerCase()
  ) {
    throw new Error(
      `Existing manifest points to ${existing.address}; refusing a different salt/address.`,
    );
  }

  const [registeredClass, deployedInstance] = await Promise.all([
    clients.aztecNode.getContractClass(derived.currentContractClassId),
    clients.aztecNode.getContract(derived.address),
  ]);
  const now = new Date().toISOString();
  const artifactHash = `0x${createHash("sha256")
    .update(JSON.stringify(SponsoredFPCContractArtifact))
    .digest("hex")}`;
  const baseManifest: DeploymentManifest = {
    network: "mainnet",
    l1ChainId: 1,
    aztecVersion: AZTEC_VERSION,
    salt: salt.toString(),
    address: derived.address.toString(),
    contractClassId: derived.currentContractClassId.toString(),
    classRegistered: registeredClass !== undefined,
    publiclyDeployed: deployedInstance !== undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    artifactHash,
    ...(existing?.classRegistrationTxHash
      ? { classRegistrationTxHash: existing.classRegistrationTxHash }
      : {}),
    ...(existing?.deploymentTxHash
      ? { deploymentTxHash: existing.deploymentTxHash }
      : {}),
  };

  console.log(`SponsoredFPC: ${baseManifest.address}`);
  console.log(`Salt:         ${baseManifest.salt}`);
  console.log(
    `Class:        ${baseManifest.classRegistered ? "registered" : "not registered"}`,
  );
  console.log(
    `Instance:     ${baseManifest.publiclyDeployed ? "deployed" : "not deployed"}`,
  );

  if (!execute) {
    console.log(
      "Dry run only. No deployment transaction sent; add --execute --confirm-mainnet.",
    );
    return baseManifest;
  }
  if (baseManifest.classRegistered && baseManifest.publiclyDeployed) {
    saveDeployment(baseManifest);
    console.log("Deployment already exists; manifest refreshed.");
    return baseManifest;
  }

  const accounts = await readAccountSecrets(config.envFile);
  const { wallet, address } = await createOperatorWallet(
    clients.aztecNode,
    {
      salt: accounts.aztecAccountSalt.toString(),
      secretKey: accounts.aztecSecretKey.toString(),
      signingKey: accounts.aztecSigningKey.toString(),
      address: accounts.aztecAddress,
    },
  );
  try {
    await wallet.registerContract(derived, SponsoredFPCContractArtifact);
    const deploy = await createSponsoredFpcDeployMethod(wallet, salt);
    await deploy.simulate({ from: address });
    const result = await deploy.send({ from: address });
    if (!result.receipt.hasExecutionSucceeded()) {
      throw new Error(`Deployment failed: ${result.receipt.toString()}`);
    }
    const txHash = result.receipt.txHash.toString();
    const manifest: DeploymentManifest = {
      ...baseManifest,
      classRegistered: true,
      publiclyDeployed: true,
      classRegistrationTxHash: txHash,
      deploymentTxHash: txHash,
      updatedAt: new Date().toISOString(),
    };
    saveDeployment(manifest);
    console.log(`Deployment transaction: ${txHash}`);
    return manifest;
  } finally {
    await wallet.stop();
  }
}
