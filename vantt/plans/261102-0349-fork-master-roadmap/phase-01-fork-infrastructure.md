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

## File sở hữu

- V00: `vantt/.gitignore`, `vantt/README.md`.
- V01: `vantt/scripts/catchup.mjs`, `vantt/scripts/lib/*`, `vantt/scripts/test/catchup*.test.*`, `.claude/skills/ohs-catchup/`.
- V02: `.github/workflows/vantt-catchup.yml`, `.github/workflows/vantt-pr-check.yml`.
- V03: `vantt/scripts/bundle.mjs`, `.github/workflows/vantt-bundles.yml`.

## Todo

- [ ] V00 cài đặt fork xong
- [ ] V01 catchup và skill `ohs-catchup`
- [ ] V02 CI catchup và pr-check, Actions chỉ còn `vantt-*`
- [ ] V03 gói dựng sẵn 4 nền và smoke

## Success Criteria

- V00: `gh workflow list --repo vantt/obsidian-hybrid-search --all` chỉ có `vantt-*` ở trạng thái active (kiểm sau V02).
- V01: chạy trên `v0.17.2` ra nhánh `vantt/v0.17.2` xanh với chuỗi bản vá rỗng và với bản vá giả; diễn tập xung đột trả mã 3, `--abort` trả repo sạch, `--continue` sau khi sửa thì xanh và bản vá được xuất lại.
- V02: chạy tay xanh; một lần hỏng cố ý mở đúng một issue.
- V03: Release có 4 gói kèm sha256; smoke xanh cả 4 nền; kích thước được ghi.

## Risk

- Checkout tag làm mất `vantt/`: sao ra `vantt/.work/` rồi chép lại (bài học herdr, PRD 4.1).
- Đẩy nhánh có workflow bị GitHub chặn: gỡ workflow upstream khỏi nhánh phát hành, cần PAT `VANTT_PUSH_TOKEN` nếu vẫn bị chặn (PRD 5 bước 7).
- Gatekeeper, SmartScreen chặn trong smoke: báo user (Q4), không tự mua chứng chỉ.
