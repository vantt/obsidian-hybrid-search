---
title: 'V15b: sửa các hạng mục tụt của gói vi trên vault thật'
description: 'Tìm nguyên nhân và sửa các hạng mục nDCG@5 tụt khi bật ohs-lang-vi trên vault thật của user (V15), không đưa nội dung vault vào repo.'
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

| Hạng mục      | Không gói → có gói (nDCG@5) | Ghi chú                              |
| ------------- | --------------------------- | ------------------------------------ |
| `vi-iy`       | 0,817 → 0,557               | 1 câu rơi khỏi top 5 dù `foldIY` tắt |
| `vi-accented` | 0,946 → 0,894               | Hit@5 vẫn 1,00, chỉ đổi thứ hạng     |
| `vi-compound` | 0,926 → 0,885               | Hit@5 vẫn 1,00, chỉ đổi thứ hạng     |
| `vi-synonym`  | 0,167 → 0,000               | vault chưa có `_ohs/lexicon.md`      |

## Quy tắc

- Nội dung vault thật, câu hỏi và tên note không vào repo, CI, log hay báo cáo (quy tắc 7 của plan tổng, PRD 11.5). Bước cần nhìn từng câu chạy trên máy user; gửi về chỉ nguyên nhân dạng chung.
- Sửa gói bằng cơ chế chung, không sửa riêng cho một câu; không hạ ngưỡng; mọi mục tiêu G3/G8 trên corpus sinh phải còn đạt.

## Việc

| #   | Việc                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Ai                         | Trạng thái                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `quality-gate.mjs --private-detail <file ngoài repo>`: kết quả từng câu có và không gói, thứ hạng theo nhánh, phân tích của gói                                                                                                                                                                                                                                                                                                                         | agent                      | Xong (`6cda0fc`)                                                                                                                                                                                                                                                                |
| 2   | Chạy trên vault thật: `node vantt/scripts/quality-gate.mjs --private <golden-set.json> --vault <bản sao vault> --with-lang vi --out <report.json> --private-detail <file ngoài repo>.json --k 30`; gửi nguyên nhân dạng chung cho từng hạng mục tụt                                                                                                                                                                                                     | agent phía dự án, máy user | Xong 2026-11-02 (mục Kết quả bước 2)                                                                                                                                                                                                                                            |
| 3   | Lexicon khởi đầu: `ohs-lang-vi learn-abbr --vault <vault>` (thêm `--dry-run` để xem trước), user duyệt `## Chờ duyệt` sang `## Viết tắt`, thêm đồng nghĩa quen dùng                                                                                                                                                                                                                                                                                     | user + agent phía dự án    | Xong 2026-11-02: vault B có `_ohs/lexicon.md` (38 nhóm đồng nghĩa, 43 viết tắt, 15 từ ghép, từ thông dụng, không thông tin cá nhân). `learn-abbr` đề xuất 179 dòng, gần như toàn nhiễu (ghép chữ đầu cụm hay gặp); phía dự án có bộ lọc (`scripts/ohs` của repo dự án, E12.9.3) |
| 4   | Sửa gói `vi` theo nguyên nhân; đo lại eval `vi` trên corpus sinh (không hạng mục nào tụt quá 0,01, G3/G8 còn đạt)                                                                                                                                                                                                                                                                                                                                       | agent                      | Xong (`fb37546`, mục Kết quả bước 4/6); số vault thật chờ bước 5                                                                                                                                                                                                                |
| 5   | Chạy lại V15 trên vault thật, ghi số tổng hợp mới vào `vantt/reviews/`                                                                                                                                                                                                                                                                                                                                                                                  | user + lead                | Sẵn sàng: dùng `v0.17.2-vantt.7` (máy Intel: không có gói, xem README); chạy mặc định, `{"accentedFoldMinShare":0.5,"segWeightByCoverage":true}`, `{"minBm25Agreement":0.2}` và `{"minBm25Agreement":0}` (mục Kết quả fixture v0.12.0)                                          |
| 6   | V15c: bước trộn `hybrid` không để nhánh fulltext (và các nhánh chữ của gói) khớp chữ vặt kéo đáp án của nhánh nghĩa xuống (mục Kết quả bước 2, nguyên nhân 1, 2; một câu điều tra tay: hạng 7 ở `semantic`, 41 ở `hybrid`). Làm trong gói nếu hợp đồng P01 cho phép (trọng số view, `rescore`), không thì lõi và giữ bất biến "không gói = upstream"; đo `vi-semantic`, `vi-mixed-en` trên corpus sinh và `--private`; sau đó mới đo lại reranker (V22) | agent                      | Xong trên corpus sinh (`fb37546`, trong gói: `minBm25Agreement`); `--private` và reranker chờ bước 5                                                                                                                                                                            |

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

## Kết quả bước 4/6 (corpus sinh, 2026-11-02)

Sửa trong gói `ohs-lang-vi` (`fb37546`), chỉ ở lúc tìm (`signature()` không đổi, không dựng lại index, không đổi lõi). Hợp đồng P01 đủ dùng: `rescore` nhận hạng của mọi nhánh RRF (`semantic`, `bm25`, `alias`, `title`, `view:*`), `viewTerms` và `viewWeights` đổi câu và trọng số view theo từng câu.

| Nguyên nhân (Kết quả bước 2)                                              | Sửa                                                                                                                                                                          | Tuỳ chọn, mặc định                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| V15c, 1: nhánh chữ khớp chữ vặt đè đáp án của nhánh nghĩa                 | `rescore` trừ phiếu BM25 khi không note nào trong 5 kết quả đầu của BM25 nằm trong 10 kết quả đầu của vector (câu tiếng Việt, chế độ `hybrid`; nhánh view của gói giữ phiếu) | `minBm25Agreement` 0,2                           |
| 1: `seg` bắn vào từ ghép phổ biến, cặp từ chức năng, bỏ mất danh từ chính | bỏ từ ghép toàn từ chức năng; bỏ từ ghép có trong hơn 10% số note (và ít nhất 20 note); trọng số `seg` nhân tỉ lệ chữ của câu được phủ                                       | `segMaxDocShare` 0,1, `segWeightByCoverage` true |
| 2: `accentedFold: auto` bật cho gần hết câu                               | cần ít nhất nửa số cặp chữ liền nhau của câu có trong vault ở dạng không dấu                                                                                                 | `accentedFoldMinShare` 0,5                       |
| 3: i/y lệch ở `fold`, `seg`, `rescore`                                    | cách viết kia (nếu vault có) vào câu `norm`/`fold` dạng term khớp đúng (`viewTerms`, khi `foldIY` tắt) và vào câu `seg`; `rescore` coi `kĩ`/`kỹ` là một chữ                  | luôn bật                                         |
| 4: `rescore` thưởng cụm trong tiêu đề                                     | cụm và cặp không còn nối qua ranh giới tiêu đề/đoạn trích; `phrase` 2 bị loại (bảng dưới)                                                                                    |                                                  |
| 5: `restore` thêm biến thể sai vào `norm`                                 | `alternativeThreshold` 0,15 → 0,3                                                                                                                                            |                                                  |
| Viết tắt mở rộng thành cụm phổ biến                                       | cụm đầy đủ có trong hơn 5% số note (và ít nhất 20 note) chỉ là đích `rescore`, không vào câu view; `lexiconWeight` 0,3 bị loại                                               | `abbrMaxDocShare` 0,05                           |

Eval chính thức (`run-eval.mjs`, lõi `v0.17.2-vantt.4`, e5-small, k = 10), nDCG@5:

| Hạng mục            | Baseline upstream | Gói trước (master) | Gói V15b | Δ so với gói trước |
| ------------------- | ----------------- | ------------------ | -------- | ------------------ |
| Tổng                | 0,646             | 0,944              | 0,959    | +0,015             |
| `vi-accented`       | 1,000             | 1,000              | 1,000    | 0                  |
| `vi-partial-accent` | 0,863             | 1,000              | 1,000    | 0                  |
| `vi-telex`          | 0,333             | 1,000              | 1,000    | 0                  |
| `vi-typo`           | 0,543             | 1,000              | 1,000    | 0                  |
| `vi-snippet`        | 0,466             | 0,951              | 0,951    | 0                  |
| `vi-unaccented`     | 0,133             | 1,000              | 1,000    | 0                  |
| `vi-dd`             | 0,239             | 0,975              | 1,000    | +0,025             |
| `vi-iy`             | 1,000             | 1,000              | 1,000    | 0                  |
| `vi-tone-placement` | 1,000             | 1,000              | 1,000    | 0                  |
| `vi-tone-precision` | 0,951             | 1,000              | 1,000    | 0                  |
| `vi-compound`       | 0,632             | 0,988              | 1,000    | +0,012             |
| `vi-mixed-en`       | 1,000             | 1,000              | 1,000    | 0                  |
| `vi-semantic`       | 0,446             | 0,446              | 0,564    | +0,118             |
| `vi-names`          | 0,909             | 1,000              | 1,000    | 0                  |
| `vi-synonym`        | 0,067             | 0,689              | 0,739    | +0,050             |
| `vi-abbr`           | 0,933             | 1,000              | 1,000    | 0                  |
| `vi-alias`          | 0,477             | 0,959              | 1,000    | +0,041             |

G3 (`vi-unaccented`, `vi-dd` Hit@5 1,00; `vi-accented` 1,000; `vi-tone-precision` MRR 1,00) và G8 (`vi-telex`, `vi-typo`, `vi-abbr`, `vi-alias` Hit@5 1,00, `vi-synonym` 0,93; `vi-compound` 1,000 hơn baseline 0,368; `check-snippets` 15/15) còn đạt. `obsidian-help` (tiếng Anh) 0,735: không gói, gói trước, gói V15b bằng nhau, 58 danh sách top 10 giống hệt. Smoke-vault 0,906 như trước.

Mọi thử nghiệm (eval nhanh trên index giữ lại giữa các lần, cùng câu và cùng chỉ số với `evaluate.ts`, trùng từng số với lần chạy chính thức). "Đổi" so với dòng gói trước (nửa trên) hoặc với mặc định V15b (nửa dưới).

| Thử                                                              | Tổng  | `vi-semantic` | `vi-mixed-en` | Hạng mục đổi (nDCG@5)                                                                              | Kết luận                                                                       |
| ---------------------------------------------------------------- | ----- | ------------- | ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Gói trước (master)                                               | 0,944 | 0,446         | 1,000         |                                                                                                    |                                                                                |
| `viewWeights.seg` 0,5                                            | 0,941 | 0,446         | 1,000         | `vi-compound` −0,005; `vi-synonym` −0,052                                                          | loại                                                                           |
| `accentedFold: never`                                            | 0,944 | 0,446         | 1,000         | không đổi                                                                                          | loại (mất note gõ không dấu; thay bằng `accentedFoldMinShare`)                 |
| `rescoreWeights.semantic` 1 / 1,5                                | 0,941 | 0,446         | 1,000         | `vi-synonym` −0,026; `vi-alias` −0,024                                                             | loại (thưởng ở đơn vị nhỏ hơn điểm đã chuẩn hoá, không cứu được `vi-semantic`) |
| `rescoreWeights.semantic` 3                                      | 0,937 | 0,446         | 1,000         | `vi-synonym` −0,026; `vi-alias` −0,098                                                             | loại                                                                           |
| `foldIY` true                                                    | 0,941 | 0,446         | 1,000         | `vi-alias` −0,050                                                                                  | loại (thay bằng biến thể i/y lúc tìm)                                          |
| `lexiconWeight` 0,3                                              | 0,941 | 0,446         | 1,000         | `vi-iy` −0,025; `vi-synonym` −0,030                                                                | loại (thay bằng `abbrMaxDocShare`)                                             |
| `alternativeThreshold` 0,25 / 0,35                               | 0,944 | 0,446         | 1,000         | không đổi                                                                                          | giữ 0,3                                                                        |
| `rescoreWeights.phrase` 2                                        | 0,941 | 0,446         | 1,000         | `vi-names` −0,025; `vi-synonym` −0,030                                                             | loại                                                                           |
| Độ phủ IDF của ứng viên, ngưỡng 0,3 (chưa loại khớp chỉ ở alias) | 0,893 | 0,446         | 1,000         | `vi-alias` −0,926                                                                                  | loại                                                                           |
| Độ phủ IDF, ngưỡng 0,5                                           | 0,947 | 0,495         | 0,933         | `vi-mixed-en` −0,067; `vi-semantic` +0,049; `vi-snippet` +0,024; `vi-alias` +0,041                 | loại (đáp án viết bằng từ Anh bị phạt)                                         |
| Độ phủ IDF, ngưỡng 1                                             | 0,950 | 0,495         | 0,959         | `vi-mixed-en` −0,041; `vi-semantic` +0,049; `vi-synonym` +0,033                                    | loại                                                                           |
| Độ phủ IDF 0,5 + nhánh `norm` trọng số 0 làm bằng chứng          | 0,947 | 0,494         | 0,933         | `vi-mixed-en` −0,067                                                                               | loại                                                                           |
| như trên + danh sách bằng chứng đủ                               | 0,949 | 0,494         | 0,933         | `vi-mixed-en` −0,067; `vi-synonym` +0,042                                                          | loại                                                                           |
| Đồng thuận BM25/vector, trừ cả phiếu view, ngưỡng 0,2            | 0,940 | 0,564         | 1,000         | `vi-unaccented` −0,033; `vi-dd` −0,042; `vi-synonym` −0,118; `vi-abbr` −0,067                      | loại (nhánh view mang bằng chứng mà vector không có)                           |
| Đồng thuận, chỉ phiếu BM25, ngưỡng 0,2                           | 0,959 | 0,564         | 1,000         | `vi-semantic` +0,118; `vi-synonym` +0,050; `vi-alias` +0,041; `vi-dd` +0,025; `vi-compound` +0,012 | **giữ**                                                                        |
| Đồng thuận, chỉ phiếu BM25, ngưỡng 0,5 (trước sửa i/y)           | 0,957 | 0,559         | 1,000         | như trên, `vi-iy` −0,025                                                                           | loại                                                                           |
| **Mặc định V15b**                                                | 0,959 | 0,564         | 1,000         |                                                                                                    |                                                                                |
| `minBm25Agreement` 0 (tắt)                                       | 0,945 | 0,446         | 1,000         | `vi-semantic` −0,118; `vi-synonym` −0,050; `vi-alias` −0,033; `vi-dd` −0,025; `vi-compound` −0,012 |                                                                                |
| `minBm25Agreement` 0,4                                           | 0,959 | 0,564         | 1,000         | không đổi                                                                                          |                                                                                |
| `minBm25Agreement` 0,6                                           | 0,958 | 0,559         | 1,000         | `vi-semantic` −0,005                                                                               |                                                                                |
| `minBm25Agreement` 0,8                                           | 0,960 | 0,588         | 1,000         | `vi-semantic` +0,024                                                                               | ứng viên đo trên vault thật                                                    |
| `minBm25Agreement` 1 (phiếu BM25 nhân đúng tỉ lệ đồng thuận)     | 0,961 | 0,588         | 1,000         | `vi-semantic` +0,024; `vi-synonym` +0,025                                                          | ứng viên đo trên vault thật                                                    |
| `accentedFoldMinShare` 0 hoặc 1                                  | 0,959 | 0,564         | 1,000         | không đổi                                                                                          | giữ 0,5                                                                        |
| `segMaxDocShare` 0,05 / 0,1 / 0,2; `segWeightByCoverage`         | 0,959 | 0,564         | 1,000         | không đổi                                                                                          | giữ 0,1, bật                                                                   |
| `abbrMaxDocShare` 0,05 / 0,1                                     | 0,959 | 0,564         | 1,000         | không đổi                                                                                          | giữ 0,05                                                                       |
| Tắt mọi tuỳ chọn mới (còn sửa i/y, ranh giới, từ chức năng)      | 0,945 | 0,446         | 1,000         | `vi-alias` +0,008 so với gói trước                                                                 |                                                                                |
| `foldIY` true                                                    | 0,954 | 0,564         | 1,000         | `vi-alias` −0,087                                                                                  | loại                                                                           |
| `lexiconWeight` 0,3                                              | 0,957 | 0,564         | 1,000         | `vi-synonym` −0,030                                                                                | loại                                                                           |
| `rescoreWeights.phrase` 2                                        | 0,954 | 0,564         | 1,000         | `vi-tone-precision` −0,025; `vi-names` −0,025; `vi-synonym` −0,030                                 | loại                                                                           |
| `rescoreWeights.semantic` 1                                      | 0,957 | 0,564         | 1,000         | `vi-alias` −0,025; `vi-synonym` −0,005                                                             | loại                                                                           |
| `viewWeights.seg` 0,5                                            | 0,958 | 0,564         | 1,000         | `vi-synonym` −0,005                                                                                | loại                                                                           |
| `accentedFold: never`                                            | 0,959 | 0,564         | 1,000         | không đổi                                                                                          | loại (như trên)                                                                |

Giới hạn: corpus sinh đã 1,000 ở `vi-iy`, `vi-accented`, `vi-abbr` và gần 1 ở `vi-compound`, nên không tái hiện được nguyên nhân 1 (`seg`), 2, 3, 4, 5 và chuyện viết tắt; các sửa đó trung tính trên corpus sinh và được kiểm bằng test tổng hợp (`vantt/packages/ohs-lang-vi/test/fusion-and-spelling.test.ts`). Thêm câu tái hiện vào eval cần fixture mới (`vi-search` bản minor kế tiếp: note viết `kĩ`/`kỹ` lẫn lộn cùng chủ đề, từ ghép phổ biến trong hơn 10% note, viết tắt có cụm đầy đủ phổ biến, note không dấu rải rác cặp từ chức năng). Không sửa nguyên nhân 4 thêm vì không có tín hiệu đo được.

Bước 5 cần đo trên vault thật: tổng và từng hạng với mặc định V15b; thêm `{"minBm25Agreement":1}` và `{"minBm25Agreement":0}` để chốt ngưỡng; `vi-semantic` có tách được câu "hạng 7 ở semantic, 41 ở hybrid" không; `vi-iy`, `vi-compound`, `vi-accented`, `vi-abbr` (với lexicon) so với không gói. Sau đó mới đo lại reranker (V22).

## Kết quả fixture v0.12.0 (corpus sinh, 2026-11-03)

Fixture `vi-search@v0.12.0` (repo `vantt/obsidian-test-fixture`, commit `ffa1e44`, thẻ `v0.12.0` mới có ở bản clone cục bộ, chưa đẩy lên GitHub) thêm 45 câu, 5 câu mỗi `cause`, tái hiện nguyên nhân ở mục Kết quả bước 2 và các phát hiện review của `fb37546`: `iy-mixed` (`vi-iy`), `common-compound` (`vi-compound`), `common-abbr` (`vi-abbr`), `function-pairs`, `few-unaccented-pairs`, `title-phrase`, `rare-identifier` (`vi-accented`), `idea` (`vi-semantic`), `toneless-iy` (`vi-mixed-en`). 270 câu và 423 note cũ giữ nguyên từng chữ; 198 note mới (80 note nền làm sáu từ ghép phổ biến) nên số câu cũ cũng đổi. Chỉ văn bản sinh. Baseline upstream ghi lại trên fixture mới, không gói: `vantt/eval/baselines/linux-x64/0.17.2.vi-search.json`.

Eval chính thức (`run-eval.mjs --otf <bản clone fixture>`, lõi `origin/vantt/v0.17.2` `a326169`, e5-small, k = 10), nDCG@5. "Trước fb37546" là gói ở `fb37546^`; "Hiện tại" là gói ở `master` (`fb37546`); "Mới" là gói nhánh này (sửa sau review + mặc định mới).

| Hạng mục                      | Không gói (upstream) | Trước fb37546 | Hiện tại | Mới       | Mới − hiện tại |
| ----------------------------- | -------------------- | ------------- | -------- | --------- | -------------- |
| Tổng (315 câu)                | 0,623                | 0,891         | 0,908    | **0,914** | +0,006         |
| `vi-accented`                 | 0,770                | 0,796         | 0,796    | 0,796     | 0              |
| `vi-partial-accent`           | 0,830                | 1,000         | 1,000    | 1,000     | 0              |
| `vi-telex`                    | 0,330                | 1,000         | 1,000    | 1,000     | 0              |
| `vi-typo`                     | 0,533                | 1,000         | 1,000    | 1,000     | 0              |
| `vi-snippet`                  | 0,468                | 0,975         | 0,975    | 0,975     | 0              |
| `vi-unaccented`               | 0,059                | 0,975         | 0,975    | 0,975     | 0              |
| `vi-dd`                       | 0,162                | 0,826         | 0,829    | 0,842     | +0,013         |
| `vi-iy`                       | 0,920                | 0,926         | 1,000    | 1,000     | 0              |
| `vi-tone-placement`           | 1,000                | 1,000         | 1,000    | 1,000     | 0              |
| `vi-tone-precision`           | 0,942                | 1,000         | 1,000    | 1,000     | 0              |
| `vi-compound`                 | 0,678                | 0,986         | 0,986    | 0,986     | 0              |
| `vi-mixed-en`                 | 0,853                | 1,000         | 0,982    | 1,000     | +0,018         |
| `vi-semantic`                 | 0,274                | 0,287         | 0,350    | 0,399     | +0,049         |
| `vi-names`                    | 0,885                | 0,975         | 0,975    | 0,975     | 0              |
| `vi-synonym`                  | 0,062                | 0,642         | 0,721    | 0,730     | +0,009         |
| `vi-abbr`                     | 0,932                | 0,957         | 1,000    | 1,000     | 0              |
| `vi-alias`                    | 0,471                | 0,933         | 1,000    | 1,000     | 0              |
| 270 câu cũ                    | 0,631                | 0,928         | 0,940    | 0,945     | +0,005         |
| 45 câu mới                    | 0,580                | 0,667         | 0,721    | 0,729     | +0,008         |
| `cause: iy-mixed`             | 0,679                | 0,705         | 1,000    | 1,000     | 0              |
| `cause: common-compound`      | 0,812                | 0,900         | 0,900    | 0,900     | 0              |
| `cause: common-abbr`          | 0,926                | 0,826         | 1,000    | 1,000     | 0              |
| `cause: function-pairs`       | 0,886                | 1,000         | 1,000    | 1,000     | 0              |
| `cause: few-unaccented-pairs` | 0,000                | 0,000         | 0,000    | 0,000     | 0              |
| `cause: idea`                 | 0,000                | 0,000         | 0,086    | 0,086     | 0              |
| `cause: title-phrase`         | 0,820                | 0,860         | 0,860    | 0,860     | 0              |
| `cause: rare-identifier`      | 0,686                | 0,712         | 0,712    | 0,712     | 0              |
| `cause: toneless-iy`          | 0,412                | 1,000         | 0,926    | 1,000     | +0,074         |

Trên fixture cũ `v0.11.0` (eval nhanh, trùng số chính thức): không gói 0,646, trước fb37546 0,944, hiện tại 0,959, mới **0,961** (`vi-semantic` 0,564 → 0,588, `vi-synonym` 0,739 → 0,764, các hạng khác không đổi).

Kiểm khác: G3 và G8 đạt trên `v0.12.0` (`vi-unaccented` Hit@5 1,00, `vi-dd` 0,87 ≥ 0,85 và ≥ 2 × 0,33; `vi-accented` 0,796 ≥ upstream 0,770; `vi-tone-precision` MRR 1,00; `vi-telex`, `vi-typo`, `vi-abbr`, `vi-alias` Hit@5 1,00, `vi-synonym` 0,87; `vi-compound` hơn upstream 0,308; `check-snippets` 15/15); không hạng nào có gói thấp hơn không gói. `obsidian-help` 0,735 cho không gói, gói hiện tại và gói mới; gói mới và gói hiện tại cho 58/58 danh sách top 10 giống hệt. Không gói trên lõi phát hành bằng baseline upstream từng chỉ số; danh sách top 10 khác ở một câu, hạng 10 (điểm bằng nhau: hai lần chạy upstream cũng khác nhau ở một câu như vậy). Smoke-vault 0,906.

Thấy được nhờ fixture mới: sửa i/y của `fb37546` (`iy-mixed` 0,705 → 1,000) và `abbrMaxDocShare` (`common-abbr` 0,826 → 1,000; `abbrMaxDocShare: 1` cho 0,826) có tác dụng; `toneless-iy` tụt ở `fb37546` (0,926: `hi vong con do dai hoc`, note đúng hạng 1 ở mọi nhánh chữ nhưng không có ở nhánh vector, nên phiếu BM25 bị trừ). Không gói nào giải được `few-unaccented-pairs` (note gõ không dấu cho câu có dấu: chỉ nhánh `fold` 0,75 tìm được, `rescore` so đúng dấu) và `idea`; `title-phrase` mọi cấu hình xếp note hẹp có cụm ở tiêu đề lên trên (kể cả upstream). Thử so chữ đã bỏ dấu ở `rescore` cho ứng viên gõ không dấu: không đổi số nào (note đúng hạng 21), bỏ.

### Sửa sau review `fb37546` (nhánh `vantt/work/fx12`)

| Phát hiện                                                                                                | Sửa                                                                                                                                              | Đo                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1: phạt BM25 xoá khớp đúng duy nhất của câu có dấu (mã lỗi), đồng thuận trên danh sách BM25 một kết quả | phạt chỉ khi nhánh BM25 có đủ 5 kết quả đầu và câu không có chữ nào ngoài âm tiết tiếng Việt (mã, số hiệu, chữ tiếng Anh)                        | trung tính trên cả hai fixture. Điều kiện "câu có ít nhất một nhánh view" như review đề xuất bị loại: `vi-semantic` −0,118 (`v0.11.0`); giới hạn `lost` 0,5: `vi-semantic` −0,055 |
| H2: biến thể i/y của âm tiết không thanh thành term riêng (`mi`→`my`, `ty`→`ti`, fold `ky`→`ki`)         | âm tiết có thanh: term khớp đúng như trước; không thanh (và mọi chữ của `fold`): chỉ cụm hai chữ với chữ bên cạnh trong câu, khi vault có cụm đó | trung tính (câu `toneless-iy` tụt vì phục hồi `do` → `dở`, không vì H2)                                                                                                           |
| M4: kiểm `accentedFold: auto` không dừng sớm                                                             | dừng khi đã đủ hoặc không thể đủ số cặp                                                                                                          | test số lần tra                                                                                                                                                                   |
| M5: `termStats`/`phraseDocs`/`noteCount` không qua bộ đệm                                                | `seg`, lexicon, biến thể i/y đi qua `VocabularyCache` (thêm `noteCount` theo `dbVersion`)                                                        | test: câu lặp lại không tra thêm, tra lại sau khi ghi                                                                                                                             |
| L6: độ phủ `seg` tính cả từ ghép vault không có; phủ 0 vẫn chạy nhánh trọng số 0                         | chỉ tính từ ghép vault có (kể cả cách viết i/y kia), lấy tổ hợp mục tiêu phủ tốt nhất (phục hồi, dạng lexicon); phủ 0 thì không tìm `seg`        | bản đầu chỉ tính tổ hợp đầu làm `vi-synonym` −0,059 (`xe hơi` → `ô_tô` mất), đã sửa                                                                                               |
| L7: thiếu dữ liệu chẩn đoán                                                                              | `debug.viewTerms`, `debug.segWeight`, `debug.bm25Agreement`, `debug.bm25Penalty`                                                                 |                                                                                                                                                                                   |
| M3 (hằng số trộn của lõi chép trong gói)                                                                 | lead làm ở P01; trong gói hằng số ở một chỗ, có chú thích trỏ về hàm của lõi                                                                     |                                                                                                                                                                                   |

Kèm: test thuộc tính `seg` (chiếu và tách câu giống nhau) dùng vault một note thay vault rỗng và gói mới mỗi lần; test bất biến token so khoảng trắng đã gộp (nối từ ghép qua tab là cố ý), trước đây thỉnh thoảng hỏng.

### Tuỳ chọn (eval nhanh, so với mã mới + mặc định cũ: `v0.12.0` 0,908, `v0.11.0` 0,959)

| Thử                                                  | `v0.12.0` | `v0.11.0` | Hạng mục đổi (nDCG@5; `*` = câu `cause`)                                                                                | Kết luận                     |
| ---------------------------------------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `minBm25Agreement` 0                                 | 0,896     | 0,945     | `v0.12.0`: `vi-semantic` −0,075, `vi-synonym` −0,079, `vi-alias` −0,067, `vi-semantic*` −0,086                          | loại                         |
| `minBm25Agreement` 0,5                               | 0,910     | 0,958     | `v0.11.0` `vi-semantic` −0,005                                                                                          |                              |
| `minBm25Agreement` 0,8                               | 0,911     | 0,960     | `v0.12.0` `vi-semantic` +0,038; `v0.11.0` `vi-semantic` −0,005                                                          |                              |
| `minBm25Agreement` 1                                 | 0,911     | 0,961     | `vi-semantic` +0,033 / +0,021, `vi-synonym` +0,009 / +0,026, `vi-dd` +0,013                                             | **giữ**                      |
| `accentedFoldMinShare` 0 / 0,25                      | 0,910     | 0,959     | `v0.12.0` `vi-semantic` +0,025                                                                                          | **0,25**                     |
| `accentedFoldMinShare` 0,75 / 1                      | 0,908     | 0,959     | không đổi                                                                                                               |                              |
| `accentedFold: always`                               | 0,911     | 0,956     | `vi-semantic` −0,020 / −0,053, `vi-accented*` +0,028, `vi-semantic*` +0,114                                             | loại                         |
| `accentedFold: never`                                | 0,908     | 0,959     | không đổi                                                                                                               |                              |
| `segMaxDocShare` 0,05                                | 0,908     | 0,959     | không đổi                                                                                                               | giữ 0,1                      |
| `segMaxDocShare` 0,2 / 1                             | 0,908     | 0,959     | `vi-semantic*` −0,009                                                                                                   |                              |
| `segWeightByCoverage` false                          | 0,909     | 0,959     | `vi-mixed-en*` +0,074, `vi-semantic` −0,005                                                                             | **false** (cùng các thử kia) |
| `abbrMaxDocShare` 0,02 / 0,1                         | 0,908     | 0,959     | không đổi                                                                                                               | giữ 0,05                     |
| `abbrMaxDocShare` 1                                  | 0,906     | 0,959     | `vi-abbr*` −0,174                                                                                                       |                              |
| `foldIY` true                                        | 0,904     | 0,954     | `vi-alias` −0,087                                                                                                       | loại                         |
| `minBm25Agreement` 1 + `accentedFoldMinShare` 0,25   | 0,912     | 0,961     | `vi-semantic` +0,058                                                                                                    |                              |
| như trên + `segWeightByCoverage` false               | **0,914** | **0,961** | so với gói hiện tại: `vi-semantic` +0,065 / +0,024, `vi-synonym` +0,009 / +0,026, `vi-dd` +0,013, `vi-mixed-en*` +0,074 | **mặc định mới**             |
| `minBm25Agreement` 0,8 + `accentedFoldMinShare` 0,25 | 0,912     | 0,960     | `v0.11.0` `vi-semantic` −0,005                                                                                          |                              |

Chọn theo quy tắc: tổng nDCG@5 cao nhất, không hạng mục nào tụt quá 0,01 so với gói hiện tại trên cả hai fixture. `accentedFoldMinShare` 0,25 và `segWeightByCoverage` false nới lại hai sửa của `fb37546` cho nguyên nhân 1, 2 của vault thật; trên corpus sinh chúng chỉ thắng nhờ vài câu, nên phải đo lại trên vault thật.

Bước 5 (vault thật) cần đo thêm, lõi `v0.17.2-vantt.5` + gói nhánh này: mặc định mới; `{"accentedFoldMinShare":0.5,"segWeightByCoverage":true}` (giữ hai sửa cũ); `{"minBm25Agreement":0.2}`; `{"minBm25Agreement":0}`. Đặc biệt `vi-iy`, `vi-compound`, `vi-accented`, `vi-semantic`, `vi-mixed-en` (với note tiếng Anh) và `vi-abbr` (với lexicon) so với không gói, và câu có mã lỗi/tên sản phẩm.

## Xong khi

- [ ] Chạy lại V15 sau khi sửa: không hạng mục nào tụt quá 0,02 nDCG@5 so với không gói (cổng `private-regression` đạt), hoặc user chấp nhận từng hạng mục còn tụt kèm lý do.
- [ ] `vi-synonym`, `vi-abbr` đo với lexicon của vault.
- [ ] Eval `vi` trên corpus sinh và cổng chất lượng CI vẫn xanh.
- [ ] Báo cáo tổng hợp mới trong `vantt/reviews/`; plan này chuyển vào `vantt/plans/archive/`.
