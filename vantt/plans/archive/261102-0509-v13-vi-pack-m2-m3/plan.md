---
title: 'v13-vi-pack-m2-m3'
description: 'Gói ohs-lang-vi M2 + M3: view norm/fold, analyzeQuery, phục hồi dấu (Viterbi), rescore, LanguagePackV1; chốt tham số bằng eval'
status: completed
priority: P1
effort: '3,5d'
tags: [vi-pack, v13]
created: 2026-11-02
---

# V13: ohs-lang-vi M2 + M3

## Phạm vi

PRD 10.3, 10.5 bước 3 và 4; phase-04 việc V13. Chỉ sửa `vantt/packages/ohs-lang-vi/**`. Lõi: nhánh `vantt/work/p01-language-pack-api` (`ec84835`), không sửa.

- `views.ts` (`norm`, `fold`), `query.ts` (`analyzeQuery`), `restore.ts`, `rescore.ts`, `options.ts`, `contract.ts`, `index.ts` (`createPack`, export mặc định).
- Test: `test/pack.test.ts`, `test/restore.test.ts`, `test/fake-context.ts`, thêm phần M2/M3 vào `test/perf.test.ts`.

## Tiêu chí xong

- [x] G3 trên corpus sinh: `vi-unaccented` Hit@5 0,27 → 1,00; `vi-dd` 0,40 → 1,00 (≥ 0,85 và ≥ 2× baseline); `vi-accented` không tụt (1,00); `vi-tone-precision` MRR 1,00.
- [x] Eval upstream (obsidian-help) có gói: nDCG@5 0,735 → 0,735 (không tụt quá 0,01).
- [x] `analyzeQuery` 12 âm tiết, từ vựng 50.000 term: 1,8 ms nguội (< 20 ms). `project` 1 MB: khoảng 40 ms mỗi view (< 200 ms).
- [x] `npm test` xanh (8 file, 383 test), `tsc --noEmit` sạch, `tsc -p tsconfig.build.json` build được.
- [x] Số eval ghi ở `vantt/packages/ohs-lang-vi/README.md` mục "Kết quả eval".

## Quyết định

1. **Ứng viên phục hồi sinh từ bảng âm tiết**, không quét fts5vocab: mọi âm tiết có dấu bỏ dấu ra đúng âm tiết gõ, rồi `termStats('norm', …)`; `termStats('fold', …) = 0` thì bỏ qua sớm. Chi phí mỗi câu không phụ thuộc cỡ từ vựng. Cache theo `dbVersion`. PRD gợi ý dựng bảng ngược fold→norm từ `termsWithPrefix`; không cần vì cách trên rẻ hơn (và `readViewTermsWithPrefix` của P01 quét tới cuối vocab).
2. **Viterbi k-best** (4 đường mỗi trạng thái, giữ 16 tổ hợp), điểm unigram `log((docs+0,5)/(Σ+0,5k))` cộng `bigramWeight·log1p(phraseDocs/0,1)`; tối đa 96 lần `phraseDocs` mỗi câu.
3. **Câu có dấu không dùng view** (trừ `fold` khi vault có chính các chữ viết không dấu): đo được nhánh chữ thêm vào làm `vi-semantic` tụt 0,083 nDCG@5; BM25 upstream đã khớp chữ có dấu, `rescore` lo đúng dấu. Lệch so với bảng PRD 10.3 ("câu có dấu → norm = câu chuẩn hoá, fold = câu bỏ dấu"); bật lại bằng `accentedNorm: true`, `accentedFold: "always"`.
4. **Gói trơ** khi câu không có dấu hiệu tiếng Việt (dưới 50% token là âm tiết, hoặc không âm tiết nào có dạng có dấu trong vault): giữ eval tiếng Anh và `vi-telex` đúng baseline.
5. **Chiếu từng token**, ký tự phân cách giữ nguyên: NFC tách vài ký hiệu (U+1D15E) thành ký hiệu + dấu tổ hợp (ký tự token với unicode61), và bỏ dấu xoá được token chỉ gồm dấu tổ hợp; cả hai phá bất biến token nếu chiếu cả chuỗi. Cache token mỗi gói: 1 MB từ khoảng 150 ms xuống 40 ms.
6. **Sửa bảng M1**: `parseSyllable` từ chối `kỹ`, `lý`, `mỹ`, `hy` (y mở sau phụ âm). Thêm nucleus `y` mở với ràng buộc `'iy'` (phụ âm đầu trong `IY_ONSETS` trừ `qu`) ở `data.ts` và `syllable.ts`. Test M1 cũ vẫn xanh.
7. `rescore`: điểm cộng = `unit · Σ_k p_k · (4·cụm + 1·cặp + 0,5·phủ)` trên 5 tổ hợp phục hồi tốt nhất (câu có dấu: chính câu, p = 1), so trên tiêu đề + đoạn trích đã chuẩn hoá; `unit = 1/61`.
8. Chữ ký (`signature()`) = `0.2.0;tone=<tonePlacement>;iy=<0|1>`; trọng số và tham số lúc tìm không vào chữ ký.

## Eval

Lệnh (TMPDIR ngoài /tmp):

```bash
TMPDIR=/home/vantt/projects/ohs-wt/tmp/v13 node vantt/eval/vi/run-eval.mjs --ohs /home/vantt/projects/ohs-wt/wt-v13 \
  --lang-pack /home/vantt/projects/obsidian-hybrid-search/vantt/packages/ohs-lang-vi --out <a.json>
node vantt/eval/vi/run-eval.mjs --compare vantt/eval/baselines/linux-x64/0.17.2.vi-search.json <a.json>
```

| Hạng mục            | nDCG@5 baseline → gói | MRR           | Hit@5         |
| ------------------- | --------------------- | ------------- | ------------- |
| Tổng                | 0,666 → 0,813         | 0,643 → 0,795 | 0,761 → 0,886 |
| `vi-accented`       | 1,000 → 1,000         | 1,000 → 1,000 | 1,00 → 1,00   |
| `vi-partial-accent` | 0,872 → 0,933         | 0,830 → 0,911 | 1,00 → 1,00   |
| `vi-unaccented`     | 0,133 → 0,951         | 0,089 → 0,933 | 0,27 → 1,00   |
| `vi-dd`             | 0,263 → 0,888         | 0,240 → 0,850 | 0,40 → 1,00   |
| `vi-tone-precision` | 0,951 → 1,000         | 0,933 → 1,000 | 1,00 → 1,00   |
| `vi-compound`       | 0,844 → 1,000         | 0,789 → 1,000 | 1,00 → 1,00   |
| `vi-typo`           | 0,488 → 0,661         | 0,426 → 0,578 | 0,73 → 0,93   |
| `vi-snippet`        | 0,463 → 0,743         | 0,437 → 0,719 | 0,60 → 0,87   |
| `vi-alias`          | 0,535 → 0,814         | 0,478 → 0,752 | 0,73 → 1,00   |
| `vi-names`          | 0,909 → 0,975         | 0,911 → 0,967 | 0,93 → 1,00   |
| các hạng còn lại    | không đổi             | ≥ 0           | không đổi     |

Upstream obsidian-help có gói: nDCG@5 0,735 → 0,735. Smoke: tổng nDCG@5 +0,077, không hạng nào tụt. Chi tiết các lần quét tham số: README của gói.

## Còn lại / cho việc sau

- V17 (Telex/gõ sai) chèn ở bước 1 của `query.ts`; `minSyllableShare` hiện chặn chuỗi Telex, sau V17 phân loại chạy trên token đã giải.
- V18: `queryCacheKey()` và mở rộng câu ở chỗ cắm sau `restoreAccents`. V19: `aliasViews`, `aliasKeys` trong `buildAnalysis`. V20: view `seg`, băm từ điển vào `signature()`.
- M4 (V22): `restoreForEmbedding` đã có, mặc định tắt, chưa đo.
