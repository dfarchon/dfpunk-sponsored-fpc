export interface ParsedArgs {
  positionals: string[];
  flags: ReadonlyMap<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }

    const equals = argument.indexOf('=');
    if (equals !== -1) {
      const name = argument.slice(2, equals);
      if (!name) throw new Error(`Invalid option: ${argument}`);
      flags.set(name, argument.slice(equals + 1));
      continue;
    }

    const name = argument.slice(2);
    if (!name) throw new Error('Invalid empty option');
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { positionals, flags };
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function getStringFlag(
  args: ParsedArgs,
  name: string,
): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

export function rejectUnknownFlags(
  args: ParsedArgs,
  allowed: readonly string[],
): void {
  const known = new Set(allowed);
  for (const name of args.flags.keys()) {
    if (!known.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
  }
}
