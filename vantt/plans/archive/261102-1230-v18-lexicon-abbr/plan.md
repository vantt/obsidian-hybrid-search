---
title: "v18-lexicon-abbr"
description: "Gói ohs-lang-vi M5b: lexicon (đồng nghĩa, viết tắt, từ ghép), abbr.ts và lệnh learn-abbr"
status: completed
priority: P1
effort: "2,5d"
tags: [vi-pack, v18]
created: 2026-11-02
---

# V18: lexicon, viết tắt, `learn-abbr`

## Phạm vi (PRD 10.3, Q8)

`lexicon.ts`: đọc `_ohs/lexicon.md` qua `QueryContext.vaultPath`; ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`; `## Chờ duyệt` bị bỏ qua. `abbr.ts` và lệnh `ohs-lang-vi learn-abbr --vault <dir>` (`bin` của package) đề xuất viết tắt, ghi dưới `## Chờ duyệt`. Móc nối ở `query.ts` (một lời gọi) và `index.ts` (`queryCacheKey`, chữ ký).

## Tiêu chí xong

- [x] `vi-synonym` Hit@5 0,13 → 0,80; `vi-abbr` 0,93 → 1,00 (≥ 0,8).
- [x] Đổi đồng nghĩa hay viết tắt: `signature()` không đổi (test), `queryCacheKey()` đổi; đổi từ ghép: `signature()` đổi.
- [x] Không hạng mục khác tụt (Δ nDCG@5 = 0,000 ở 15 hạng còn lại so với V13).
- [x] Định dạng khớp lexicon mẫu của preset `vi-search` (đã chạy eval trên đó).
- [x] Test: parse, mục chờ duyệt không dùng, đổi file đổi `queryCacheKey()`, `learn-abbr` (mẫu định nghĩa, cụm hay gặp, không đề xuất trùng, không ghi đè mục chính, chạy lại không đổi gì, `--dry-run`, lỗi tham số).

## Quyết định

1. Đồng nghĩa hai chiều; viết tắt một chiều (viết tắt → dạng đầy đủ). Chiều ngược sẽ thêm token ngắn như `kh`, mà lõi tìm tiền tố (`"kh"*`) nên kéo cả "khách", "không"...
2. Chữ có dấu trong câu phải khớp đúng dấu; chữ không dấu khớp bỏ dấu (đo: so khớp bỏ dấu cho mọi chữ làm "lượng" kích hoạt "lương", `vi-semantic` tụt 0,013).
3. Dạng thay thế vào cả hai câu view (OR; kể cả câu tiếng Anh, vốn làm gói trơ) và vào đích `rescore` dưới dạng cả câu đã thay (xác suất `lexiconWeight` = 0,6). `embedQuery` không đổi.
4. `queryCacheKey()` băm phần đã phân tích của hai mục; `signature()` thêm băm từ ghép khi có.
5. `signature()` và `queryCacheKey()` không có `QueryContext`: vault lấy từ lần `analyzeQuery` gần nhất, chưa có thì `OBSIDIAN_VAULT_PATH`. Ghi là chỗ hở của P01 (xem báo cáo).
