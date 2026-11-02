---
phase: 1
title: "Thực hiện P01"
status: completed
---

# Phase 1: Thực hiện P01

Worktree: `/tmp/claude-1000/-home-vantt-projects-obsidian-hybrid-search/c4caee3c-648b-4dec-9db9-7046ba7beb6d/scratchpad/wt-v11`, nhánh `vantt/work/p01-language-pack-api` từ tag `v0.17.2`.

## Bước

1. `src/language/`: `types.ts` (hợp đồng), `loader.ts` (nạp, kiểm, cache, trạng thái), `noop.ts`, `tokens.ts` (bộ tách mô phỏng unicode61, ánh xạ token).
2. `storage/`: `language-tables.ts` (DDL, ghi theo note), `language-queries.ts` (đọc trạng thái, dựng lại view, truy vấn view, `fts5vocab`); móc vào `upsertNote`, `replaceActiveIndex`; tăng `INDEX_SCHEMA_VERSION`.
3. `indexing/`: `language-views.ts` (tính `lexical`, đồng bộ view); móc vào `indexFile`, `prepareContentOwner`, `reindex --force`, `openIndexDatabase`.
4. `search/`: `language-search.ts` (phân tích câu, nhánh view, alias view, đoạn trích chữ gốc, `rescore`); móc vào `searchByQuery`, `search`, cache, `rrfFusion`.
5. Giao tiếp: `explain` ở CLI, MCP, stdio, contracts; `language_pack` trong status.
6. Ranh giới: `dependency-cruiser.config.cjs`, `test/architecture/check.ts`, `test/architecture-boundaries.test.ts`, `ARCHITECTURE.md`.
7. Test `test/vantt/language-pack*.test.ts`, gói giả `test/vantt/fixtures/lang-upper/`; snapshot không gói sinh trên upstream.
8. Probe, spec, xuất patch.

## Kiểm

`npm test`, `npm run lint`, `npm run build`, `npm run knip`, `npm run format:check`; probe trên cả hai bản build.

## Rủi ro

- Bộ tách JS lệch tokenizer của SQLite ở ký tự hiếm: chỉ làm lệch đoạn trích, có đường rơi về.
- Hai tiến trình cấu hình gói khác nhau: giống lệch `content_policy` của upstream (chủ mới khởi động chuyển trạng thái, tiến trình theo sau báo lỗi).
