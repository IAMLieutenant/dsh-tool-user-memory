/**
 * Sandbox-friendly test runner: runs node:test in-process (isolation: 'none')
 * so no child processes are spawned (the default --test runner spawns one
 * process per file, which sandboxed environments may block).
 */
import { run } from 'node:test';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { files: { type: 'string', multiple: true, default: [] } },
  allowPositionals: true,
});

const files =
  values.files.length > 0
    ? values.files
    : ['tests/profile.test.ts', 'tests/store.test.ts'];

const stream = run({ files, isolation: 'none' });
let failures = 0;
let tests = 0;
for await (const event of stream) {
  if (event.type === 'test:start') tests += 1;
  if (event.type === 'test:fail') {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${event.data.name}`);
    if (event.data.error) {
      // eslint-disable-next-line no-console
      console.error(String(event.data.error?.stack ?? event.data.error));
    }
  }
}
// eslint-disable-next-line no-console
console.log(`ran ${tests} tests, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
