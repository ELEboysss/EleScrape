/**
 * CLI dispatcher.
 *
 * Command modules export a small, uniform shape:
 *   { summary, usage, spec, examples, execute(options, positionals) }
 * which keeps `help` and dispatch data-driven.
 */
import { UsageError, formatOptions, parseArgs } from '../util/args.js';
import { ToolError } from '../util/errors.js';
import { version } from '../index.js';

import * as capture from './commands/capture.js';
import * as launch from './commands/launch.js';
import * as list from './commands/list.js';
import * as show from './commands/show.js';
import * as exportCmd from './commands/export.js';
import * as replay from './commands/replay.js';

const COMMANDS = {
  capture,
  launch,
  list,
  show,
  export: exportCmd,
  replay,
};

const ALIASES = {
  ls: 'list',
  cat: 'show',
  exp: 'export',
  rec: 'capture',
};

function generalHelp() {
  const rows = Object.entries(COMMANDS).map(([name, cmd]) => `  ${name.padEnd(9)} ${cmd.summary}`);
  return [
    `elescrape ${version} — capture and inspect browser traffic from the command line`,
    '',
    'Usage:',
    '  elescrape <command> [options]',
    '',
    'Commands:',
    ...rows,
    '  help      Show help for a command',
    '  version   Print the version',
    '',
    'Examples:',
    '  elescrape capture --url http://example.com',
    '  elescrape capture --url http://example.com --filter "/api/" --duration 30 --json',
    '  elescrape list .scrape/<session> --status 2xx',
    '  elescrape export .scrape/<session> --format csv --out requests.csv',
    '',
    'Run `elescrape help <command>` for command-specific options.',
    '',
    'Docs: https://github.com/ELEboysss/EleScrape',
  ].join('\n');
}

function commandHelp(name, cmd) {
  const lines = [
    cmd.summary,
    '',
    formatOptions({ usage: cmd.usage, options: cmd.spec.options }),
  ];
  if (cmd.examples?.length) {
    lines.push('', 'Examples:');
    for (const ex of cmd.examples) lines.push(`  ${ex}`);
  }
  return lines.join('\n');
}

/**
 * Run the CLI.
 * @param {string[]} argv arguments after the executable
 * @returns {Promise<number>} exit code
 */
export async function run(argv = []) {
  // Ignore EPIPE so `| head` does not crash the process.
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  const [first, ...rest] = argv;

  if (!first || first === '--help' || first === '-h' || first === 'help' && rest.length === 0) {
    process.stdout.write(`${generalHelp()}\n`);
    return 0;
  }

  if (first === '--version' || first === '-V' || first === 'version') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const commandName = ALIASES[first] ?? first;

  if (commandName === 'help') {
    const target = rest[0];
    if (!target) {
      process.stdout.write(`${generalHelp()}\n`);
      return 0;
    }
    const cmd = COMMANDS[ALIASES[target] ?? target];
    if (!cmd) return usageFailure(`unknown command: ${target}`);
    process.stdout.write(`${commandHelp(target, cmd)}\n`);
    return 0;
  }

  const cmd = COMMANDS[commandName];
  if (!cmd) return usageFailure(`unknown command: ${first}`);

  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${commandHelp(commandName, cmd)}\n`);
    return 0;
  }

  try {
    const { options, positionals } = parseArgs(rest, cmd.spec);
    const code = await cmd.execute(options, positionals);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`elescrape: ${err.message}\n`);
      process.stderr.write(`Run \`elescrape help ${commandName}\` for usage.\n`);
      return err.exitCode ?? 2;
    }
    if (err instanceof ToolError) {
      process.stderr.write(`elescrape: ${err.message}\n`);
      return err.exitCode ?? 1;
    }
    process.stderr.write(`elescrape: ${err?.stack ?? err}\n`);
    return 1;
  }
}

function usageFailure(message) {
  process.stderr.write(`elescrape: ${message}\n`);
  process.stderr.write('Run `elescrape --help` for the command list.\n');
  return 2;
}

export { COMMANDS, generalHelp, commandHelp };
