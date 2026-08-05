import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import {
  SponsoredFPCContract,
  SponsoredFPCContractArtifact,
} from "@aztec/noir-contracts.js/SponsoredFPC";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import type { Wallet } from "@aztec/aztec.js/wallet";

export function parseSalt(value?: string): Fr {
  if (!value || value === "random") return Fr.random();
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    return Fr.fromHexString(value);
  }
  if (/^\d+$/.test(value)) return Fr.fromString(value);
  throw new Error("Salt must be random, decimal, or 0x-prefixed hex.");
}

export async function deriveSponsoredFpc(salt: Fr) {
  return getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    {
      salt,
      deployer: AztecAddress.ZERO,
    },
  );
}

export async function createSponsoredFpcDeployMethod(
  wallet: Wallet,
  salt: Fr,
) {
  return SponsoredFPCContract.deploy(wallet, {
    salt,
    universalDeploy: true,
  });
}

export { SponsoredFPCContract, SponsoredFPCContractArtifact };
