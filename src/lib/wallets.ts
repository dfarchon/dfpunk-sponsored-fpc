import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type OperatorAccountConfig = {
  salt: string;
  secretKey: string;
  signingKey: string;
  address: string;
};

export function signingKeyFromHex(value: string): Fq {
  return Fq.fromBuffer(
    Buffer.from(value.startsWith("0x") ? value.slice(2) : value, "hex"),
  );
}

export function tolerateMissingContracts(node: AztecNode): AztecNode {
  return new Proxy(node, {
    get(target, property, receiver) {
      if (property !== "getContract") {
        return Reflect.get(target, property, receiver);
      }
      return async (...args: Parameters<AztecNode["getContract"]>) => {
        try {
          return await target.getContract(...args);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Temporary internal error")
          ) {
            return undefined;
          }
          throw error;
        }
      };
    },
  });
}

export async function createOperatorWallet(
  node: AztecNode,
  account: OperatorAccountConfig,
  root = process.cwd(),
) {
  const dataDirectory = path.join(root, ".store", "operator");
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const wallet = await EmbeddedWallet.create(tolerateMissingContracts(node), {
    pxe: {
      dataDirectory,
      proverEnabled: true,
      dataStoreMapSizeKb: 1e6,
    },
  });
  const manager = await wallet.createSchnorrInitializerlessAccount(
    Fr.fromString(account.secretKey),
    Fr.fromString(account.salt),
    signingKeyFromHex(account.signingKey),
    "mainnet-operator",
  );
  const configuredAddress = AztecAddress.fromStringUnsafe(account.address);
  if (!manager.address.equals(configuredAddress)) {
    await wallet.stop();
    throw new Error(
      `Operator keys derive ${manager.address.toString()}, not ${account.address}.`,
    );
  }
  return { wallet, manager, address: manager.address };
}
