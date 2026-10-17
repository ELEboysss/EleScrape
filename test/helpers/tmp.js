import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Create an empty temporary directory. */
export function tmpDir(prefix = 'elescrape-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run `fn` while capturing everything written to stdout/stderr. */
export async function captureOutput(fn) {
  const out = [];
  const err = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    err.push(String(chunk));
    return true;
  };

  try {
    const result = await fn();
    return { result, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}
