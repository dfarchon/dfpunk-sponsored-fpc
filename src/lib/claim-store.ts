import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type ClaimKind = "operator" | "fpc";
export type ClaimStatus = "deposited" | "ready" | "claimed" | "failed";

export type ClaimRecord = {
  id: string;
  kind: ClaimKind;
  recipient: string;
  amount: string;
  claimSecret: string;
  messageLeafIndex: string;
  messageHash: string;
  status: ClaimStatus;
  depositedAt: string;
  l1TransactionHash?: string;
  claimedAt?: string;
  l2TransactionHash?: string;
  error?: string | undefined;
};

export function claimDirectory(root = process.cwd()): string {
  return path.join(root, "claims", "mainnet");
}

function assertClaimId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid claim id: ${id}`);
  }
}

function claimPath(id: string, root = process.cwd()): string {
  assertClaimId(id);
  return path.join(claimDirectory(root), `${id}.json`);
}

function atomicWrite(destination: string, value: unknown): void {
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, destination);
  try {
    chmodSync(destination, 0o600);
  } catch {
    // POSIX permissions are unavailable on some platforms.
  }
}

export function createClaimId(kind: ClaimKind, messageHash: string): string {
  const suffix = messageHash.replace(/^0x/, "").slice(0, 16);
  return `${kind}-${Date.now()}-${suffix}`;
}

export function saveClaim(
  claim: ClaimRecord,
  root = process.cwd(),
): ClaimRecord {
  atomicWrite(claimPath(claim.id, root), claim);
  return claim;
}

export function loadClaim(
  id: string,
  root = process.cwd(),
): ClaimRecord {
  const destination = claimPath(id, root);
  if (!existsSync(destination)) {
    throw new Error(`Claim ${id} was not found.`);
  }
  return JSON.parse(readFileSync(destination, "utf8")) as ClaimRecord;
}

export function listClaims(root = process.cwd()): ClaimRecord[] {
  const directory = claimDirectory(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const id = name.slice(0, -5);
      return loadClaim(id, root);
    })
    .sort((a, b) => a.depositedAt.localeCompare(b.depositedAt));
}

export function isActionableClaim(claim: ClaimRecord): boolean {
  return claim.status === "deposited" || claim.status === "ready";
}

export function updateClaim(
  id: string,
  patch: Partial<ClaimRecord>,
  root = process.cwd(),
): ClaimRecord {
  const current = loadClaim(id, root);
  const updated = { ...current, ...patch, id: current.id };
  return saveClaim(updated, root);
}

export function sumClaimedAmount(
  recipient: string,
  root = process.cwd(),
): bigint {
  return listClaims(root)
    .filter(
      (claim) =>
        claim.status === "claimed" &&
        claim.recipient.toLowerCase() === recipient.toLowerCase(),
    )
    .reduce((total, claim) => total + BigInt(claim.amount), 0n);
}
