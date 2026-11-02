---
name: ohs-upstream-review
description: Review a new upstream release of obsidian-hybrid-search for the vantt fork. For each fork patch, check whether upstream now solves the same problem (behaviour probes, not just diffs), compare search quality of upstream vs the previous and new fork builds (upstream eval, Vietnamese eval, optional private eval), run a blind LLM side-by-side judgement, and write vantt/reviews/<tag>.md for a human to decide. Use when upstream publishes a tag, when a catchup run reports conflicts, or when asked "upstream đã giải chưa", "bản mới của OHS có tốt hơn không".
---

# Review an upstream OHS release

You produce evidence and a recommendation. A human decides. Never edit `vantt/patches/series.toml`, never delete a patch, never push a release or a tag on your own.

Read first: `vantt/PRD.md` sections 9 (patches, probes), 11 (tests, eval), 12 (this process).

The script `vantt/scripts/review-upstream.mjs` does the machine part (builds, probes, eval, diffs, blind pairs). You do the reading and writing: Steps 3 to 6.

## Inputs
- `NEW`: upstream tag to review (default: highest stable `v<semver>` tag in the clone).
- `PREV`: previous release, either an upstream tag (`v0.17.1`) or a fork release tag (`v0.17.1-vantt.2`). Default: highest fork release tag below `NEW`, else the previous upstream tag.
- Optional `PRIVATE`: a directory on this machine holding `golden-set.json` and `vault/`. Never copy its note titles, paths or snippets into the report or the repo; report aggregate numbers only. The script already keeps only aggregates.

## Safety
- Run in a separate work clone, not in the main checkout: the script and catchup create worktrees and branches. Clone the shared repo, set its push URL to `DISABLE` (`git remote set-url --push origin DISABLE`), never push.
- Put clones, builds, vaults, model caches and logs on disk, not on tmpfs: set `TMPDIR` to a directory under the work area before long runs.
- Upstream pins npm via `devEngines`; the script installs that npm into `<clone>/vantt/.work/tools/` (same as catchup). `HUSKY=0` is set for every child.
- Eval writes a database into the vault directory it is given; the script only passes throw-away copies.
- Do not run upstream's `verify` profiles (they download models and take long).

## Step 1. Make the fork builds
The review compares `upstream@NEW`, `upstream@PREV`, `fork@PREV` and `fork@NEW`. Fork builds are the catchup branches `vantt/<upstream tag>`.
```bash
git fetch upstream --tags            # or pass --fetch to the script
node vantt/scripts/catchup.mjs --ref "$NEW" --skip-tests --skip-quality
node vantt/scripts/catchup.mjs --ref "$PREV_UP" --skip-tests --skip-quality
```
`--build-missing` on the review script does the same for absent branches. Tests and the quality gate are skipped here because the review runs its own probes and eval; say so in the report. If catchup exits 3 (conflict) for `NEW`, the script aborts that session, records no fork build for `NEW`, and probes and eval run without it. The report must then say which patch conflicts and why (read its spec, section 6).

## Step 2. Run the script
From the work clone:
```bash
TMPDIR=<dir on disk> node vantt/scripts/review-upstream.mjs --tag "$NEW" --prev "$PREV" \
  [--build-missing] [--lang-pack <ohs-lang-vi dir>] [--otf <otf.mjs>] [--private "$PRIVATE"]
```
It writes `vantt/reviews/$NEW.data.json` and, under `<clone>/vantt/.work/review-$NEW/blind/`, `pairs.json` (what you judge) and `key.json` (which side is A; do not open it before Step 4). Results of finished evals are cached under `results/`; `--force` reruns them, `--skip-eval` skips all eval.

Data layout (read the file, do not guess): `new`, `prev`, `trees` (ref, sha, built, error), `upstream` (commits, diffstat, changelog diff, `hook_files_changed`), `patches[]` (`apply.new|prev`, `upstream_changes`, `probe_results.up_new|up_prev|fork_prev|fork_new`, `suggestion`, `fork_probe_ok`), `quality.<set>` (`sides`, `rows`, `flags`), `blind`, `warnings`.

Every patch in `series.toml` has a probe result; a probe that did not run says why (`skipped`, `error` with output). Treat `error` as an environment problem to report, never as "solved".

## Step 3. Read what changed and judge each patch
1. Read `upstream.commits`, `changelog_diff` and the release notes (`gh release view "$NEW" --repo flowing-abyss/obsidian-hybrid-search`). In `upstream.hook_files_changed` and each patch's `upstream_changes`, open the commits (`git show <sha>`) that touch hook files (`searcher.ts`, `db.ts`, `search-queries.ts`, `chunker.ts`, `embedder.ts`, `config.ts`) and summarise each in one sentence: what it does, which patch or language-pack hook it may affect (PRD 10.2).
2. Probes (PRD 9.2): exit 0 on a pristine upstream tree means upstream solved the user-visible problem, maybe with different code; 1 means still present; 2 means could not test. A probe of `fork_new` that is not `solved` is a regression of the fork: say so first.
3. For `up_new = solved`: read the spec section "3. Bất biến" and check every invariant against upstream's behaviour (run by hand if needed). Recommend "bỏ" only if all hold; otherwise "giữ" or "viết lại trên cơ chế của upstream" and name the failing invariant. Compare `up_prev` too: a change from `present` to `solved` between the two tags is the news.
4. For `apply.new = conflict`: the patch needs a rewrite whatever the probe says; link the upstream commit that causes it.

## Step 4. Quality tables
`quality.<set>.rows` has nDCG@5, MRR, Hit@1, Hit@5, Recall@10 per category for `up_new`, `fork_prev`, `fork_new` (the vi set also has `fork_new_nopack`). `delta` is `fork_new - up_new`; `delta_vs_prev` is `fork_new - fork_prev`. `flags` lists nDCG@5 cells where upstream beats the new fork by more than 0.02 and where the new fork is below the previous one by more than 0.02: explain every flag. All sides ran on this machine in this run; numbers from other machines are not comparable (ONNX differs across CPUs). Put nDCG@5 and Hit@5 in the report tables, the rest stays in the data file.

## Step 5. Blind side-by-side
`pairs.json` has up to 20 Vietnamese queries (largest score differences first, then `vi-unaccented`, then random), each with the top 5 titles and snippets of two lists A and B, side order shuffled. Do not read `key.json` and do not look at the metric tables for those queries before judging.

For each pair answer: "Danh sách nào giúp người tìm thấy note họ cần nhanh hơn?" with one of (PRD 12.4):

| Verdict | Meaning |
|---|---|
| `A++` | A tốt hơn rõ |
| `A+` | A hơi tốt hơn |
| `tie` | ngang |
| `B+` | B hơi tốt hơn |
| `B++` | B tốt hơn rõ |

plus one sentence of reason. Judge only from titles and snippets; you do not know which side is the fork and you do not read code. Write `verdicts.json` next to `pairs.json`: `{"p01": "A+", ...}` (reasons in a separate `reasons.json` if you want to keep them). Then unblind:
```bash
node vantt/scripts/review-upstream.mjs --tag "$NEW" --unblind
```
This stores the tally in `blind.tally` of the data file: `fork_clear`, `fork_slight`, `tie`, `other_slight`, `other_clear`, `fork_wins`, `fork_losses`. The pair here is `upstream@NEW` (other) vs `fork@NEW`. This is a secondary signal: when it disagrees with the metrics say so and show both. A judge who sees only titles and snippets cannot see rank-1 correctness the eval knows; do not over-read a tie.

For the private set, judge locally the same way and write only counts to the report.

## Step 6. Report
Write `vantt/reviews/<NEW>.md`, Vietnamese, plain and short, with exactly these sections (PRD 12.5):

```markdown
# Upstream <NEW> (so với fork <PREV>)
## Tóm tắt
- Nên nâng bản fork lên <NEW> không: …
- Bản vá có thể bỏ: …
- Rủi ro chính: …
## Thay đổi của upstream liên quan tới fork
## Bản vá
| id | Probe trên upstream | Áp được không | Đề xuất (giữ / bỏ / viết lại) | Bằng chứng |
## Chất lượng tìm
| Bộ eval | Hạng mục | upstream mới | fork trước | fork mới | Chênh (fork mới − upstream mới) |
## So sánh định tính (mù)
| Cặp so | Fork thắng | Hoà | Fork thua | Ghi chú |
## Việc cần người quyết
```

Put numbers in tables. Every recommendation carries its evidence (probe output, metric, commit). State how the fork builds were made (tests and quality gate skipped or not), the machine, and any `warnings` from the data file. Keep the machine data in `vantt/reviews/<NEW>.data.json`.

Then open an issue on the fork and a PR for the report; do not merge it:
```bash
gh issue create --repo vantt/obsidian-hybrid-search --title "[review] $NEW" --label review \
  --body "Báo cáo: vantt/reviews/$NEW.md (nhánh review/$NEW). Cần quyết: …"
```
Commit the report and data file on a branch `review/$NEW` and open a PR into `master`.

## Step 7. Clean up
The script removes its worktrees when it ends (`--keep` keeps them). Delete `<clone>/vantt/.work/review-$NEW/` once the human has read the report; stop any process you started.

## Hand-run equivalents (script missing or broken)
- Build trees: `git worktree add --detach <dir> <ref>`; link or install `node_modules`; `npm run build`.
- Probe: `node vantt/probes/<id>.mjs --ohs <tree>` (0 solved, 1 present, 2 could not test).
- Applicability: apply `vantt/patches/*.patch` in series order with `git apply --3way` on a worktree of the tag.
- Upstream diff: `git log --oneline OLD..NEW -- <touches>`.
- Eval: `node --import tsx eval/evaluate.ts --vault <copy> --golden-set <golden> --output <out> --k 10` inside each tree; Vietnamese set through `node vantt/eval/vi/run-eval.mjs --ohs <tree> [--lang-pack <pack dir>] --out <file>`; compare with `--compare a.json b.json`.
