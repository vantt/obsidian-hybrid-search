---
title: 'V19: alias không dấu, đoạn trích chữ gốc (M5c)'
status: completed
created: 2026-11-02
---

# V19: alias không dấu, đoạn trích chữ gốc (M5c)

Trạng thái: hoàn tất (2026-11-02). Phụ thuộc: V13. PRD 10.2 (alias chính xác, đoạn trích, `matchedTerms`), 10.3.

## Phạm vi

- `aliasViews: ['fold']` của gói; `analyzeQuery` trả `aliasKeys.fold` = hình chiếu `fold` của câu tìm (cắt khoảng trắng đầu cuối, gộp dãy khoảng trắng), đúng cách lõi lưu khoá `project('fold', 'aliases'|'title', ...)`. Mã: `packages/ohs-lang-vi/src/alias.ts`, điểm móc trong `buildAnalysis` (`query.ts`) và `index.ts`.
- `matchedTerms` và đoạn trích chữ gốc do lõi (P01) làm từ bất biến token; việc của gói là giữ bất biến (đã có test). Kiểm bằng `vantt/eval/vi/check-snippets.mjs` qua OHS thật.

## Tiêu chí xong

- [x] `vi-alias` Hit@5 >= 0,8 (đạt 1,00; Hit@1 0,60 -> 0,93).
- [x] `vi-snippet`: 15/15 đoạn trích là chữ gốc và chứa chỗ khớp; `matchedTerms` 15/15 là chữ gốc của note, bỏ dấu ra khớp (tiền tố) từ trong câu tìm.
- [x] Hạng mục khác không giảm (Hit@5 giữ nguyên mọi hạng; nDCG@5 chỉ tăng).
- [x] Test gói: khoá alias khớp khoá lõi lưu (có dấu, không dấu, hoa thường, khoảng trắng, đ, title).

## Chạy lại

```bash
cd <cây OHS có P01> && node --import tsx <repo>/vantt/eval/vi/check-snippets.mjs --lang-pack <gói đã build> --vault <bản sao vault vi-search, không có file .db>
```
