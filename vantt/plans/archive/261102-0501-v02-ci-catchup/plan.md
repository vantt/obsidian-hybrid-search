---
title: 'v02-ci-catchup'
description: 'Workflow vantt-catchup (cron, dispatch, issue khi hỏng, đồng bộ master) và vantt-pr-check'
status: completed
priority: P1
effort: '0.5d'
tags: [ci, vantt]
created: 2026-11-02
---

# v02-ci-catchup

PRD 5, 6.6, 7.1, 7.2, 7.4. Phase: [phase-01-start.md](./phase-01-start.md).

## Kết quả

- `.github/workflows/vantt-catchup.yml`: chạy `catchup.mjs --with-lang vi --json`, đẩy nhánh (`--force-with-lease`) và tag `v<version>` (không `--tags`; tag đã có với cùng cây thì không làm gì; khác cây thì lỗi), PR cho bản vá xuất lại, artifact `catchup-report`, issue không trùng, đồng bộ `master` (ff-only hoặc rebase).
- `.github/workflows/vantt-pr-check.yml`: commit không-merge trong `upstream/master..HEAD` chỉ được chạm `vantt/`, `.claude/skills/ohs-*`, `.github/workflows/vantt-*`; chạy `catchup.mjs --dry-run`.
- Issues đã bật. `gh` trong workflow phải đặt `GH_REPO` (mặc định nó chọn repo cha flowing-abyss).
- Lần hỏng cố ý (`simulate_failure`): 1 issue, lần hai bình luận; đã đóng issue thử.

## Chưa xanh

Lần chạy thật bị `TESTS_FAILED` ở test hiệu năng của gói `ohs-lang-vi` (ngưỡng 200 ms, runner GitHub chậm hơn): việc của chủ gói, không phải của workflow.
