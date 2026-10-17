/**
 * A tiny, dependency-free option parser.
 *
 * Supported syntax:
 *   --key value      --key=value      --bool      --no-bool
 *   -k value         -kvalue          --           (end of options)
 *
 * Unknown options are reported as errors rather than silently ignored, which
 * matters for scripts: a typo should fail loudly.
 */

import { UsageError } from './errors.js';

export { UsageError };

function coerce(value, type) {
  if (type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new UsageError(`expected a number, got "${value}"`);
    return n;
  }
  return value;
}

/**
 * @param {string[]} argv          arguments after the command name
 * @param {object}   spec          { options, positionals }
 * @returns {{ options: object, positionals: string[] }}
 */
export function parseArgs(argv, spec = {}) {
  const defs = spec.options || {};
  const byAlias = new Map();
  for (const [name, def] of Object.entries(defs)) {
    if (def.alias) byAlias.set(def.alias, name);
  }

  const options = {};
  const positionals = [];
  let index = 0;

  const take = (name, def, inlineValue) => {
    if (def.type === 'boolean') {
      options[name] = inlineValue === undefined ? true : inlineValue !== 'false';
      return;
    }
    const raw = inlineValue !== undefined ? inlineValue : argv[++index];
    if (raw === undefined || (raw.startsWith('-') && raw !== '-' && !def.allowDash)) {
      throw new UsageError(`option --${name} requires a value`);
    }
    const value = coerce(raw, def.type);
    if (def.multiple) {
      (options[name] ||= []).push(value);
    } else {
      options[name] = value;
    }
  };

  for (; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);

      if (name.startsWith('no-')) {
        const positive = name.slice(3);
        if (defs[positive] && defs[positive].type === 'boolean') {
          options[positive] = false;
          continue;
        }
      }
      if (!defs[name]) throw new UsageError(`unknown option --${name}`);
      take(name, defs[name], inlineValue);
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      const body = arg.slice(1);
      const alias = body[0];
      const name = byAlias.get(alias);
      if (!name) throw new UsageError(`unknown option -${alias}`);
      const rest = body.slice(1);
      take(name, defs[name], rest.length ? rest : undefined);
      continue;
    }

    positionals.push(arg);
  }

  // Defaults + required checks.
  for (const [name, def] of Object.entries(defs)) {
    if (options[name] === undefined && def.default !== undefined) {
      options[name] = typeof def.default === 'function' ? def.default() : def.default;
    }
    if (def.required && options[name] === undefined) {
      throw new UsageError(`missing required option --${name}`);
    }
    if (def.choices && options[name] !== undefined) {
      const list = def.multiple ? options[name] : [options[name]];
      for (const v of list) {
        if (!def.choices.includes(v)) {
          throw new UsageError(`invalid value "${v}" for --${name} (expected one of: ${def.choices.join(', ')})`);
        }
      }
    }
  }

  const posSpec = spec.positionals || [];
  for (let i = 0; i < posSpec.length; i++) {
    if (posSpec[i].required && positionals[i] === undefined) {
      throw new UsageError(`missing required argument <${posSpec[i].name}>`);
    }
  }
  if (positionals.length > posSpec.length) {
    throw new UsageError(`unexpected argument "${positionals[posSpec.length]}"`);
  }

  return { options, positionals };
}

const TYPE_LABEL = { string: '<value>', number: '<n>', boolean: '' };

/** Render a help section for one command. */
export function formatOptions(commandSpec, { width = 30 } = {}) {
  const lines = [];
  if (commandSpec.usage) {
    lines.push('Usage:', `  ${commandSpec.usage}`, '');
  }
  const entries = Object.entries(commandSpec.options || {});
  if (entries.length) {
    lines.push('Options:');
    for (const [name, def] of entries) {
      const flag = def.alias ? `-${def.alias}, --${name}` : `    --${name}`;
      const typed = TYPE_LABEL[def.type] || '';
      const head = `${flag}${typed ? ` ${typed}` : ''}`;
      const def_ = def.default !== undefined ? ` (default: ${JSON.stringify(def.default)})` : '';
      const pad = head.length >= width ? `${head}\n${' '.repeat(width)}` : head.padEnd(width);
      lines.push(`  ${pad}${def.desc || ''}${def_}`);
    }
  }
  return lines.join('\n');
}
