---
title: 'V05 — Bản vá P09 `unicode-inline-tags`'
status: completed
created: 2026-11-02
---

# V05 — Bản vá P09 `unicode-inline-tags`

- Trạng thái: done (chờ lead ghép vào `series.toml`)
- Nguồn: PRD mục 3.3 (lỗi regex tag `note-extractor.ts:55`) và 9.4 (P09); `phase-02-core-patches.md` V05.

## Mục tiêu (PRD 9.4)

> Tag nội dòng nhận mọi chữ Unicode

Tiêu chí hoàn thành:

- Test xanh: `test/vantt/unicode-inline-tags.test.ts`, cùng `test/indexer.test.ts` và `test/indexer-edge-cases.test.ts`; toàn bộ `vitest run` xanh.
- Probe `vantt/probes/unicode-inline-tags.mjs` trả 1 trên v0.17.2 nguyên gốc và 0 trên bản fork.
- Spec: `vantt/patches/0009-unicode-inline-tags.spec.md`; patch: `vantt/patches/0009-unicode-inline-tags.patch` (một commit `a17ab14` trên `vantt/work/unicode-inline-tags`).

## Các bước

- [x] Sửa regex trong `parseInlineTags` (`\p{L}`, `\p{N}`, `\p{M}`, cờ `u`).
- [x] Test đơn vị (13 test) và test hồi quy tag ASCII, tag số.
- [x] Lint, prettier, tsc, build, toàn bộ unit test xanh.
- [x] Probe: 0 trên fork, 1 trên upstream v0.17.2.
- [x] Spec theo mẫu PRD 9.3; xuất patch.
- [ ] Lead: thêm mục `[[patches]]` vào `series.toml` (đề xuất trong spec mục 8).
- [ ] Lead: quyết định có chạy `reindex --force` tự động sau catchup không (spec mục 6).

## Ghi chú

- Không tăng `INDEX_SCHEMA_VERSION`: không đổi schema, chỉ đổi kết quả tách tag. Note cũ cần `reindex --force`.
- Giữ quy tắc tag không bắt đầu bằng số (có test hiện hành).
