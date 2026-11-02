---
title: "V15b: sửa các hạng mục tụt của gói vi trên vault thật"
description: "Tìm nguyên nhân và sửa các hạng mục nDCG@5 tụt khi bật ohs-lang-vi trên vault thật của user (V15), không đưa nội dung vault vào repo."
status: pending
priority: P2
branch: master
tags: [vi-pack, eval, privacy]
created: 2026-11-02
---

# V15b: sửa các hạng mục tụt trên vault thật

Tách từ plan tổng [`archive/261102-0349-fork-master-roadmap`](../archive/261102-0349-fork-master-roadmap/plan.md) theo yêu cầu user (2026-11-02). User chốt sau V15: vẫn dùng gói `vi` cho bộ cài (tổng nDCG@5 0,600 → 0,698), nhưng phải tìm cách sửa các hạng mục tụt.

## Bối cảnh

Báo cáo V15: [`vantt/reviews/v0.17.2-vantt.2.private.md`](../../reviews/v0.17.2-vantt.2.private.md) (61 câu, vault 2.080 note, chỉ số tổng hợp).

| Hạng mục | Không gói → có gói (nDCG@5) | Ghi chú |
|---|---|---|
| `vi-iy` | 0,817 → 0,557 | 1 câu rơi khỏi top 5 dù `foldIY` tắt |
| `vi-accented` | 0,946 → 0,894 | Hit@5 vẫn 1,00, chỉ đổi thứ hạng |
| `vi-compound` | 0,926 → 0,885 | Hit@5 vẫn 1,00, chỉ đổi thứ hạng |
| `vi-synonym` | 0,167 → 0,000 | vault chưa có `_ohs/lexicon.md` |

## Quy tắc

- Nội dung vault thật, câu hỏi và tên note không vào repo, CI, log hay báo cáo (quy tắc 7 của plan tổng, PRD 11.5). Bước cần nhìn từng câu chạy trên máy user; gửi về chỉ nguyên nhân dạng chung.
- Sửa gói bằng cơ chế chung, không sửa riêng cho một câu; không hạ ngưỡng; mọi mục tiêu G3/G8 trên corpus sinh phải còn đạt.

## Việc

| # | Việc | Ai | Trạng thái |
|---|---|---|---|
| 1 | `quality-gate.mjs --private-detail <file ngoài repo>`: kết quả từng câu có và không gói, thứ hạng theo nhánh, phân tích của gói | agent | Xong (`6cda0fc`) |
| 2 | Chạy trên vault thật: `node vantt/scripts/quality-gate.mjs --private <golden-set.json> --vault <bản sao vault> --with-lang vi --out <report.json> --private-detail <file ngoài repo>.json --k 30`; gửi nguyên nhân dạng chung cho từng hạng mục tụt | agent phía dự án, máy user | Xong 2026-11-02 (mục Kết quả bước 2) |
| 3 | Lexicon khởi đầu: `ohs-lang-vi learn-abbr --vault <vault>` (thêm `--dry-run` để xem trước), user duyệt `## Chờ duyệt` sang `## Viết tắt`, thêm đồng nghĩa quen dùng | user + agent phía dự án | Xong 2026-11-02: vault B có `_ohs/lexicon.md` (38 nhóm đồng nghĩa, 43 viết tắt, 15 từ ghép, từ thông dụng, không thông tin cá nhân). `learn-abbr` đề xuất 179 dòng, gần như toàn nhiễu (ghép chữ đầu cụm hay gặp); phía dự án có bộ lọc (`scripts/ohs` của repo dự án, E12.9.3) |
| 4 | Sửa gói `vi` theo nguyên nhân; đo lại eval `vi` trên corpus sinh (không hạng mục nào tụt quá 0,01, G3/G8 còn đạt) | agent | Sẵn sàng (bước 2 xong) |
| 5 | Chạy lại V15 trên vault thật, ghi số tổng hợp mới vào `vantt/reviews/` | user + lead | Chờ bước 4 |
| 6 | V15c: bước trộn `hybrid` không để nhánh fulltext (và các nhánh chữ của gói) khớp chữ vặt kéo đáp án của nhánh nghĩa xuống (mục Kết quả bước 2, nguyên nhân 1, 2; một câu điều tra tay: hạng 7 ở `semantic`, 41 ở `hybrid`). Làm trong gói nếu hợp đồng P01 cho phép (trọng số view, `rescore`), không thì lõi và giữ bất biến "không gói = upstream"; đo `vi-semantic`, `vi-mixed-en` trên corpus sinh và `--private`; sau đó mới đo lại reranker (V22) | agent | Chờ |

## Kết quả bước 2 (chỉ số tổng hợp, nguyên nhân dạng chung)

61 câu, e5-small, không rerank, `--k 30` (chỉ để chẩn đoán). nDCG@5: không gói 0,611; gói `vantt.3` 0,703; gói `vantt.4` 0,709. `vantt.4` so với `vantt.3`: `vi-accented` 0,872 lên 0,949 (bằng không gói), `vi-iy` 0,557 lên 0,650, `vi-synonym` 0,098 xuống 0 (chưa có lexicon lúc đo). Còn dưới không gói: `vi-compound` 0,885 (0,925), `vi-mixed-en` 0,375 (0,445), `vi-semantic` 0,018 (0,095).

Nguyên nhân:
1. Các nhánh chữ gói thêm vào RRF bỏ phiếu cho note chỉ khớp phần chung chung của câu, át đáp án đứng đầu ở nhánh vector hoặc BM25. Nhánh `seg` chỉ tìm từ ghép, hay bắn vào từ ghép tần suất cao hoặc cặp từ chức năng và bỏ mất danh từ chính; từ điển từ ghép mới có cả cặp từ chức năng.
2. Nhánh `fold` cho câu có dấu (`accentedFold: auto`) bật cho gần hết câu, vì vault thật lớn gần như luôn có bigram bỏ dấu nào đó.
3. i/y: câu viết "ỹ" trượt note viết "ĩ" ở cả `fold` (foldIY tắt), `seg` và `rescore` (đều so có dấu); cả ba thưởng note cùng cách viết với câu.
4. `rescore`: thưởng cụm trong tiêu đề đẩy note cùng cụm lên trên note tổng quan gần nghĩa hơn (chỉ mất điểm partial).
5. `restore`: câu không dấu bị thêm biến thể từ thông dụng sai vào nhánh `norm`.

Đo từng cái: `viewWeights.seg` 0,5; `accentedFold: never`; `rescoreWeights.semantic` > 0; `foldIY: true`. Sửa mã: lọc từ ghép của `seg` theo tần suất tài liệu hoặc danh sách từ chức năng; bằng chứng mạnh hơn cho `accentedFold: auto` (tỷ lệ tài liệu không dấu); `seg` và `rescore` không phân biệt i/y khi bật foldIY; dọn cặp từ chức năng khỏi từ điển; nâng ngưỡng biến thể của `restore`.

Lỗi phụ: `quality-gate.mjs --private-detail` báo `detail run failed (exit 1)` sau cả hai lượt eval (đầu ra con bị nuốt); gọi thẳng `vantt/scripts/lib/detail-search.mjs` trên cùng vault thì chạy được. **Đã sửa (d5536ff):** lượt con hỏng giờ in đuôi stderr của chính nó ra terminal (không vào báo cáo); chế độ `--private` đánh chỉ mục theo mẫu bỏ qua của user (mặc định OHS) và luôn bỏ `_ohs/**`, nên chạy giống lệnh gọi thẳng. Lỗi exit 1 gốc không tái hiện được trên vault tổng hợp (Linux): nếu còn, đuôi stderr sẽ chỉ ra.

Sau lần đo: vault B chạy `0.17.2-vantt.4`, có lexicon, `OBSIDIAN_IGNORE_PATTERNS=.obsidian/**,templates/**,*.canvas,_ohs/**`; lần đo V15 kế tiếp (bước 5) sẽ có lexicon.

Đo thêm sau bước 3 (2026-11-02, `vantt.4`, có lexicon khởi đầu, k=10, chạy thẳng `eval/evaluate.ts` có gói): nDCG@5 tổng 0,708 (không lexicon 0,709). `vi-synonym` 0 lên 0,405 (lexicon có tác dụng). `vi-abbr` 0,667 xuống 0,307: hai câu viết tắt rơi về 0 khi lexicon mở rộng chữ tắt thành cụm phổ biến; nguyên nhân dạng chung: nhánh mở rộng viết tắt bỏ phiếu cho mọi note có cụm đầy đủ (cụm tần suất cao), át đáp án mà chữ tắt chỉ là một phần câu. Đề xuất: trọng số thấp hơn cho nhánh mở rộng (`lexiconWeight` 0,6 → thử 0,3), hoặc chỉ mở rộng khi cụm đầy đủ hiếm (theo tần suất tài liệu), hoặc yêu cầu các từ còn lại của câu vẫn khớp. `vi-typo` 0,917 → 0,891, `vi-alias` 0,874 → 0,853 (một câu, có thể là nhiễu). Lỗi phụ thứ hai: chạy qua `quality-gate.mjs --private` (không `--private-detail`) cũng hỏng ("eval failed in private run (exit 1)") trên cùng bản sao vault có `_ohs/lexicon.md`, trong khi gọi thẳng `evaluate.ts` có gói thì chạy được; đầu ra con bị nuốt nên chưa rõ nhánh nào hỏng. **Đã sửa (d5536ff):** như lỗi phụ thứ nhất. Trước bản sửa, chế độ `--private` xoá mọi mẫu bỏ qua nên `_ohs/lexicon.md`, `templates/` và `.obsidian/` thành kết quả tìm: trên corpus `vi-search` tổng hợp (k=30) lexicon chiếm 536 vị trí kết quả và `vi-synonym` có gói đo 0,431 thay vì 0,634. Số `--private` đo trước d5536ff trên vault có lexicon cần đo lại.

Hướng dẫn chi tiết: `vantt/eval/vi/README.md` (mục `--private-detail` và `learn-abbr`).

## Xong khi

- [ ] Chạy lại V15 sau khi sửa: không hạng mục nào tụt quá 0,02 nDCG@5 so với không gói (cổng `private-regression` đạt), hoặc user chấp nhận từng hạng mục còn tụt kèm lý do.
- [ ] `vi-synonym`, `vi-abbr` đo với lexicon của vault.
- [ ] Eval `vi` trên corpus sinh và cổng chất lượng CI vẫn xanh.
- [ ] Báo cáo tổng hợp mới trong `vantt/reviews/`; plan này chuyển vào `vantt/plans/archive/`.
