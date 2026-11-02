---
phase: 4
title: "Phase 4: Gói tiếng Việt ohs-lang-vi"
status: todo
priority: P1
effort: "16d"
dependencies: []
---

# Phase 4: Gói tiếng Việt `ohs-lang-vi`

## Overview

Package riêng `vantt/packages/ohs-lang-vi/`, thuần TypeScript, không phụ thuộc runtime, test được độc lập với OHS. Cắm vào OHS qua P01. Phục vụ G3 và G8. V09 bắt đầu ngay, không cần fork; phần còn lại cần V11 (P01) và V10 (bộ eval).

## Việc

| ID | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|
| V09 | M1: `normalize.ts`, `fold.ts`, `syllable.ts`; bảng dữ liệu (nguyên âm × thanh, đặt dấu, i/y, Telex và VNI); test bảng, test thuộc tính (fast-check), test hiệu năng | — | vừa | 2,5 | 10.3 |
| V13 | M2 và M3: `views.ts` (`norm`, `fold`), `query.ts` (`analyzeQuery`), `restore.ts` (phục hồi dấu theo từ vựng vault, Viterbi), `rescore.ts`, `index.ts`; chốt trọng số và tham số bằng eval | V09, V10, V11 | mạnh | 3,5 | 10.3, 10.5 |
| V17 | M5a: `telex.ts` (chuỗi Telex/VNI gõ dở), `typo.ts` (sửa gõ sai một chữ theo từ vựng vault) | V13 | vừa | 2,5 | 10.3 |
| V18 | M5b: `lexicon.ts` (đồng nghĩa, Việt–Anh, viết tắt từ `_ohs/lexicon.md`), `abbr.ts` và lệnh `ohs-lang-vi learn-abbr --vault <dir>` | V13 | vừa | 2,5 | 10.3, 15 (Q8) |
| V19 | M5c: `aliasViews` cho `fold`, `matchedTerms`, kiểm đoạn trích chữ gốc | V13 | vừa | 1 | 10.2, 10.3 |
| V20 | M5d: `segment.ts`, view `seg`, từ điển từ ghép theo tiêu chí Q9 | V13 | mạnh | 4 | 10.4, 15 (Q9) |

Song song: V09 ngay từ đầu, cùng lúc với phase 1. V17, V18, V19, V20 song song sau V13, nhưng phần sửa `src/query.ts` làm lần lượt theo thứ tự V17, V18, V19, V20.

## Quy tắc riêng

- Không sửa văn bản gốc: `notes.content`, snippet, `read` luôn là chữ gốc.
- Mọi view giữ bất biến token (PRD 10.2); có test fast-check.
- Mọi tuỳ chọn ảnh hưởng tới index đi vào `signature()`; đồng nghĩa và viết tắt chỉ đi vào `queryCacheKey()`; từ ghép trong lexicon đi vào `signature()`.
- `rescore` không bao giờ bỏ ứng viên.
- Q8 đã chốt: `_ohs/lexicon.md`, ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`, mục `## Chờ duyệt` không được dùng.
- Q9 đã chốt: agent V20 tự chọn từ điển có giấy phép MIT, BSD, Apache-2.0, CC0 hoặc CC-BY (không GPL, không CC-BY-SA), đọc LICENSE để xác nhận, ghi vào `data/README.md`.
- Mặc định của `foldIY`, `segment`, `telex`, `typo` chốt theo eval: bật khi hạng mục của nó tốt lên mà hạng mục khác không tụt quá 0,01 nDCG@5.

## File sở hữu

- `vantt/packages/ohs-lang-vi/**`. Trong đó `src/query.ts` và `src/index.ts` dùng chung giữa V13, V17–V20: làm tuần tự.

## Todo

- [x] V09 M1 chuẩn hoá, bỏ dấu, âm tiết, bảng dữ liệu
- [x] V13 M2, M3 view, phân tích câu, phục hồi dấu, chấm lại
- [x] V17 Telex/VNI và gõ sai
- [x] V18 đồng nghĩa, viết tắt, `learn-abbr`
- [x] V19 alias không dấu, đoạn trích chữ gốc
- [ ] V20 tách từ

## Success Criteria

- V09: test của gói xanh; `project` trên 1 MB văn bản dưới 200 ms; `analyzeQuery` câu 12 âm tiết với từ vựng 50.000 term dưới 20 ms.
- V13: đạt mục tiêu G3 trên corpus sinh: `vi-unaccented`, `vi-dd` Hit@5 ≥ 0,85 và gấp tối thiểu 2 lần baseline upstream; `vi-accented` không tụt; `vi-tone-precision` MRR ≥ 0,9; eval upstream có gói không tụt quá 0,01 nDCG@5.
- V17: `vi-telex`, `vi-typo` Hit@5 ≥ 0,8; hạng mục khác không tụt.
- V18: `vi-synonym`, `vi-abbr` Hit@5 ≥ 0,8; đổi đồng nghĩa hay viết tắt không dựng lại index.
- V19: `vi-alias` Hit@5 ≥ 0,8; `vi-snippet` 100% đoạn trích là chữ gốc và chứa chỗ khớp.
- V20: `vi-compound` nDCG@5 hơn baseline upstream tối thiểu 0,1; chốt mặc định `segment`.

## Ghi chú sau V13

- Eval (fixture `v0.10.0`): Hit@5 `vi-unaccented` 0,27 → 1,00, `vi-dd` 0,40 → 1,00, MRR `vi-tone-precision` 1,00; không hạng mục nào tụt; eval tiếng Anh upstream nDCG@5 0,735 có và không có gói.
- Lệch PRD 10.3: câu có dấu mặc định không dùng view (bật view làm `vi-semantic` tụt 0,083); `fold` tự bật khi vault có từ viết không dấu. `accentedNorm: true`, `accentedFold: "always"` trả về hành vi PRD. Chờ user chốt.
- Đã sửa lỗi M1: `parseSyllable` từ chối `kỹ`, `lý`, `mỹ`, `hy`.
- Điểm cần sửa ở P01 (V13 nêu): view query luôn là tiền tố OR, không có khớp chính xác hay cụm; `readViewTermsWithPrefix` không có cận trên; `Candidate` của `rescore` thiếu `matchedTerms`; trọng số view không chỉnh theo câu.
- `query.ts`, `index.ts` có điểm móc cho V17, V18, V19, V20.

## Risk

- Phục hồi dấu đoán sai làm kết quả tệ hơn: nhánh `fold` luôn chạy, `rescore` không bỏ ứng viên, có hạng mục eval riêng.
- Sửa Telex đổi nhầm chữ tiếng Anh: chỉ áp cho token không có trong từ vựng vault mà dạng giải ra có trong từ vựng.
- Không có từ điển đạt giấy phép: dựng từ thống kê cặp âm tiết trên corpus sinh và ghi rõ.
