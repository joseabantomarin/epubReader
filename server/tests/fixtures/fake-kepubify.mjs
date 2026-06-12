#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let outDir = null;
let input = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' || args[i] === '-o') { outDir = args[++i]; }
  else { input = args[i]; }
}
if (!outDir || !input) { process.stderr.write('usage: --output <dir> <input>\n'); process.exit(2); }
const base = path.basename(input).replace(/\.epub$/i, '');
const out = path.join(outDir, `${base}.kepub.epub`);
const data = fs.readFileSync(input);
fs.writeFileSync(out, Buffer.concat([Buffer.from('KEPUB\n'), data]));
process.exit(0);
