---
name: ohs-catchup
description: Build the vantt fork release branch `vantt/<tag>` from an upstream obsidian-hybrid-search tag with vantt/scripts/catchup.mjs, apply the patch series, resolve patch conflicts from the patch spec, and re-export fixed patches to master. Use when upstream publishes a tag, when CI catchup fails, when catchup exits 3 (conflict), or when asked "đuổi theo upstream", "dựng nhánh vantt/<tag>", "bản vá xung đột".
---

# Catch up with upstream OHS

`vantt/scripts/catchup.mjs` turns an upstream tag into the release branch `vantt/<tag>`: upstream tag + one commit with the fork files + one commit per patch + version stamp + removal of upstream workflows. You run it, fix conflicts by rewriting patches against their spec, and hand the refreshed patch files back to `master`.

Read first: `vantt/PRD.md` sections 4.3 (version), 6 (catchup), 9.1 (`series.toml`), 9.3 (spec template), 11.1 (test tiers).

## Rules
- Never `git push --tags`. The only tag ever pushed is a release tag `vX.Y.Z-vantt.N`, and only by the release workflow or when the human asks.
- Never fetch or push other upstream branches. Catchup fetches `upstream master` plus tags and builds only tags reachable from `upstream/master`.
- Commits on `master` touch only `vantt/`, `.claude/skills/ohs-*`, `.github/workflows/vantt-*`. OHS code changes only through patches.
- Every command runs with `HUSKY=0` (catchup sets it for its children).
- `--skip-tests` and `--skip-quality` are for local experiments only; CI never uses them.
- Upstream pins npm via `devEngines` (e.g. 12.2.0). Catchup installs that npm into `vantt/.work/tools/` and puts it first on `PATH` for build and tests; you do not need to change the global npm.
- The build runs `npm ci --ignore-scripts && npm rebuild`: upstream's root `prepare` (agent-config symlinks into `.claude/`) refuses when `.claude/skills` is a real directory holding our `ohs-*` skills, and the release does not need it. Dependencies' install scripts (native modules) still run via `npm rebuild`.

## Step 1. Run
Start on `master` (or any branch) with no uncommitted changes to tracked files. Untracked files are ignored and never copied onto the release branch: catchup copies only the tracked `vantt/` and `.claude/skills/ohs-*` files.

```bash
node vantt/scripts/catchup.mjs --dry-run                 # target, branch, which patches apply / skip / conflict
node vantt/scripts/catchup.mjs --with-lang vi --json     # newest stable tag on upstream/master
node vantt/scripts/catchup.mjs --ref v0.17.2 --json      # a specific tag
node vantt/scripts/catchup.mjs --ref upstream/master     # early test on upstream master -> vantt/upstream-master-<sha7>
node vantt/scripts/catchup.mjs --ref v0.17.2 --clean     # rebuild even if the branch is already green
```
`--dry-run` neither fetches nor changes anything; fetch first if you need the newest tags. A run whose branch, target sha, `series.toml`, patch files and language packs match the last green report (`vantt/reports/catchup-<tag>.json`) prints "already green" and exits 0 at once.

When the run ends (green or failed), catchup puts you back on the branch you started from. Look at the result with `git log --oneline <tag>..vantt/<tag>` or `git checkout vantt/<tag>`.

| Exit | Meaning | What to do |
|---|---|---|
| 0 | green | push the branch if asked (`git push origin vantt/<tag>`); no tags |
| 2 | usage: bad flag, dirty tree, session already open, bad `series.toml`, unknown or off-master ref | fix the cause; for an open session use `--continue` or `--abort` |
| 3 | a patch conflicts; you are on `vantt/<tag>` mid-session | Step 2 |
| 4 | `npm ci` or build failed | read the log; usually a patch broke the build: fix the patch (Step 4) |
| 5 | capability check or tests failed (T1 upstream, T2 patch `test_command`, T3 language pack, T4 invariance) | see `tests` in the report; fix the patch or the pack |
| 6 | quality gate (T5) failed | read `quality` in the report; a human decides (fix or lower a baseline by reviewed PR) |
| 7 | other error (git, file system) | read the message; if a session is open, `--abort` |

Tiers whose script or package does not exist yet (`vantt/scripts/invariance.mjs`, `vantt/scripts/quality-gate.mjs`, `vantt/packages/ohs-lang-<id>`) report `skipped` and never fail the run.

## Step 2. Resolve a conflict (exit 3)
Catchup prints the failing patch, its spec, the conflicted files and the next commands, and writes `vantt/.catchup-state.json`. The working tree is on `vantt/<tag>` with conflict markers.

1. Read the patch spec (`metadata_file`, e.g. `vantt/patches/0002-db-path.spec.md`): section "3. Bất biến" (what must stay true) and "4. Điểm chạm" (where the code hooks in), and "6. Khi xung đột hoặc khi upstream đổi".
2. See what upstream changed in those files: `git log -p <previous tag>..<tag> -- <files>` (catchup prints the exact command).
3. Rewrite the change on top of the new upstream code so that every invariant holds. Do not force the old diff back in. Keep the patch small and limited to its own purpose.
4. Run the patch's own test if it can run before the build (`test_command` in `series.toml`), then:
   ```bash
   git add <files>
   node vantt/scripts/catchup.mjs --continue
   ```
   `--continue` refuses while files are unmerged, conflict markers are staged, or changes are unstaged. It commits the resolution with the patch name and `Patch-Id: <id>`, applies the remaining patches, builds and tests. Another conflict means another round of this step.

**Upstream already solves it.** If upstream now has an equivalent mechanism that satisfies every invariant in the spec (check with the probe `vantt/probes/<id>.mjs` if it exists):
```bash
git reset --hard HEAD
node vantt/scripts/catchup.mjs --continue     # records SKIPPED_UPSTREAM_HAS_IT for this patch
```
Then, on `master`, set `upstream_status = "merged"` for the patch in `vantt/patches/series.toml`, add a note to its spec, and tell the consumer project to switch to upstream's mechanism.

**Give up.** `node vantt/scripts/catchup.mjs --abort` resets the release branch to what it was before the run (or deletes it if it is new), returns to the starting branch and removes the session files. The repo is clean afterwards.

## Step 3. Re-export the fixed patches (PRD 6.4)
After a session with a fixed conflict goes green, catchup re-exports every applied patch from its commit (`git format-patch --zero-commit --no-signature`) into `vantt/patches/` of the branch you started from, and prints the commands. Commit them on `master` so the next catchup applies cleanly:
```bash
git add vantt/patches/*.patch
git commit -m "chore(vantt): refresh patches for <tag>"
```
The report lists them in `reexported_patches`; CI opens a PR with that title instead.

## Step 4. Change a patch on purpose
Work on a branch from the release branch, which already has every earlier patch in the series:
```bash
git checkout -b work/<id> vantt/<tag>
# edit, test (test/vantt/<id>.test.ts lives inside the patch)
git commit -m "<name from series.toml>"
git format-patch -1 --stdout --zero-commit --no-signature > /tmp/<file>.patch
git checkout master && cp /tmp/<file>.patch vantt/patches/<file>.patch
```
A patch must touch only its own concern. If it changes a file used by a later patch (`src/search/searcher.ts`, `src/storage/db.ts`), rebuild the later patches in series order after it.

## `series.toml` entries
Format and the planned order (P00, P01, P02, P03, P04, P09, P05, P06, P07) are documented at the top of `vantt/patches/series.toml`. Required: `id` (kebab-case, unique), `name` (commit subject), `patch_file`. Used by catchup: `upstream_status = "merged"` (skip), `test_command` (T2), `capability_check` (after build). Patches are applied in file order.

## Version
Catchup writes `version = "<tag>-vantt.<N>"` and `"vanttFork": true` into `package.json` (and the root of `package-lock.json`) on the release branch. `N` is the highest existing tag `v<tag>-vantt.N` in the local repo, plus one when `vantt/patches` or a language pack changed since that tag; `1` when none exists. Non-tag refs get `<version>-vantt.0.g<sha7>`. Fetch the fork's release tags first (`git fetch origin --tags`) if your clone may be stale. P00 `fork-identity` reads these fields; it never hardcodes a version.

## Report
`vantt/reports/catchup-<tag>.json` (also printed with `--json`, copied with `--report <file>`): `status`, `target_ref`, `target_sha`, `release_branch`, `branch_sha`, `version`, `series_sha256`, `patches_sha256`, `lang_packs`, `patches[]` (`APPLIED | SKIPPED_UPSTREAM_HAS_IT | CONFLICT`, commit, `resolved` after a hand fix), `capability`, `tests` (`upstream`, `patches`, `lang_<id>`, `invariance`), `quality`, `failed_patch`, `conflicted_files`, `reexported_patches`, `started_at`, `finished_at`. `vantt/reports/` is gitignored; add a released report with `git add -f`.

## Sync `master` with upstream (PRD 6.6)
Catchup never touches `master`. The CI workflow (or you, when asked) does:
```bash
git fetch upstream +refs/heads/master:refs/remotes/upstream/master
git checkout master
git merge --ff-only upstream/master || git rebase upstream/master   # rebase only fork commits (vantt/, .claude/skills/ohs-*, .github/workflows/vantt-*)
```
Check that no fork commit touches an upstream file before pushing `master`.

## Tests of the script
```bash
npx vitest run --config vantt/scripts/vitest.config.mjs
```
Runs on throwaway git repos (no network): tag selection, empty series, fake patch, skip when upstream has it, `-vantt.N`, `series.toml` errors, and the conflict rehearsal (exit 3, `--abort`, `--continue`, re-export). If the local npm differs from upstream's `devEngines` version, run it from outside the repo: `cd /tmp && npx -y npm@<version> exec --prefix <repo> -- vitest run --config <repo>/vantt/scripts/vitest.config.mjs`.
