import { AztecAddress } from "@aztec/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { Fr } from "@aztec/aztec.js/fields";
import { createLogger } from "@aztec/aztec.js/log";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import type { AztecNode } from "@aztec/aztec.js/node";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { TestERC20Abi } from "@aztec/l1-artifacts/TestERC20Abi";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createClaimId,
  type ClaimKind,
  type ClaimRecord,
} from "./claim-store.js";

const mainnet = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } },
} as const;

export function createL1Clients(
  ethereumRpcUrl: string,
  privateKey: `0x${string}`,
) {
  const account = privateKeyToAccount(privateKey);
  const chain = {
    ...mainnet,
    rpcUrls: { default: { http: [ethereumRpcUrl] } },
  } as const;
  return {
    account,
    publicClient: createPublicClient({
      chain,
      transport: http(ethereumRpcUrl),
    }),
    extendedClient: createExtendedL1Client(
      [ethereumRpcUrl],
      privateKey,
      chain,
    ),
  };
}

export async function assertMainnetConnections(
  node: AztecNode,
  ethereumRpcUrl: string,
): Promise<void> {
  const publicClient = createPublicClient({
    transport: http(ethereumRpcUrl),
  });
  const [chainId, info] = await Promise.all([
    publicClient.getChainId(),
    node.getNodeInfo(),
  ]);
  if (chainId !== 1) {
    throw new Error(`Ethereum RPC chain ID is ${chainId}; expected mainnet 1.`);
  }
  if (info.l1ChainId !== 1) {
    throw new Error(
      `Aztec node reports L1 chain ID ${info.l1ChainId}; expected mainnet 1.`,
    );
  }
  const version = String(info.nodeVersion);
  if (!version.includes("5.1.0")) {
    throw new Error(`Aztec node version is ${version}; expected 5.1.0.`);
  }
  if (
    info.l1ContractAddresses.feeJuiceAddress.isZero() ||
    info.l1ContractAddresses.feeJuicePortalAddress.isZero()
  ) {
    throw new Error("Aztec node returned zero Fee Juice/portal addresses.");
  }
}

export type L1FundingSnapshot = {
  l1Address: Address;
  tokenAddress: Address;
  portalAddress: Address;
  decimals: number;
  ethBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
};

export async function getL1FundingSnapshot(
  node: AztecNode,
  ethereumRpcUrl: string,
  privateKey: `0x${string}`,
): Promise<L1FundingSnapshot> {
  const clients = createL1Clients(ethereumRpcUrl, privateKey);
  const info = await node.getNodeInfo();
  const tokenAddress =
    info.l1ContractAddresses.feeJuiceAddress.toString() as Address;
  const portalAddress =
    info.l1ContractAddresses.feeJuicePortalAddress.toString() as Address;
  const [decimals, ethBalance, tokenBalance, allowance] = await Promise.all([
    clients.publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "decimals",
    }),
    clients.publicClient.getBalance({ address: clients.account.address }),
    clients.publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "balanceOf",
      args: [clients.account.address],
    }),
    clients.publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "allowance",
      args: [clients.account.address, portalAddress],
    }),
  ]);
  return {
    l1Address: clients.account.address,
    tokenAddress,
    portalAddress,
    decimals: Number(decimals),
    ethBalance,
    tokenBalance,
    allowance,
  };
}

export function printL1FundingSnapshot(snapshot: L1FundingSnapshot): void {
  console.log(`L1 address:       ${snapshot.l1Address}`);
  console.log(`Fee Juice token: ${snapshot.tokenAddress}`);
  console.log(`Portal:           ${snapshot.portalAddress}`);
  console.log(`ETH:              ${formatEther(snapshot.ethBalance)}`);
  console.log(
    `Fee Juice:       ${formatUnits(snapshot.tokenBalance, snapshot.decimals)}`,
  );
  console.log(
    `Portal allowance:${formatUnits(snapshot.allowance, snapshot.decimals)}`,
  );
}

export async function bridgeFeeJuice(
  node: AztecNode,
  ethereumRpcUrl: string,
  privateKey: `0x${string}`,
  recipient: AztecAddress,
  amount: bigint,
  kind: ClaimKind,
): Promise<ClaimRecord> {
  if (amount <= 0n) throw new Error("Bridge amount must be positive.");
  const clients = createL1Clients(ethereumRpcUrl, privateKey);
  const manager = await L1FeeJuicePortalManager.new(
    node,
    clients.extendedClient,
    createLogger("mainnet-sponsored-fpc:bridge"),
  );
  // Mainnet must always transfer existing tokens. `true` is test-only minting.
  const claim = await manager.bridgeTokensPublic(recipient, amount, false);
  const messageHash = claim.messageHash.toString();
  return {
    id: createClaimId(kind, messageHash),
    kind,
    recipient: recipient.toString(),
    amount: claim.claimAmount.toString(),
    claimSecret: claim.claimSecret.toString(),
    messageLeafIndex: claim.messageLeafIndex.toString(),
    messageHash,
    status: "deposited",
    depositedAt: new Date().toISOString(),
  };
}

export async function isClaimReady(
  node: AztecNode,
  claim: ClaimRecord,
): Promise<boolean> {
  return isL1ToL2MessageReady(node, Fr.fromHexString(claim.messageHash));
}

export async function claimToFpc(
  wallet: Wallet,
  operator: AztecAddress,
  claim: ClaimRecord,
) {
  if (claim.status === "claimed") {
    throw new Error(`Claim ${claim.id} is already claimed.`);
  }
  const feeJuice = FeeJuiceContract.at(wallet);
  return feeJuice.methods
    .claim(
      AztecAddress.fromStringUnsafe(claim.recipient),
      BigInt(claim.amount),
      Fr.fromString(claim.claimSecret),
      BigInt(claim.messageLeafIndex),
    )
    .send({ from: operator });
}
