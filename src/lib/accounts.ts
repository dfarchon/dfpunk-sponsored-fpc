import { constants } from 'node:fs';
import {
  chmod,
  link,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { getSchnorrInitializerlessAccountContractAddress } from '@aztec/accounts/schnorr';
import type { AztecNode } from '@aztec/aztec.js/node';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';
import { parse as parseDotenv } from 'dotenv';
import {
  formatEther,
  formatUnits,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';

export interface AccountSecrets {
  ethereumPrivateKey: Hex;
  aztecSecretKey: Fr;
  aztecSigningKey: GrumpkinScalar;
  aztecAccountSalt: Fr;
}

export interface GeneratedAccounts extends AccountSecrets {
  ethereumAddress: Address;
  aztecAddress: string;
}

export interface AccountBalances {
  ethereumWei: bigint;
  ethereumEth: string;
  feeJuice: bigint;
  feeJuiceFormatted: string;
}

const HEX_32_BYTES = /^0x[0-9a-fA-F]{64}$/;
const FEE_JUICE_BALANCES_STORAGE_SLOT = 1n;
const FEE_JUICE_DECIMALS = 18;

function parseHex32(name: string, value: string | undefined): Hex {
  if (!value || !HEX_32_BYTES.test(value)) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed hex value`);
  }
  return value as Hex;
}

export async function generateAccounts(): Promise<GeneratedAccounts> {
  const ethereumPrivateKey = generatePrivateKey();
  const ethereumAddress = privateKeyToAccount(ethereumPrivateKey).address;
  const aztecSecretKey = Fr.random();
  const aztecSigningKey = GrumpkinScalar.random();
  const aztecAccountSalt = Fr.random();
  const aztecAddress = (
    await getSchnorrInitializerlessAccountContractAddress(
      aztecSigningKey,
      aztecAccountSalt,
      aztecSecretKey,
    )
  ).toString();

  return {
    ethereumPrivateKey,
    ethereumAddress,
    aztecSecretKey,
    aztecSigningKey,
    aztecAccountSalt,
    aztecAddress,
  };
}

export function serializeAccountEnv(
  accounts: GeneratedAccounts,
  network: { aztecNodeUrl: string; ethereumRpcUrl: string },
): string {
  return [
    '# Generated mainnet account material. Keep this file secret.',
    `AZTEC_NODE_URL=${network.aztecNodeUrl}`,
    `ETHEREUM_RPC_URL=${network.ethereumRpcUrl}`,
    `ETHEREUM_PRIVATE_KEY=${accounts.ethereumPrivateKey}`,
    `AZTEC_SECRET_KEY=${accounts.aztecSecretKey.toString()}`,
    `AZTEC_SIGNING_KEY=${accounts.aztecSigningKey.toString()}`,
    `AZTEC_ACCOUNT_SALT=${accounts.aztecAccountSalt.toString()}`,
    `AZTEC_ACCOUNT_ADDRESS=${accounts.aztecAddress}`,
    '',
  ].join('\n');
}

export async function writeSecretsAtomically(
  destination: string,
  contents: string,
  options: { force?: boolean } = {},
): Promise<string> {
  const target = resolve(destination);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let temporaryExists = false;

  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    temporaryExists = true;
    try {
      await handle.writeFile(contents, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (options.force) {
      await rename(temporary, target);
      temporaryExists = false;
    } else {
      try {
        await link(temporary, target);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'EEXIST'
        ) {
          throw new Error(
            `${target} already exists; pass --force to replace it`,
          );
        }
        throw error;
      }
      await unlink(temporary);
      temporaryExists = false;
    }
    await chmod(target, 0o600);
    return target;
  } finally {
    if (temporaryExists) {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export async function readAccountSecrets(
  envFile: string,
): Promise<GeneratedAccounts> {
  const handle = await open(resolve(envFile), 'r');
  let values: Record<string, string>;
  try {
    values = parseDotenv(await handle.readFile({ encoding: 'utf8' }));
  } finally {
    await handle.close();
  }

  const ethereumPrivateKey = parseHex32(
    'ETHEREUM_PRIVATE_KEY',
    values.ETHEREUM_PRIVATE_KEY,
  );
  const aztecSecretKey = Fr.fromString(
    parseHex32('AZTEC_SECRET_KEY', values.AZTEC_SECRET_KEY),
  );
  const aztecSigningKey = GrumpkinScalar.fromString(
    parseHex32('AZTEC_SIGNING_KEY', values.AZTEC_SIGNING_KEY),
  );
  const aztecAccountSalt = Fr.fromString(
    parseHex32('AZTEC_ACCOUNT_SALT', values.AZTEC_ACCOUNT_SALT),
  );
  const ethereumAddress = privateKeyToAccount(ethereumPrivateKey).address;
  const aztecAddress = (
    await getSchnorrInitializerlessAccountContractAddress(
      aztecSigningKey,
      aztecAccountSalt,
      aztecSecretKey,
    )
  ).toString();

  if (
    values.AZTEC_ACCOUNT_ADDRESS &&
    values.AZTEC_ACCOUNT_ADDRESS !== aztecAddress
  ) {
    throw new Error(
      'AZTEC_ACCOUNT_ADDRESS does not match the configured Aztec keys',
    );
  }

  return {
    ethereumPrivateKey,
    ethereumAddress,
    aztecSecretKey,
    aztecSigningKey,
    aztecAccountSalt,
    aztecAddress,
  };
}

export async function getAccountBalances(
  accounts: GeneratedAccounts,
  clients: { aztecNode: AztecNode; ethereum: PublicClient },
): Promise<AccountBalances> {
  const nodeInfo = await clients.aztecNode.getNodeInfo();
  const aztecAddress = (
    await getSchnorrInitializerlessAccountContractAddress(
      accounts.aztecSigningKey,
      accounts.aztecAccountSalt,
      accounts.aztecSecretKey,
    )
  );
  const balanceSlot = await deriveStorageSlotInMap(
    FEE_JUICE_BALANCES_STORAGE_SLOT,
    aztecAddress,
  );
  const [ethereumWei, feeJuiceField] = await Promise.all([
    clients.ethereum.getBalance({ address: accounts.ethereumAddress }),
    clients.aztecNode.getPublicStorageAt(
      'latest',
      nodeInfo.protocolContractAddresses.feeJuice,
      balanceSlot,
    ),
  ]);
  const feeJuice = feeJuiceField.toBigInt();

  return {
    ethereumWei,
    ethereumEth: formatEther(ethereumWei),
    feeJuice,
    feeJuiceFormatted: formatUnits(feeJuice, FEE_JUICE_DECIMALS),
  };
}
