---
name: ohs-upstream-review
description: Review a new upstream release of obsidian-hybrid-search for the vantt fork. For each fork patch, check whether upstream now solves the same problem (behaviour probes, not just diffs), compare search quality of upstream vs the previous and new fork builds (upstream eval, Vietnamese eval, optional private eval), run a blind LLM side-by-side judgement, and write vantt/reviews/<tag>.md for a human to decide. Use when upstream publishes a tag, when a catchup run reports conflicts, or when asked "upstream đã giải chưa", "bản mới của OHS có tốt hơn không".
---

# Review an upstream OHS release

You produce evidence and a recommendation. A human decides. Never edit `vantt/patches/series.toml`, never delete a patch, never push a release on your own.

Read first: `vantt/PRD.md` sections 9 (patches, probes), 11 (tests, eval), 12 (this process).

## Inputs
- `NEW`: the upstream tag to review (default: highest `v<semver>` tag on `upstream` without `-`).
- `PREV`: the latest fork release (`gh release list --repo vantt/obsidian-hybrid-search --limit 1`), e.g. `v0.17.2-vantt.1`, and its upstream tag `PREV_UP` (e.g. `v0.17.2`).
- Optional `PRIVATE`: path to a private golden set and vault on this machine. Never copy its note titles, paths or snippets into the report or the repo; report aggregate numbers only.

## Safety
- Work in `git worktree`s under `vantt/.work/` (gitignored). Do not touch the main checkout's branch.
- `HUSKY=0` for every npm command. Do not run upstream's `verify` profiles unless asked (they download models and take long).
- Eval writes a database into the vault directory it is given. Only point it at copies under `vantt/.work/`.

## Step 0. Fast path
If `vantt/scripts/review-upstream.mjs` exists:
```bash
node vantt/scripts/review-upstream.mjs --tag "$NEW" --prev "$PREV" ${PRIVATE:+--private "$PRIVATE"}
```
It writes `vantt/reviews/$NEW.data.json`. Go to Step 5. Otherwise do Steps 1–4 by hand.

## Step 1. Three builds
```bash
git fetch upstream --tags
mkdir -p vantt/.work
git worktree add vantt/.work/up-new "$NEW"
git worktree add vantt/.work/fork-prev "$PREV"            # tag on the fork's release branch
git worktree add vantt/.work/fork-new "vantt/$NEW" 2>/dev/null || echo "no fork build for $NEW yet"
for d in up-new fork-prev fork-new; do
  [ -d "vantt/.work/$d" ] && (cd "vantt/.work/$d" && HUSKY=0 npm ci --ignore-scripts=false && npm run build)
done
```
If `vantt/$NEW` does not exist, run catchup first (`node vantt/scripts/catchup.mjs --ref "$NEW"`, see the `ohs-catchup` skill). If it stops on a conflict, still review `up-new` vs `fork-prev` and record the conflict in the report.

## Step 2. What changed upstream
```bash
git log --oneline "$PREV_UP".."$NEW"
git diff --stat "$PREV_UP".."$NEW"
```
Also read the GitHub release notes (`gh release view "$NEW" --repo flowing-abyss/obsidian-hybrid-search`) and `CHANGELOG.md` if present.
For each patch in `vantt/patches/series.toml`, list upstream commits that touch its `touches` files. Always check changes in `src/search/searcher.ts`, `src/storage/db.ts`, `src/storage/search-queries.ts`, `src/content/chunker.ts`, `src/inference/embedder.ts`, `src/runtime/config.ts`: these are where the language pack hooks live (PRD 10.2). Summarise each relevant change in one sentence: what it does and which patch or hook it might affect.

## Step 3. Probes: has upstream solved the problem?
For each patch with a `probe`:
```bash
node vantt/probes/<id>.mjs --ohs vantt/.work/up-new     # 0 = solved upstream, 1 = still present, 2 = could not test
node vantt/probes/<id>.mjs --ohs vantt/.work/fork-new   # must be 0
```
If a probe file does not exist yet, test the problem by hand from the patch spec section "1. Vấn đề" (the spec gives a repro). Record exactly what you ran and what you saw.

A probe result of 0 on upstream means upstream solved the user-visible problem, maybe with different code. Then read the spec section "6. Khi xung đột hoặc khi upstream đổi": check every invariant in section "3. Bất biến" against upstream's behaviour. Recommend "drop" only if all invariants hold; otherwise "keep" or "rewrite on top of upstream's mechanism", and say which invariant fails.

## Step 4. Quality, three ways
Use the same machine for all runs; ONNX results differ across CPU architectures. Run without rerank unless the PRD says otherwise.

Golden sets:
- Upstream: `fixtures/obsidian-help` (prepare with `npm run eval:prepare-obsidian-help` inside each worktree).
- Vietnamese: `vantt/eval/vi/` (vault and `golden-set.json`).
- Private (optional): `$PRIVATE`.

For each worktree `W` and each set, copy the vault to `vantt/.work/vaults/<W>-<set>/` and run:
```bash
(cd vantt/.work/$W && npm run eval -- --vault <vault copy> --golden-set <golden.json> --k 10 --output ../results/$W-<set>.json)
```
For fork builds, run the Vietnamese set twice: with `OHS_LANGUAGE_PACK=<abs path to vantt/packages/ohs-lang-vi/dist>` and without it. Upstream has no pack.

Build a table per set and per `category`: nDCG@5, MRR, Hit@1, Hit@5, Recall@10. Flag every cell where `up-new` beats `fork-new` by more than 0.02 nDCG@5, and every category where `fork-new` is below `fork-prev` by more than 0.02.

## Step 5. Blind side-by-side (LLM judgement)
Pick up to 20 queries from the Vietnamese set: those with the largest score differences between `up-new` and `fork-new` first, then the category `vi-unaccented`, then random. For each query take the top 5 results (title and snippet) of the two sides. Randomly assign them to A and B. Record the mapping in a scratch file you do not read until the end.

Judge each pair with: "Which list helps the person find the note they need faster?" Answer one of: A clearly better, A slightly better, tie, B slightly better, B clearly better, plus one sentence why. Judge only from titles and snippets. Then unblind and count wins, ties and losses for the fork.

For the private set, judge locally the same way, but write only the counts to the report.

Treat this as a secondary signal. When it disagrees with the metrics, say so and show both.

## Step 6. Report
Write `vantt/reviews/<NEW>.md` with exactly these sections:

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

Write in Vietnamese, plain and short. Put numbers in tables. For every recommendation give the evidence (probe output, metric, commit). Keep the machine data in `vantt/reviews/<NEW>.data.json`.

Then open an issue on the fork:
```bash
gh issue create --repo vantt/obsidian-hybrid-search --title "[review] $NEW" --label review \
  --body "Báo cáo: vantt/reviews/$NEW.md (nhánh <branch>). Cần quyết: …"
```
Commit the report on a branch `review/$NEW` and open a PR into `master`; do not merge it.

## Step 7. Clean up
```bash
git worktree remove vantt/.work/up-new vantt/.work/fork-prev vantt/.work/fork-new --force
```
Keep `vantt/.work/results/` until the human has read the report.
