// capped.mjs self-test: the guard itself. Fast (seconds), safe (allocations die at the cap).
import { runCapped, MemPool, detEnv, CAPS, TOTAL_MB } from '../../lib/capped.mjs';
const PY = '/home/werner/.local/share/pi-motion-studio/manim-venv/bin/python';
const bad = [];
const eq = (a, b, what) => { console.log(`${a === b ? 'ok  ' : 'FAIL'}  ${what}`); if (a !== b) bad.push(what); };

// 1. an oversized allocation (1.4 GB) under a 700 MB cap MUST die, quickly, reason 'memory'
const t0 = Date.now();
const r1 = await runCapped(PY, ['-c', 'x = bytearray(1_400_000_000); import time; time.sleep(5); print("BAD: survived")'],
  { memoryMb: 700, timeoutS: 60, label: 'oom-probe' });
eq(r1.reason === 'memory', true, `a 1.4GB alloc under a 700MB cap is killed (${r1.code !== 0}, in ${(Date.now() - t0) / 1000}s)`);
eq(/BAD: survived/.test(r1.out), false, 'the oversized process never finishes');

// 2. a normal process completes and returns its output
const r2 = await runCapped(PY, ['-c', 'print("alive")'], { memoryMb: 1024, timeoutS: 60 });
eq(r2.code === 0 && /alive/.test(r2.out), true, 'a normal process under the same wrapper completes');

// 3. a hung process dies at its time budget
const r3 = await runCapped(PY, ['-c', 'import time; time.sleep(30)'], { memoryMb: 1024, timeoutS: 3 });
eq(r3.reason === 'timeout', true, 'a hung process is killed at its wall-clock budget (~3s)');

// 4. the deterministic env carries
const r4 = await runCapped(PY, ['-c', 'import os; print(os.environ.get("PYTHONHASHSEED"), os.environ.get("LC_ALL"), os.environ.get("SOURCE_DATE_EPOCH"))'], { memoryMb: 512, timeoutS: 60 });
eq(/0 C.UTF-8 1735689600/.test(r4.out), true, 'detEnv: PYTHONHASHSEED/LC_ALL/SOURCE_DATE_EPOCH set');

// 5. the scheduler never oversubscribes the total budget
const pool = new MemPool(TOTAL_MB);
const seen = [];
const jobs = [700, 700, 700, 700].map((mb, i) => pool.run({ cmd: PY, args: ['-c', 'import time; time.sleep(1.0); print("job%d ok")'.replace(/%d/, String(i))],
  memoryMb: mb, timeoutS: 60, label: `job${i}` }).then((r) => seen.push(`${r.label}:${r.code}`)));
await Promise.all(jobs);
eq(seen.length === 4 && seen.every((s) => s.endsWith(':0')), true, `the pool runs all jobs (2800MB of 4608MB budget): ${seen.join(', ')}`);

console.log(bad.length ? `\nSELF-TEST FAIL: ${bad.join('; ')}` : '\ncapped.mjs: ALL GUARDS VERIFIED');
process.exit(bad.length ? 1 : 0);
