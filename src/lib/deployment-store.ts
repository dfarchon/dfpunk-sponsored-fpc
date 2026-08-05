import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type DeploymentManifest = {
  network: "mainnet";
  l1ChainId: 1;
  aztecVersion: "5.1.0";
  salt: string;
  address: string;
  contractClassId: string;
  artifactHash?: string;
  classRegistered: boolean;
  publiclyDeployed: boolean;
  classRegistrationTxHash?: string;
  deploymentTxHash?: string;
  createdAt: string;
  updatedAt: string;
};

export function deploymentPath(root = process.cwd()): string {
  return path.join(root, "deployments", "mainnet.json");
}

export function loadDeployment(
  root = process.cwd(),
): DeploymentManifest | undefined {
  const destination = deploymentPath(root);
  if (!existsSync(destination)) return undefined;
  return JSON.parse(readFileSync(destination, "utf8")) as DeploymentManifest;
}

export function saveDeployment(
  manifest: DeploymentManifest,
  root = process.cwd(),
): DeploymentManifest {
  const destination = deploymentPath(root);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, destination);
  try {
    chmodSync(destination, 0o600);
  } catch {
    // POSIX permissions are unavailable on some platforms.
  }
  return manifest;
}
