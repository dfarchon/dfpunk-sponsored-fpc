import { resolve } from 'node:path';

import { createAztecNodeClient, type AztecNode } from '@aztec-labs/aztec.js/node';
import type { NodeInfo } from '@aztec-labs/aztec.js/contracts';
import { config as loadDotenv } from 'dotenv';
import {
  createPublicClient,
  http,
  type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';

export const AZTEC_VERSION = '6.0.0';
export const SUPPORTED_AZTEC_NODE_VERSIONS = [AZTEC_VERSION] as const;
export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const DEFAULT_AZTEC_NODE_URL = 'https://aztec-mainnet.drpc.org';
export const DEFAULT_ENV_FILE = '.env.mainnet.6.0.0.local';

export interface AppConfig {
  aztecNodeUrl: string;
  ethereumRpcUrl: string;
  envFile: string;
}

export interface NetworkClients {
  aztecNode: AztecNode;
  ethereum: PublicClient;
}

export interface PreflightResult {
  nodeInfo: NodeInfo;
  ethereumChainId: number;
}

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function parseUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  return parsed.toString();
}

export function loadConfig(options: { envFile?: string } = {}): AppConfig {
  const envFile = resolve(options.envFile ?? DEFAULT_ENV_FILE);
  loadDotenv({ path: envFile, override: false, quiet: true });

  return {
    aztecNodeUrl: parseUrl(
      'AZTEC_NODE_URL',
      process.env.AZTEC_NODE_URL?.trim() || DEFAULT_AZTEC_NODE_URL,
    ),
    ethereumRpcUrl: parseUrl(
      'ETHEREUM_RPC_URL',
      required('ETHEREUM_RPC_URL', process.env.ETHEREUM_RPC_URL),
    ),
    envFile,
  };
}

export function createNetworkClients(config: AppConfig): NetworkClients {
  return {
    aztecNode: createAztecNodeClient(config.aztecNodeUrl),
    ethereum: createPublicClient({
      chain: mainnet,
      transport: http(config.ethereumRpcUrl),
    }),
  };
}

export function assertMainnetNodeInfo(nodeInfo: NodeInfo): void {
  if (nodeInfo.l1ChainId !== ETHEREUM_MAINNET_CHAIN_ID) {
    throw new Error(
      `Aztec node is connected to L1 chain ${nodeInfo.l1ChainId}; expected Ethereum mainnet (1)`,
    );
  }
  const nodeVersionSupported = SUPPORTED_AZTEC_NODE_VERSIONS.some(
    version =>
      nodeInfo.nodeVersion === version ||
      nodeInfo.nodeVersion.startsWith(`${version}-`),
  );
  if (!nodeVersionSupported) {
    throw new Error(
      `Aztec node version ${nodeInfo.nodeVersion} is unsupported; expected ${SUPPORTED_AZTEC_NODE_VERSIONS.join(' or ')}`,
    );
  }
}

export async function runNetworkPreflight(
  clients: NetworkClients,
): Promise<PreflightResult> {
  const [nodeInfo, ethereumChainId] = await Promise.all([
    clients.aztecNode.getNodeInfo(),
    clients.ethereum.getChainId(),
  ]);
  assertMainnetNodeInfo(nodeInfo);
  if (ethereumChainId !== ETHEREUM_MAINNET_CHAIN_ID) {
    throw new Error(
      `Ethereum RPC is connected to chain ${ethereumChainId}; expected mainnet (1)`,
    );
  }
  return { nodeInfo, ethereumChainId };
}
