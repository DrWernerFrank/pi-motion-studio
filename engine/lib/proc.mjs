import { spawn } from 'node:child_process';

// Run a command, resolve with { code, out, err }; reject on non-zero unless allowFail.
export function run(cmd, args, { cwd, allowFail = false, input } = {}) {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', bad);
    p.on('close', (code) => {
      if (code !== 0 && !allowFail) bad(new Error(`${cmd} ${args.join(' ')}\n${err.slice(-2000)}`));
      else ok({ code, out, err });
    });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

// Same, but stdout is BINARY (frame extraction to a pipe) — collected as a Buffer.
export function runBuf(cmd, args, { cwd } = {}) {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', bad);
    p.on('close', (code) => code === 0 ? ok(Buffer.concat(chunks)) : bad(new Error(`${cmd} ${args.join(' ')}\n${err.slice(-2000)}`)));
  });
}
