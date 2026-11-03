// Prettier uses the config nearest each file, so this file governs vantt/**. It keeps the
// root options and leaves alone (formats only on an explicit @format pragma) two kinds of file:
// - generated, gitignored output: compiled language packs (`npm run build` in a pack recreates
//   them) and catchup scratch;
// - eval fixture vaults, whose notes are indexed as written and must stay byte for byte
//   (the vi smoke vault keeps a CRLF note on purpose).
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../.prettierrc', import.meta.url), 'utf8'));

export default {
  ...root,
  overrides: [
    ...(root.overrides ?? []),
    {
      files: [
        'packages/*/build/**',
        '.work/**',
        'eval/vi/smoke-vault/**',
        'packages/ohs-lang-de/eval/vault/**',
      ],
      options: { requirePragma: true },
    },
  ],
};
