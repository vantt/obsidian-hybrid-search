#!/usr/bin/env node
import { runCli } from './cli.js';

process.exitCode = runCli(process.argv.slice(2), {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
