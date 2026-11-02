---
phase: 1
title: "Phase 1: Hạ tầng fork và theo upstream"
status: todo
priority: P1
effort: "5d"
dependencies: []
---

# Phase 1: Hạ tầng fork và theo upstream

## Overview

Dựng cỗ máy giữ fork luôn theo upstream: cài đặt fork, script catchup dựng nhánh phát hành từ mỗi tag upstream và áp chuỗi bản vá, CI chạy catchup và mở issue khi hỏng, gói dựng sẵn cho 4 nền. Phục vụ G1, G4. Mọi bản vá ở phase 2, 3 cần V01 để được áp và kiểm.

## Việc

| ID | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|
| V00 | Phần còn lại của cài đặt fork: `.gitignore` cho `vantt/` (`vantt/.catchup-state.json`, `vantt/reports/*.json` trừ bản phát hành, `vantt/.work/`), cách clone submodule trên CI, ghi trạng thái vào `vantt/README.md`. Bật Actions và tắt workflow upstream làm cùng V02 khi đã có workflow `vantt-*` | — | rẻ | 0,5 | 5 |
| V01 | `vantt/scripts/catchup.mjs` (Node ESM, không phụ thuộc), test vitest trên repo git tạm (PRD 11.2, T8 diễn tập xung đột), skill `.claude/skills/ohs-catchup/SKILL.md`, xuất lại bản vá sau khi sửa xung đột | V00 | mạnh | 2 | 4.1, 6, 11.2 |
| V02 | `.github/workflows/vantt-catchup.yml` (cron và chạy tay, chỉ trên `vantt/obsidian-hybrid-search`, mở issue khi hỏng, không trùng), `vantt-pr-check.yml` (chặn commit trên `master` chạm file upstream). Sau đó bật Actions, tắt `ci.yml`, `auto-tag.yml`, `release.yml`, `update-deps.yml` | V01 | vừa | 0,5 | 5, 7.1, 7.2, 7.4 |
| V03 | `vantt/scripts/bundle.mjs` và `vantt-bundles.yml`: gói cho Windows x64, macOS ARM, macOS Intel, Linux x64, sha256, smoke test trên runner sạch (gồm cả `ohs serve --stdio`), ghi kích thước | V02 | vừa | 2 | 7.3, 8 |

## Quy tắc riêng

- Catchup chỉ chọn tag nằm trên `upstream/master` (`git merge-base --is-ancestor`) và không bao giờ `git push --tags`; chỉ đẩy tag `vX.Y.Z-vantt.N` (PRD 5).
- Remote `upstream` đã thêm, chỉ theo `master`, đẩy bị chặn. Không fetch nhánh khác của upstream.
- Bật Actions và tạo release đầu tiên là việc ra ngoài: lead xin user xác nhận trước.
- Issues trên fork đang tắt (mặc định của fork). User chốt 2026-11-02: agent V02 bật lại bằng `gh repo edit vantt/obsidian-hybrid-search --enable-issues` trước khi thử lần hỏng cố ý, vì catchup báo lỗi và review upstream đều dựa vào issue.
- User đồng ý 2026-11-02 cho V03 tạo GitHub Release đầu tiên.
- Actions đã bật 2026-11-02 theo yêu cầu user; `ci.yml`, `auto-tag.yml`, `release.yml` ở trạng thái `disabled_manually`, `update-deps.yml` ở `disabled_fork`. V02 chỉ còn thêm workflow `vantt-*` và kiểm lại danh sách.

## File sở hữu

- V00: `vantt/.gitignore`, `vantt/README.md`.
- V01: `vantt/scripts/catchup.mjs`, `vantt/scripts/lib/*`, `vantt/scripts/test/catchup*.test.*`, `.claude/skills/ohs-catchup/`.
- V02: `.github/workflows/vantt-catchup.yml`, `.github/workflows/vantt-pr-check.yml`.
- V03: `vantt/scripts/bundle.mjs`, `.github/workflows/vantt-bundles.yml`.

## Todo

- [x] V00 cài đặt fork xong
- [x] V01 catchup và skill `ohs-catchup`
- [ ] V02 CI catchup và pr-check, Actions chỉ còn `vantt-*`
- [ ] V03 gói dựng sẵn 4 nền và smoke

## Success Criteria

- V00: `gh workflow list --repo vantt/obsidian-hybrid-search --all` chỉ có `vantt-*` ở trạng thái active (kiểm sau V02).
- V01: chạy trên `v0.17.2` ra nhánh `vantt/v0.17.2` xanh với chuỗi bản vá rỗng và với bản vá giả; diễn tập xung đột trả mã 3, `--abort` trả repo sạch, `--continue` sau khi sửa thì xanh và bản vá được xuất lại.
- V02: chạy tay xanh; một lần hỏng cố ý mở đúng một issue.
- V03: Release có 4 gói kèm sha256; smoke xanh cả 4 nền; kích thước được ghi.

## Ghi chú sau V01

- Nhánh `vantt/v0.17.2` đã đẩy lên origin (catchup thật, xanh, `0.17.2-vantt.1`).
- Upstream đòi npm 12.2.0 qua `devEngines`; catchup tự cài npm 12.2.0 vào `vantt/.work/tools/`. Agent chạy `npm`/`npx` trong cây OHS phải dùng npm 12.2.0 (`npx -y npm@12.2.0 ...`). CI (V02, V03) cũng phải ghim npm 12.2.0.
- Build chạy `npm ci --ignore-scripts && npm rebuild` vì `prepare` của upstream từ chối khi `.claude/skills` là thư mục thật.
- Móc T4/T5 cho V12: `node vantt/scripts/{invariance,quality-gate}.mjs --target-ref <ref> --target-sha <sha> --branch <branch> --json [--with-lang <id>]`, mô tả ở đầu `vantt/scripts/lib/tiers.mjs`.
- Đồng bộ `master` với upstream (PRD 6.6) đã viết trong skill `ohs-catchup`; V02 tự động hoá.

## Risk

- Checkout tag làm mất `vantt/`: sao ra `vantt/.work/` rồi chép lại (bài học herdr, PRD 4.1).
- Đẩy nhánh có workflow bị GitHub chặn: gỡ workflow upstream khỏi nhánh phát hành, cần PAT `VANTT_PUSH_TOKEN` nếu vẫn bị chặn (PRD 5 bước 7).
- Gatekeeper, SmartScreen chặn trong smoke: báo user (Q4), không tự mua chứng chỉ.
