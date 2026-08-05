import { accountsGenerate, accountsShow } from "./commands/accounts.js";
import {
  bridgeOperator,
  claimCommand,
  claimsStatus,
  fpcTopUp,
} from "./commands/bridge.js";
import { fpcDeploy, fpcDerive } from "./commands/fpc.js";
import { preflightCommand, verifyCommand } from "./commands/ops.js";
import { mainnetSetup } from "./commands/setup.js";

function usage(): never {
  console.error(`Usage:
  accounts:generate [--secrets-file <path>] [--force]
  accounts:show [--secrets-file <path>]
  preflight [--secrets-file <path>]
  operator:bridge --amount <FJ> [--execute --confirm-mainnet]
  fpc:derive [--salt random|<field>]
  fpc:deploy [--salt <field>] [--execute --confirm-mainnet]
  fpc:topup (--amount <FJ> | --target-balance <FJ>) [--execute --confirm-mainnet]
  status [--id <claim-id>]
  claim (--id <claim-id> | --all-ready) [--execute --confirm-mainnet]
  verify [--execute --confirm-mainnet]
  mainnet:setup --operator-amount <FJ> --fpc-amount <FJ> [--salt <field>] [--execute --confirm-mainnet]

All network commands accept --secrets-file <path>. Transactions default to dry-run.`);
  process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const argv = process.argv.slice(3);
  switch (command) {
    case "accounts:generate":
      await accountsGenerate(argv);
      return;
    case "accounts:show":
      await accountsShow(argv);
      return;
    case "preflight":
      await preflightCommand(argv);
      return;
    case "operator:bridge":
      await bridgeOperator(argv);
      return;
    case "fpc:derive":
      await fpcDerive(argv);
      return;
    case "fpc:deploy":
      await fpcDeploy(argv);
      return;
    case "fpc:topup":
      await fpcTopUp(argv);
      return;
    case "status":
      await claimsStatus(argv);
      return;
    case "claim":
      await claimCommand(argv);
      return;
    case "verify":
      await verifyCommand(argv);
      return;
    case "mainnet:setup":
      await mainnetSetup(argv);
      return;
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
