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

| File | Việc |
|---|---|
| `normalize.ts`, `fold.ts`, `syllable.ts`, `data.ts` | M1 (V09): chuẩn hoá giữ dấu, bỏ dấu, tách âm tiết, bảng dữ liệu |
| `views.ts` | View `norm` (chuẩn hoá giữ dấu) và `fold` (bỏ dấu, `đ→d`, tuỳ chọn i/y). Chiếu từng token, giữ nguyên ký tự phân cách, nên bất biến token của P01 đúng theo cách dựng |
| `query.ts` | `analyzeQuery`: tách token, phân loại câu có dấu, phục hồi dấu, dựng câu cho từng view, dữ liệu cho `rescore`. Có chỗ cắm ghi rõ cho lexicon (V18), alias (V19), tách từ (V20) |
| `telex.ts`, `rewrite.ts` | V17: giải chuỗi Telex/VNI gõ dở (`tieengs`, `tie6ng1` thành `tiếng`; `uow` đọc cả `ươ` lẫn `uơ`). Chỉ áp cho token không có trong từ vựng vault (hai view) mà dạng giải ra có trong view `norm`, nên "team", "seen", "online" giữ nguyên. Câu có token được giải thì `baseQuery` và `embedQuery` là câu đã giải, và các token đã giải được tính là âm tiết có dấu cho cổng `minSyllableShare` |
| `typo.ts` | V17: sửa gõ sai một chữ (thêm, bớt, thay, đảo hai chữ liền nhau) cho token không có trong vault, dài từ 3 chữ, chỉ nhận ứng viên là âm tiết Việt có trong view `fold`; tối đa 3 ứng viên, chọn theo tần suất cộng bằng chứng cặp từ liền nhau với từ bên cạnh (`phraseDocs`), dùng ứng viên tốt nhất. Chỉ đổi token của câu view và `rescore`, không đổi `baseQuery` |
| `restore.ts` | Phục hồi dấu theo từ vựng vault: ứng viên là mọi âm tiết có dấu bỏ dấu ra đúng âm tiết gõ (sinh từ bảng âm tiết), giữ những dạng có trong view `norm` (`termStats`), cặp liền nhau có thật (`phraseDocs`) được cộng điểm; k-best Viterbi; cache theo `dbVersion` |
| `rescore.ts` | Cộng điểm cho ứng viên có chữ đúng dấu của câu (hoặc của các tổ hợp phục hồi, nhân xác suất) trong tiêu đề hay đoạn trích: cả cụm, từng cặp, từng chữ. Không bỏ, không thêm ứng viên |
| `options.ts` | Tuỳ chọn và mặc định |
| `contract.ts` | Bản sao kiểu của hợp đồng P01 (gói không import lõi) |

## Hành vi theo loại câu

| Câu | `norm` | `fold` | Ghi chú |
|---|---|---|---|
| Không dấu, đủ âm tiết Việt ("giu chan khach hang") | tổ hợp phục hồi tốt nhất, thêm biến thể có xác suất biên ≥ 0,15 | câu bỏ dấu | `rescore` theo 5 tổ hợp tốt nhất |
| Có dấu một phần (≤ 50% âm tiết có dấu) | như câu không dấu, chữ có dấu giữ nguyên | câu bỏ dấu | |
| Có dấu (> 50% âm tiết có dấu) | tắt (`accentedNorm`) | chỉ bật khi vault có chính các chữ đó viết không dấu (`accentedFold: "auto"`) | BM25 upstream đã khớp chữ có dấu; `rescore` đòi đúng dấu |
| Không có dấu hiệu tiếng Việt (tiếng Anh, chuỗi Telex: dưới 50% token là âm tiết, hoặc không âm tiết nào có dạng có dấu trong vault) | tắt | tắt | Gói trơ, kết quả như upstream (trừ `rescore`) |

## Tuỳ chọn

| Tuỳ chọn | Mặc định | Vào `signature()` |
|---|---|---|
| `tonePlacement` | `"modern"` | có |
| `foldIY` | `false` | có |
| `restore` | `true` | không |
| `restoreForEmbedding`, `embedMinConfidence` | `false`, `0.8` | không (M4, V22 chốt) |
| `accentedRatio` | `0.5` | không |
| `minSyllableShare` | `0.5` | không |
| `accentedNorm` | `false` | không |
| `accentedFold` | `"auto"` | không |
| `viewWeights` | `{norm: 1.5, fold: 0.75}` | không |
| `restoreParams` | `{maxVariants: 5, maxSyllables: 12, bigramWeight: 3, unigramSmoothing: 0.5, bigramSmoothing: 0.1, maxPhraseLookups: 96, beamWidth: 16, alternativeThreshold: 0.15}` | không |
| `telex` | `true` | không |
| `typo` | `true` | không |
| `rescore` | `true` | không |
| `rescoreWeights` | `{phrase: 4, bigram: 1, coverage: 0.5, normRank: 0, unit: 1/61, semantic: 0}` | không |

Tuỳ chọn sai kiểu hay khoá lạ trong nhóm số thì `createPack` ném lỗi rõ (lõi báo trong `status.language_pack.error`). Khoá cấp trên chưa biết (`segment`…) được bỏ qua.

## Test

`npm test`: bảng M1, thuộc tính fast-check (bất biến token cho mọi view, trường, tuỳ chọn index; `rescore` giữ tập ứng viên), phục hồi với `QueryContext` giả (`test/fake-context.ts`), hiệu năng.

## Kết quả eval (V13, 2026-11-02)

Máy linux-x64, Node 24.21, model `Xenova/multilingual-e5-small`, k = 10, corpus `vi-search@v0.10.0` (363 note, 255 câu), lõi nhánh `vantt/work/p01-language-pack-api` (`ec84835`), gói với tuỳ chọn mặc định. Baseline: `vantt/eval/baselines/linux-x64/0.17.2.vi-search.json` (upstream 0.17.2, không gói).

| Hạng mục | nDCG@5 gói (Δ) | MRR gói (Δ) | Hit@1 gói | Hit@5 baseline → gói |
|---|---|---|---|---|
| Tổng | 0,813 (+0,147) | 0,795 (+0,152) | 0,725 | 0,761 → 0,886 |
| `vi-accented` | 1,000 (0) | 1,000 (0) | 1,00 | 1,00 → 1,00 |
| `vi-partial-accent` | 0,933 (+0,061) | 0,911 (+0,081) | 0,87 | 1,00 → 1,00 |
| `vi-unaccented` | 0,951 (+0,818) | 0,933 (+0,844) | 0,87 | 0,27 → **1,00** |
| `vi-dd` | 0,888 (+0,625) | 0,850 (+0,610) | 0,73 | 0,40 → **1,00** |
| `vi-tone-precision` | 1,000 (+0,049) | **1,000** (+0,067) | 1,00 | 1,00 → 1,00 |
| `vi-tone-placement`, `vi-iy` | 1,000 (0) | 1,000 (0) | 1,00 | 1,00 → 1,00 |
| `vi-compound` | 1,000 (+0,156) | 1,000 (+0,211) | 1,00 | 1,00 → 1,00 |
| `vi-typo` | 0,661 (+0,173) | 0,578 (+0,152) | 0,33 | 0,73 → 0,93 |
| `vi-snippet` | 0,743 (+0,280) | 0,719 (+0,282) | 0,60 | 0,60 → 0,87 |
| `vi-alias` | 0,814 (+0,279) | 0,752 (+0,274) | 0,60 | 0,73 → 1,00 |
| `vi-names` | 0,975 (+0,066) | 0,967 (+0,056) | 0,93 | 0,93 → 1,00 |
| `vi-telex`, `vi-mixed-en`, `vi-semantic`, `vi-synonym`, `vi-abbr` | không đổi nDCG@5 (≥ 0) | ≥ 0 | | không đổi |

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

| Chạy | `vi-telex` nDCG@5 / Hit@5 | `vi-typo` nDCG@5 / Hit@5 | Hạng mục khác |
|---|---|---|---|
| V13 (không `telex`, `typo`) | 0,333 / 0,47 | 0,661 / 0,93 | |
| `telex` | 1,000 / 1,00 | 0,661 / 0,93 | không đổi, tổng nDCG@5 0,853 |
| `typo` | 0,677 / 0,87 | 0,722 / 1,00 | `vi-semantic` MRR -0,002, tổng 0,837 |
| `telex` + `typo` | 1,000 / 1,00 | 0,722 / 1,00 | `vi-semantic` MRR -0,002, nDCG@5 không đổi, tổng 0,856 (V13: 0,813) |

Quy tắc chốt (hạng mục tốt lên, không hạng mục nào tụt quá 0,01 nDCG@5): cả hai bật mặc định. Eval upstream (`obsidian-help`) với cả hai bật: nDCG@5 0,735, MRR 0,785, Hit@5 0,879, giống hệt V13. `vi-typo` Hit@1 còn 0,40 (Hit@3 0,93): ứng viên đúng thường đứng cạnh một ứng viên phổ biến hơn.
