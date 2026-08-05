import { formatUnits, parseUnits } from "viem";

export function parsePositiveAmount(value: string, decimals = 18): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Amount must be a positive decimal value.");
  }
  const amount = parseUnits(value, decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function topUpAmount(
  currentBalance: bigint,
  targetBalance: bigint,
): bigint {
  if (targetBalance <= currentBalance) return 0n;
  return targetBalance - currentBalance;
}

export function formatAmount(value: bigint, decimals = 18): string {
  return formatUnits(value, decimals);
}
