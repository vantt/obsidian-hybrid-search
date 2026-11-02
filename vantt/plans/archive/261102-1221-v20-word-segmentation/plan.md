---
title: "v20-word-segmentation"
description: "Gói ohs-lang-vi M5d: segment.ts, view seg, từ điển từ ghép theo Q9"
status: completed
priority: P1
effort: "4d"
tags: [vi-pack, v20]
created: 2026-11-02
---

# V20: tách từ, view `seg`

## Phạm vi (PRD 10.4, 15 Q9)

> Thêm view `seg` (view thứ ba): `project` nối các âm tiết của một từ ghép bằng `_` ("khách_hàng"), giữ bất biến token. Cách tách: khớp dài nhất theo từ điển từ ghép đóng gói sẵn (Q9), cộng danh sách từ ghép trong file lexicon của user. `project` là hàm thuần; thống kê cặp âm tiết của vault chỉ dùng lúc tìm. `analyzeQuery` tách câu theo cùng từ điển và đặt `viewQueries.seg`. Bật bằng tuỳ chọn `segment` (mặc định theo eval). Đổi từ điển thì đổi `signature()`; từ ghép trong lexicon cũng vào `signature()`.

Q9: từ điển giấy phép MIT, BSD, Apache-2.0, CC0 hoặc CC-BY; đọc LICENSE; ghi nguồn, giấy phép, commit, cách lọc vào `data/README.md`; chỉ từ hai âm tiết trở lên.

## Tiêu chí xong

- [x] `vi-compound` nDCG@5 hơn baseline upstream ≥ 0,1: 0,844 → 1,000 (+0,156). Hạng mục đã bão hoà từ V13 (1,000) nên seg không tụt nó; đo thêm trên bộ khó hơn (dưới).
- [x] Chốt mặc định `segment`: **bật**.
- [x] Không hạng mục nào tụt so với V17+V18+V19 đã trộn (`tmp/v18/v18-m2.json`); eval tiếng Anh upstream giữ 0,735.
- [x] `project` seg trên 1 MB dưới 200 ms (đo 67–114 ms tuỳ tải máy).
- [x] Bất biến token (fast-check, mọi trường, ba bộ tuỳ chọn index), từ ghép lexicon vào `signature()` chỉ khi `segment` bật.

## Quyết định

1. Từ điển: `pyvi/models/words.txt` (MIT, commit `e2ac2ec`), chỉ giữ từ đúng hai âm tiết hợp lệ (22.574 từ, 266 KB, gzip 86 KB). Từ ba âm tiết trở lên nuốt âm tiết của từ sau (`an toàn khu` + `vực`). Rủi ro nguồn gốc ghi ở `data/README.md`.
2. Tách: đường ngắn nhất (ít từ nhất, hoà thì từ đầu dài hơn), chỉ nối qua khoảng trắng (không qua dấu câu, xuống dòng). Câu tìm tách cùng cách, thêm từ ghép khác trong câu mà view seg của vault có (`termStats`).
3. Câu seg chỉ gồm từ ghép (từ đơn đã có ở các nhánh khác); null khi câu có từ không phải âm tiết Việt (câu trộn tiếng Anh dựa vào nhánh vector: bật seg cho câu trộn làm `vi-mixed-en` tụt 0,033).
4. Trọng số nhánh seg 1,0 (0,5 và 0,75 không gỡ được tụt `vi-mixed-en`, lại kém hơn ở `vi-typo`).
5. Lexicon (V18): `CompoundSource` nhận `lexicon.load().compounds`, đọc lại chỉ trong `signature()` để `project()` luôn dùng đúng từ điển mà chữ ký báo.

## Eval (chk-series `4c69fbf`, e5-small, k = 10, mặc định)

nDCG@5: baseline upstream / V13 / V17+V18+V19 / V20.

| Hạng mục | Baseline | V13 | V18 trộn | V20 |
|---|---|---|---|---|
| Tổng | 0,666 | 0,813 | 0,909 | **0,932** |
| `vi-typo` | 0,488 | 0,661 | 0,722 | **0,975** |
| `vi-snippet` | 0,463 | 0,743 | 0,743 | 0,777 |
| `vi-synonym` | 0,067 | 0,067 | 0,645 | 0,729 (Hit@5 0,80 → 1,00) |
| `vi-alias` | 0,535 | 0,814 | 0,975 | 1,000 |
| `vi-compound` | 0,844 | 1,000 | 1,000 | 1,000 |
| 12 hạng còn lại | | | | không đổi |

Bộ từ ghép khó ([`hard-compound-gen.mjs`](hard-compound-gen.mjs), 60 note, 15 cặp; note đích có cụm một lần, ba note mồi có hai âm tiết đảo hay rời nhau nhiều lần), nDCG@5 upstream / gói không seg / gói có seg: câu có dấu 0,664 / 0,779 / **1,000**; câu không dấu 0,312 / 0,523 / **0,864**; cụm trong câu dài 0,714 / 0,788 / **1,000**.
