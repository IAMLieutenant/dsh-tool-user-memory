import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../src/client.js', import.meta.url), new URL('../lib/client.js', import.meta.url));
