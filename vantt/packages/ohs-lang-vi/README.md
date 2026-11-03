# ohs-lang-vi

Gói ngôn ngữ tiếng Việt cho obsidian-hybrid-search, cắm vào lõi qua bản vá P01 (`LanguagePackV1`, `apiVersion: 1`). TypeScript thuần, không phụ thuộc runtime. Thiết kế: PRD mục 10.1 đến 10.3.

## Dùng

```bash
npm run build                      # ra build/index.js (ESM)
OHS_LANGUAGE_PACK=/đường/dẫn/tới/ohs-lang-vi ohs reindex
OHS_LANGUAGE_PACK_OPTIONS='{"foldIY":true}' ohs search "giu chan khach hang"
```

Export mặc định là `createPack(options)`; lõi gọi nó với JSON của `OHS_LANGUAGE_PACK_OPTIONS`.

## Mô-đun

| File                                                   | Việc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalize.ts`, `fold.ts`, `syllable.ts`, `data.ts`    | M1 (V09): chuẩn hoá giữ dấu, bỏ dấu, tách âm tiết, bảng dữ liệu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `views.ts`                                             | View `norm` (chuẩn hoá giữ dấu) và `fold` (bỏ dấu, `đ→d`, tuỳ chọn i/y). Chiếu từng token, giữ nguyên ký tự phân cách, nên bất biến token của P01 đúng theo cách dựng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `query.ts`                                             | `analyzeQuery`: tách token, phân loại câu có dấu, phục hồi dấu, dựng câu cho từng view, dữ liệu cho `rescore`. Có chỗ cắm ghi rõ cho Telex/gõ sai (V17, đã làm), lexicon (V18), alias (V19, đã làm: `alias.ts`), tách từ (V20, đã làm: `segment-query.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `telex.ts`, `rewrite.ts`                               | V17: giải chuỗi Telex/VNI gõ dở (`tieengs`, `tie6ng1` thành `tiếng`; `uow` đọc cả `ươ` lẫn `uơ`). Chỉ áp cho token không có trong từ vựng vault (hai view) mà dạng giải ra có trong view `norm`, nên "team", "seen", "online" giữ nguyên. Câu có token được giải thì `baseQuery` và `embedQuery` là câu đã giải, và các token đã giải được tính là âm tiết có dấu cho cổng `minSyllableShare`                                                                                                                                                                                                                                                                                                                                 |
| `typo.ts`                                              | V17: sửa gõ sai một chữ (thêm, bớt, thay, đảo hai chữ liền nhau) cho token không có trong vault, dài từ 3 chữ, chỉ nhận ứng viên là âm tiết Việt có trong view `fold`; tối đa 3 ứng viên, chọn theo tần suất cộng bằng chứng cặp từ liền nhau với từ bên cạnh (`phraseDocs`), dùng ứng viên tốt nhất. Chỉ đổi token của câu view và `rescore`, không đổi `baseQuery`                                                                                                                                                                                                                                                                                                                                                          |
| `restore.ts`                                           | Phục hồi dấu theo từ vựng vault: ứng viên là mọi âm tiết có dấu bỏ dấu ra đúng âm tiết gõ (sinh từ bảng âm tiết), giữ những dạng có trong view `norm` (`termStats`), cặp liền nhau có thật (`phraseDocs`) được cộng điểm; k-best Viterbi; cache theo `dbVersion`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `rescore.ts`                                           | Cộng điểm cho ứng viên có chữ đúng dấu của câu (hoặc của các tổ hợp phục hồi, nhân xác suất) trong tiêu đề hay đoạn trích: cả cụm, từng cặp (không nối qua ranh giới tiêu đề/đoạn trích), từng chữ; hai cách viết i/y (`kĩ`/`kỹ`) tính như nhau. Bỏ phiếu BM25 khi nhánh BM25 và nhánh vector không đồng thuận (`minBm25Agreement`). Không bỏ, không thêm ứng viên                                                                                                                                                                                                                                                                                                                                                            |
| `lexicon.ts`, `lexicon-query.ts`                       | V18: đọc `_ohs/lexicon.md` (ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`; mục `## Chờ duyệt` bị bỏ qua). Đồng nghĩa (hai chiều) và viết tắt (một chiều, `KH = khách hàng`) nối thêm dạng cùng nhóm vào câu view (OR) và thêm tổ hợp thay thế vào đích `rescore` (xác suất `lexiconWeight`). Chữ có dấu trong câu phải khớp đúng dấu (`lượng` không khớp `lương`), chữ không dấu khớp bỏ dấu. Từ ghép (`LexiconStore.load().compounds`) đi vào bộ tách từ V20                                                                                                                                                                                                                                                           |
| `segment.ts`, `segment-query.ts`, `data/compounds.txt` | V20: view `seg` (tokenizer có thêm `_`): âm tiết của từ ghép nối bằng `_` (`khách_hàng`), các token khác như view `norm`. Từ ghép: từ điển hai âm tiết đóng gói (nguồn, giấy phép, cách lọc ở [`data/README.md`](data/README.md)) cộng mục `## Từ ghép` của lexicon (độ dài bất kỳ). Tách theo đường ngắn nhất (ít từ nhất, hoà thì từ đầu dài hơn), chỉ nối qua khoảng trắng. Câu `seg` chỉ gồm các từ ghép của câu (câu có dấu: chính câu; câu không dấu: các tổ hợp phục hồi), tách cùng cách, cộng từ ghép khác trong câu mà view `seg` của vault có (`termStats`); null khi câu có từ không phải âm tiết Việt. Từ điển (cả từ ghép lexicon) băm vào `signature()` khi `segment` bật; lexicon đọc lại trong `signature()` |
| `abbr.ts`, `cli.ts`, `bin.ts`                          | V18: `ohs-lang-vi learn-abbr --vault <dir> [--lexicon <path>] [--min-count <n>] [--dry-run]` (`bin` của package). Đề xuất viết tắt từ mẫu định nghĩa (`khách hàng (KH)`, `KH: khách hàng`, `KH = khách hàng`) và cụm hay gặp có chữ cái đầu khớp chữ viết tắt trong vault; ghi dưới `## Chờ duyệt`, không đụng mục khác, không đề xuất lại dòng đã có, bỏ `_ohs/`, thư mục ẩn, `node_modules`                                                                                                                                                                                                                                                                                                                                 |
| `options.ts`                                           | Tuỳ chọn và mặc định                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `contract.ts`                                          | Bản sao kiểu của hợp đồng P01 (gói không import lõi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Hành vi theo loại câu

| Câu                                                                                                                                 | `norm`                                                          | `fold`                                                                        | Ghi chú                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Không dấu, đủ âm tiết Việt ("giu chan khach hang")                                                                                  | tổ hợp phục hồi tốt nhất, thêm biến thể có xác suất biên ≥ 0,15 | câu bỏ dấu                                                                    | `rescore` theo 5 tổ hợp tốt nhất                         |
| Có dấu một phần (≤ 50% âm tiết có dấu)                                                                                              | như câu không dấu, chữ có dấu giữ nguyên                        | câu bỏ dấu                                                                    |                                                          |
| Có dấu (> 50% âm tiết có dấu)                                                                                                       | tắt (`accentedNorm`)                                            | chỉ bật khi vault có chính các chữ đó viết không dấu (`accentedFold: "auto"`) | BM25 upstream đã khớp chữ có dấu; `rescore` đòi đúng dấu |
| Không có dấu hiệu tiếng Việt (tiếng Anh, chuỗi Telex: dưới 50% token là âm tiết, hoặc không âm tiết nào có dạng có dấu trong vault) | tắt                                                             | tắt                                                                           | Gói trơ, kết quả như upstream (trừ `rescore`)            |

## Tuỳ chọn

| Tuỳ chọn                                    | Mặc định                                                                                                                                                           | Vào `signature()`                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tonePlacement`                             | `"modern"`                                                                                                                                                         | có                                                                                                                                                                                                                                                                                  |
| `foldIY`                                    | `false`                                                                                                                                                            | có                                                                                                                                                                                                                                                                                  |
| `restore`                                   | `true`                                                                                                                                                             | không                                                                                                                                                                                                                                                                               |
| `restoreForEmbedding`, `embedMinConfidence` | `true`, `0.8`                                                                                                                                                      | không (bật mặc định theo eval V13b: không hạng mục nào tụt, nDCG@5 tổng +0,022). Chữ gõ có dấu không bao giờ bị đổi; câu có dấu một phần (ví dụ "Hội An") chỉ phục hồi chữ không dấu mà vault không bao giờ viết trần và có độ tin cậy đủ                                           |
| `accentedRatio`                             | `0.5`                                                                                                                                                              | không (câu có dấu khi tỉ lệ âm tiết có dấu **lớn hơn** ngưỡng, đúng PRD 10.3 "hơn 50%"; đúng 0,5 là câu có dấu một phần)                                                                                                                                                            |
| `minSyllableShare`                          | `0.5`                                                                                                                                                              | không                                                                                                                                                                                                                                                                               |
| `accentedNorm`                              | `false`                                                                                                                                                            | không                                                                                                                                                                                                                                                                               |
| `accentedFold`                              | `"auto"`                                                                                                                                                           | không                                                                                                                                                                                                                                                                               |
| `accentedFoldMinShare`                      | `0.25`                                                                                                                                                             | không (`auto`: ít nhất tỉ lệ này các cặp chữ liền nhau có dấu của câu phải có trong vault ở dạng không dấu; một cặp là đủ thì vault lớn gần như câu nào cũng bật. 0,5 → 0,25 theo fixture `v0.12.0`)                                                                                |
| `segment`                                   | `true`                                                                                                                                                             | có (bật/tắt view `seg`; băm từ điển và từ ghép lexicon)                                                                                                                                                                                                                             |
| `segMaxDocShare`                            | `0.1`                                                                                                                                                              | không (nhánh `seg` bỏ từ ghép có trong hơn tỉ lệ này số note và ít nhất 20 note; `1` giữ hết). Từ ghép chỉ gồm từ chức năng (`vì vậy`, `cho nên`) luôn bị bỏ                                                                                                                        |
| `segWeightByCoverage`                       | `false`                                                                                                                                                            | không (bật: trọng số nhánh `seg` của câu nhân với tỉ lệ chữ của câu mà các từ ghép có trong vault phủ. Tắt mặc định theo fixture `v0.12.0`)                                                                                                                                         |
| `viewWeights`                               | `{norm: 1.5, fold: 0.75, seg: 1}`                                                                                                                                  | không                                                                                                                                                                                                                                                                               |
| `restoreParams`                             | `{maxVariants: 5, maxSyllables: 12, bigramWeight: 3, unigramSmoothing: 0.5, bigramSmoothing: 0.1, maxPhraseLookups: 96, beamWidth: 16, alternativeThreshold: 0.3}` | không (`alternativeThreshold` 0,15 → 0,3 ở V15b: bớt biến thể phục hồi sai vào nhánh `norm`)                                                                                                                                                                                        |
| `lexiconPath`                               | `"_ohs/lexicon.md"` (so với vault)                                                                                                                                 | không (từ ghép trong file: có)                                                                                                                                                                                                                                                      |
| `lexiconWeight`                             | `0.6`                                                                                                                                                              | không                                                                                                                                                                                                                                                                               |
| `abbrMaxDocShare`                           | `0.05`                                                                                                                                                             | không (chữ viết tắt có dạng đầy đủ nằm trong hơn tỉ lệ này số note và ít nhất 20 note thì không thêm vào câu view, chỉ thành đích `rescore`; `1` thêm hết)                                                                                                                          |
| `telex`                                     | `true`                                                                                                                                                             | không                                                                                                                                                                                                                                                                               |
| `typo`                                      | `true`                                                                                                                                                             | không                                                                                                                                                                                                                                                                               |
| `rescore`                                   | `true`                                                                                                                                                             | không                                                                                                                                                                                                                                                                               |
| `rescoreWeights`                            | `{phrase: 4, bigram: 1, coverage: 0.5, normRank: 0, unit: 1/61, semantic: 0}`                                                                                      | không                                                                                                                                                                                                                                                                               |
| `minBm25Agreement`                          | `1`                                                                                                                                                                | không (bước trộn `hybrid`, câu tiếng Việt không có chữ lạ: khi dưới tỉ lệ này trong 5 kết quả đầu của nhánh BM25 nằm trong 10 kết quả đầu của nhánh vector, phiếu BM25 nhân với tỉ lệ / ngưỡng; nhánh BM25 ít hơn 5 kết quả thì giữ phiếu; `0` tắt. 0,2 → 1 theo fixture `v0.12.0`) |

Tuỳ chọn sai kiểu hay khoá lạ trong nhóm số thì `createPack` ném lỗi rõ (lõi báo trong `status.language_pack.error`). Khoá cấp trên chưa biết được bỏ qua.

## Test

`npm test`: bảng M1, thuộc tính fast-check (bất biến token cho mọi view, trường, tuỳ chọn index; `rescore` giữ tập ứng viên), phục hồi với `QueryContext` giả (`test/fake-context.ts`), hiệu năng.

## Kết quả eval (V13, 2026-11-02)

Máy linux-x64, Node 24.21, model `Xenova/multilingual-e5-small`, k = 10, corpus `vi-search@v0.10.0` (363 note, 255 câu), lõi nhánh `vantt/work/p01-language-pack-api` (`ec84835`), gói với tuỳ chọn mặc định. Baseline: `vantt/eval/baselines/linux-x64/0.17.2.vi-search.json` (upstream 0.17.2, không gói).

| Hạng mục                                                          | nDCG@5 gói (Δ)         | MRR gói (Δ)        | Hit@1 gói | Hit@5 baseline → gói |
| ----------------------------------------------------------------- | ---------------------- | ------------------ | --------- | -------------------- |
| Tổng                                                              | 0,813 (+0,147)         | 0,795 (+0,152)     | 0,725     | 0,761 → 0,886        |
| `vi-accented`                                                     | 1,000 (0)              | 1,000 (0)          | 1,00      | 1,00 → 1,00          |
| `vi-partial-accent`                                               | 0,933 (+0,061)         | 0,911 (+0,081)     | 0,87      | 1,00 → 1,00          |
| `vi-unaccented`                                                   | 0,951 (+0,818)         | 0,933 (+0,844)     | 0,87      | 0,27 → **1,00**      |
| `vi-dd`                                                           | 0,888 (+0,625)         | 0,850 (+0,610)     | 0,73      | 0,40 → **1,00**      |
| `vi-tone-precision`                                               | 1,000 (+0,049)         | **1,000** (+0,067) | 1,00      | 1,00 → 1,00          |
| `vi-tone-placement`, `vi-iy`                                      | 1,000 (0)              | 1,000 (0)          | 1,00      | 1,00 → 1,00          |
| `vi-compound`                                                     | 1,000 (+0,156)         | 1,000 (+0,211)     | 1,00      | 1,00 → 1,00          |
| `vi-typo`                                                         | 0,661 (+0,173)         | 0,578 (+0,152)     | 0,33      | 0,73 → 0,93          |
| `vi-snippet`                                                      | 0,743 (+0,280)         | 0,719 (+0,282)     | 0,60      | 0,60 → 0,87          |
| `vi-alias`                                                        | 0,814 (+0,279)         | 0,752 (+0,274)     | 0,60      | 0,73 → 1,00          |
| `vi-names`                                                        | 0,975 (+0,066)         | 0,967 (+0,056)     | 0,93      | 0,93 → 1,00          |
| `vi-telex`, `vi-mixed-en`, `vi-semantic`, `vi-synonym`, `vi-abbr` | không đổi nDCG@5 (≥ 0) | ≥ 0                |           | không đổi            |

Mục tiêu G3: `vi-unaccented`, `vi-dd` Hit@5 1,00 (≥ 0,85, gấp 3,7 và 2,5 lần baseline); `vi-accented` không tụt; `vi-tone-precision` MRR 1,00. Không hạng mục nào tụt.

Eval upstream (`fixtures/obsidian-help`, 171 note tiếng Anh) có gói so với không gói: nDCG@5 0,735 → 0,735 (Δ 0,000), MRR 0,783 → 0,785, Hit@5 0,879 → 0,879.

Smoke-vault: tổng nDCG@5 +0,077 so với baseline smoke, không hạng nào tụt.

Hiệu năng (test `perf.test.ts`): `project` 1 MB khoảng 40 ms mỗi view (NFC và NFD, gói mới tạo); `analyzeQuery` 12 âm tiết, từ vựng 50.000 term: 1,8 ms nguội, 0,5 ms sau khi DB đổi, 0,2 ms nóng.

Chốt bằng eval (quét trên index dựng một lần, đổi tuỳ chọn lúc tìm):

- `bigramWeight` 1 → 3: `vi-dd` Hit@5 0,67 → 1,00 (tên riêng như "Đồng Khởi" thua âm tiết hay gặp "dòng khỏi" nếu cặp có thật không đủ nặng). 5 không hơn 3.
- Trọng số view 1,5/0,75 hơn mọi mức thấp hơn (1,0/0,5 làm `vi-unaccented` Hit@5 còn 0,93; 0,75/0,5 còn 0,47).
- Câu có dấu: bật nhánh `norm` hoặc `fold` làm `vi-semantic` tụt 0,083 nDCG@5 (thêm nhánh chữ lấn nhánh vector), nên mặc định tắt cả hai; `fold` bật lại khi vault có chính các chữ viết không dấu (`accentedFold: "auto"`), để note gõ không dấu vẫn tìm được. Cộng bù cho nhánh vector trong `rescore` (`rescoreWeights.semantic`) không gỡ được tụt này nên để 0.
- `minSyllableShare` 0,5: chuỗi Telex có vài âm tiết thật ("chaan dung") làm phục hồi sai và kéo `vi-telex` tụt 0,076; có ngưỡng thì về đúng baseline (V17 sẽ giải Telex trước bước này).
- `rescoreWeights` {4, 1, 0,5} hơn {1, 0,5, 0,5}: `vi-compound` 0,917 → 1,000, `vi-dd` 0,820 → 0,888; `alternativeThreshold` 0,15 đưa `vi-tone-precision` MRR lên 1,00.

## Kết quả eval V17 (2026-11-02)

Cùng máy, corpus, model và lõi (`chk-series`) như V13; so với kết quả V13 (`vi-pack-final.json`). Mỗi dòng là một lần chạy đủ 255 câu.

| Chạy                        | `vi-telex` nDCG@5 / Hit@5 | `vi-typo` nDCG@5 / Hit@5 | Hạng mục khác                                                       |
| --------------------------- | ------------------------- | ------------------------ | ------------------------------------------------------------------- |
| V13 (không `telex`, `typo`) | 0,333 / 0,47              | 0,661 / 0,93             |                                                                     |
| `telex`                     | 1,000 / 1,00              | 0,661 / 0,93             | không đổi, tổng nDCG@5 0,853                                        |
| `typo`                      | 0,677 / 0,87              | 0,722 / 1,00             | `vi-semantic` MRR -0,002, tổng 0,837                                |
| `telex` + `typo`            | 1,000 / 1,00              | 0,722 / 1,00             | `vi-semantic` MRR -0,002, nDCG@5 không đổi, tổng 0,856 (V13: 0,813) |

Quy tắc chốt (hạng mục tốt lên, không hạng mục nào tụt quá 0,01 nDCG@5): cả hai bật mặc định. Eval upstream (`obsidian-help`) với cả hai bật: nDCG@5 0,735, MRR 0,785, Hit@5 0,879, giống hệt V13. `vi-typo` Hit@1 còn 0,40 (Hit@3 0,93): ứng viên đúng thường đứng cạnh một ứng viên phổ biến hơn.

## Lexicon (V18, 2026-11-02)

Đồng nghĩa và viết tắt chỉ mở rộng câu tìm, nên đi vào `queryCacheKey()` (băm phần đã phân tích của hai mục, nên sửa mục `## Chờ duyệt` hay ghi chú không làm mất cache); `signature()` chỉ đổi khi danh sách từ ghép đổi (`;compounds=<băm>`). Test `test/lexicon.test.ts` kiểm: đổi đồng nghĩa hay viết tắt giữ nguyên `signature()` (lõi không dựng lại index), đổi từ ghép thì `signature()` đổi.

`signature()` và `queryCacheKey()` không nhận `QueryContext` (hợp đồng P01), nên gói lấy vault từ lần `analyzeQuery` gần nhất, chưa có thì từ biến môi trường `OBSIDIAN_VAULT_PATH`. File được đọc lại mỗi lần gọi (nhỏ), phân tích lại chỉ khi nội dung đổi.

Eval (cùng lõi `chk-series`, cùng tuỳ chọn mặc định), nDCG@5 / Hit@5, baseline → V13 → V18:

| Hạng mục        | baseline     | V13          | V18                              |
| --------------- | ------------ | ------------ | -------------------------------- |
| Tổng nDCG@5     | 0,666        | 0,813        | 0,851                            |
| `vi-synonym`    | 0,067 / 0,13 | 0,067 / 0,13 | **0,645 / 0,80**                 |
| `vi-abbr`       | 0,933 / 0,93 | 0,933 / 0,93 | **1,000 / 1,00**                 |
| 15 hạng còn lại |              |              | không đổi so với V13 (Δ = 0,000) |

Câu `vi-synonym` còn trượt: "xe hơi" (note ghi "ô tô"), "kinh phí" (hạng 9), "giao kèo" (hạng 10). Lần đo đầu so khớp chữ bỏ dấu cho cả chữ có dấu ("lượng" kích hoạt nhóm "lương") làm `vi-semantic` tụt 0,013; sửa thành chữ có dấu phải khớp đúng dấu thì không hạng nào đổi.

## Tách từ (V20, 2026-11-02)

Eval mặc định (lõi `chk-series` `4c69fbf`), nDCG@5 so với V17+V18+V19 đã trộn: tổng 0,909 → 0,932; `vi-typo` 0,722 → 0,975; `vi-synonym` 0,645 → 0,729 (Hit@5 0,80 → 1,00); `vi-snippet` 0,743 → 0,777; `vi-alias` 0,975 → 1,000; 12 hạng còn lại không đổi. `vi-compound` 1,000 (baseline upstream 0,844) đã bão hoà từ V13; trên bộ từ ghép khó hơn (note mồi có hai âm tiết đảo hay rời nhau nhiều lần, `vantt/plans/archive/261102-1221-v20-word-segmentation/hard-compound-gen.mjs`) seg đưa câu có dấu 0,779 → 1,000, câu không dấu 0,523 → 0,864, cụm trong câu dài 0,788 → 1,000. Eval tiếng Anh upstream giữ 0,735. Nên `segment` mặc định bật.

- Câu trộn tiếng Anh không dùng nhánh seg: bật cho mọi câu làm `vi-mixed-en` tụt 0,033 ("kiểm tra code trước khi merge" kéo note có "kiểm tra" lên trên note đích); trọng số 0,5 hay 0,75 không gỡ được.
- Chỉ giữ từ điển hai âm tiết: từ ba âm tiết trở lên nuốt âm tiết của từ sau khi khớp dài nhất (`an toàn khu` + `vực`).
- Hiệu năng: `project` seg 1 MB 67–114 ms (tuỳ tải máy); nạp từ điển 30–100 ms một lần mỗi tiến trình; dung lượng `data/compounds.txt` 266 KB (gzip 86 KB) ở bản V20.

## Từ điển từ ghép học thống kê (V20b, 2026-11-02)

Từ điển pyvi (MIT, nguồn gốc không rõ) được thay bằng 20.523 từ hai âm tiết chọn bằng thống kê cặp âm tiết trên ba dataset CC BY 4.0 (ALT, Nemotron-Personas-Vietnam, văn bản pháp luật vbpl.vn), dựng lại được bằng `scripts/build-compounds.mjs`; nguồn, cách chọn và ranh giới dùng pyvi (chỉ lúc phát triển, để đo) ở [`data/README.md`](data/README.md), ghi công ở [`data/ATTRIBUTION.md`](data/ATTRIBUTION.md). File 242 KB (gzip 78 KB). `segment` vẫn mặc định bật.

Thiếu `data/compounds.txt` (gói cài thiếu thư mục `data/`) hay file rỗng thì `createPack` ném lỗi khi `segment` bật, nên lõi P01 báo lỗi trong `status.language_pack.error` thay vì chạy lặng lẽ như không có gói. Test kiểm `npm pack` có `data/compounds.txt`, `data/README.md`, `data/ATTRIBUTION.md`.

Eval (fixture `vi-search@v0.11.0`: thêm 15 câu `vi-compound` khó, lõi `wt-p01b` `632209f`, mặc định), nDCG@5: baseline upstream / gói không tách từ / từ điển pyvi / từ điển mới.

| Hạng mục               | Baseline | Không seg | pyvi  | Mới           |
| ---------------------- | -------- | --------- | ----- | ------------- |
| Tổng                   | 0,646    | 0,889     | 0,921 | **0,926**     |
| `vi-compound` (30 câu) | 0,632    | 0,822     | 0,971 | **0,983**     |
| ↳ 15 câu khó           | 0,421    | 0,645     | 0,942 | **0,967**     |
| `vi-snippet`           | 0,466    | 0,752     | 0,777 | **0,843**     |
| 15 hạng còn lại        |          |           |       | bằng bản pyvi |

## Kết quả eval V13b: `restoreForEmbedding` (2026-11-02)

Sửa lỗi câu có dấu một phần ("Hội An" thành "hội ăn" trong `embedQuery`). nDCG@5, bộ `vi` 363 note, e5-small, rerank tắt, cây OHS `wt-p01b`:

| Hạng mục                        | `restoreForEmbedding` tắt | bật            |
| ------------------------------- | ------------------------- | -------------- |
| Tổng                            | 0,932                     | 0,954 (+0,022) |
| `vi-snippet`                    | 0,777                     | 0,975          |
| `vi-dd`                         | 0,888                     | 0,975          |
| `vi-unaccented`                 | 0,951                     | 1,000          |
| `vi-typo`                       | 0,975                     | 1,000          |
| `vi-names`, `vi-partial-accent` | 1,000                     | 1,000          |
| các hạng mục còn lại            | không đổi                 | không đổi      |

Không hạng mục nào tụt, Hit@5 tổng 0,976 → 0,984, nên mặc định đổi thành `true`.

## V15b: sửa hạng mục tụt trên vault thật (2026-11-02)

Nguyên nhân dạng chung đo trên vault thật ở `vantt/plans/261102-1825-v15b-real-vault-regressions/plan.md`; mọi thay đổi chỉ ở lúc tìm (`signature()` không đổi, không dựng lại index), qua hợp đồng P01 (`viewTerms`, `viewWeights`, thứ hạng theo nhánh trong `rescore`).

- Bước trộn `hybrid` (`minBm25Agreement`): RRF tính phiếu theo hạng, nên note chỉ khớp vài chữ thường gặp của câu hỏi theo ý vẫn lấy phiếu BM25 hạng đầu và đè đáp án của nhánh vector. Khi không note nào trong 5 kết quả đầu của BM25 nằm trong 10 kết quả đầu của vector, `rescore` trừ phiếu BM25 (nhánh view của gói giữ phiếu: chúng mang bằng chứng dấu, từ ghép, lexicon mà vector không có). Chỉ cho câu tiếng Việt; câu tiếng Anh giữ nguyên.
- i/y (`kĩ`/`kỹ`): khi `foldIY` tắt, cách viết kia (nếu vault có) vào câu `norm`/`fold` dạng term khớp đúng (`viewTerms`) và vào câu `seg`; `rescore` coi hai cách viết là một.
- `accentedFold: "auto"` cần ít nhất nửa số cặp chữ của câu có trong vault ở dạng không dấu (`accentedFoldMinShare`).
- Nhánh `seg`: bỏ từ ghép toàn từ chức năng và từ ghép phổ biến (`segMaxDocShare`); trọng số theo phần câu được phủ (`segWeightByCoverage`).
- Viết tắt có dạng đầy đủ phổ biến (`abbrMaxDocShare`) chỉ là đích `rescore`, không vào câu view.
- `restoreParams.alternativeThreshold` 0,15 → 0,3.

Eval corpus sinh (`vi-search@v0.11.0`, lõi `v0.17.2-vantt.4`, e5-small, k = 10), nDCG@5: baseline upstream / gói trước V15b / gói V15b.

| Hạng mục        | Baseline | Trước | V15b           |
| --------------- | -------- | ----- | -------------- |
| Tổng            | 0,646    | 0,944 | **0,959**      |
| `vi-semantic`   | 0,446    | 0,446 | **0,564**      |
| `vi-synonym`    | 0,067    | 0,689 | **0,739**      |
| `vi-alias`      | 0,477    | 0,959 | **1,000**      |
| `vi-compound`   | 0,632    | 0,988 | **1,000**      |
| `vi-dd`         | 0,239    | 0,975 | **1,000**      |
| 12 hạng còn lại |          |       | bằng gói trước |

Eval tiếng Anh `obsidian-help`: 0,735, 58 danh sách top 10 giống hệt gói trước. Smoke-vault 0,906 như trước; `check-snippets` 15/15. Corpus sinh không tái hiện được các nguyên nhân i/y, `seg`, `accentedFold`, viết tắt của vault thật (các hạng đó đã 1,000), nên các thay đổi đó được kiểm bằng test tổng hợp (`test/fusion-and-spelling.test.ts`) và phải đo lại trên vault thật (V15b bước 5).

## Fixture `vi-search@v0.12.0` và sửa sau review (2026-11-03)

Fixture thêm 45 câu tái hiện nguyên nhân tụt trên vault thật (trường `cause`; xem `vantt/eval/vi/README.md`). Số đo, các biến thể tuỳ chọn đã thử: `vantt/plans/261102-1825-v15b-real-vault-regressions/plan.md`, mục "Kết quả fixture v0.12.0".

- Mặc định đổi: `minBm25Agreement` 0,2 → 1, `accentedFoldMinShare` 0,5 → 0,25, `segWeightByCoverage` true → false (tổng nDCG@5 trên `v0.12.0` 0,908 → 0,914, trên `v0.11.0` 0,959 → 0,961, không hạng mục nào tụt).
- Phiếu BM25 chỉ bị trừ khi nhánh BM25 có đủ 5 kết quả và câu không có chữ nào ngoài âm tiết tiếng Việt (mã lỗi, số hiệu, tên sản phẩm như `ECONNRESET`, `SE3`): khi đó khớp đúng của BM25 là bằng chứng nhánh vector không có.
- i/y: âm tiết có thanh (`kĩ`/`kỹ`, `lí`/`lý`) thêm cách viết kia dạng term khớp đúng như trước. Âm tiết không thanh (`mi`, `ty`, và mọi chữ của view `fold`) chỉ thêm cách viết kia dạng cụm hai chữ với chữ bên cạnh của câu (`ki nang`), vì `my`, `ti`, `ki` đứng riêng là chữ khác (tiếng Anh "my", `công ty`, mọi `kì`/`kí`).
- Nhánh `seg`: chỉ từ ghép có trong vault mới tính vào phần câu được phủ (kể cả cách viết i/y kia và từ ghép của dạng lexicon); phủ 0 thì không tìm nhánh `seg`.
- Thống kê vault (`termStats`, `phraseDocs`, `noteCount`) của `seg`, lexicon và biến thể i/y đi qua bộ nhớ đệm theo `dbVersion`; kiểm `accentedFold: "auto"` dừng khi đã đủ hoặc không thể đủ số cặp.
- `explain.debug` có thêm `viewTerms`, `segWeight`, `bm25Agreement`, `bm25Penalty`.
