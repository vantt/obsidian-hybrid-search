// ESLint resolves the config nearest each linted file, so this file governs vantt/**.
// It reuses the root config unchanged and only skips generated, gitignored output:
// compiled language packs (`npm run build` in a pack recreates them) and catchup scratch.
import root from '../eslint.config.js';

export default [...root, { ignores: ['packages/*/build/**', '.work/**'] }];
