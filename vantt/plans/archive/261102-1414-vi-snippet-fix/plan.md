---
title: "vi-snippet-fix"
description: "Gói ohs-lang-vi: câu vi-snippet-08 (\"quen ngu\") rơi khỏi top 10 trên fixture v0.11.0; chứng minh nguyên nhân, kiểm lại trên nhánh V20b đã gộp master"
status: completed
priority: P1
effort: "0,3d"
tags: [vi-pack, v20b, g8-snippet]
created: 2026-11-02
---

# Sửa G8-snippet 14/15 (`vi-snippet-08`)

## Phạm vi

V20b (`261102-1321-v20b-licensed-compounds/plan.md`) báo G8-snippet 14/15 trên fixture `v0.11.0`: câu `vi-snippet-08` "quen ngu" (note đích `Thói quen ngủ sớm dậy sớm.md`) ra khỏi top 10, với mọi từ điển và cả khi tắt `segment`. Việc: chứng minh vì sao, sửa trong gói bằng cơ chế chung (không sửa riêng câu này, không sửa fixture, không đổi ngưỡng). Nhánh `vantt/work/vi-snippet-fix` = `vantt/work/v20b` gộp master (có V13b: `restoreForEmbedding` bật mặc định). Gộp không xung đột; thẻ fixture giữ `v0.11.0`.

## Tiêu chí xong

- [x] Chứng minh nguyên nhân bằng `explain` của lõi `wt-p01b` (`632209f`) với gói đã build.
- [x] G8-snippet 15/15 (`check-snippets.mjs`).
- [x] Mọi mục tiêu G3/G8 giữ; không hạng mục nào tụt quá 0,01 nDCG@5 so với cột "từ điển mới" của V20b đo lại trên cây đã gộp.
- [x] Eval upstream `obsidian-help` có gói không kém quá 0,01.
- [x] Test gói và `tsc --noEmit` sạch.

## Nguyên nhân (đã chứng minh)

`explain` cho "quen ngu", lõi `wt-p01b`, gói của nhánh này, fixture `v0.11.0`:

- Phục hồi dấu đúng: "quen ngủ" p = 0,994 (`quen:53`, `ngủ:2` note); các phương án khác ("quên ngữ", "quên ngủ") dưới 0,003. Không phải lỗi phục hồi.
- Note đích hạng 1 ở **mọi** nhánh chữ: `bm25` 1, `title` 1, `view:norm` 1, `view:fold` 1. `rescore` thấy đủ bằng chứng (cụm "quen ngủ" nằm trong đoạn trích).
- Khi `restoreForEmbedding` tắt (mặc định của V20b, trước V13b), embedder nhận "quen ngu" không dấu: note đích **không có trong nhánh vector** (`semantic: null`). Mười note mồi "Ghi chép NNN quán quen" có mặt ở cả năm nhánh, gồm vector (hạng 1–14), nên RRF xếp chúng trên note đích: hạng 11, nằm ngoài top 10.
- Bật `restoreForEmbedding` (master, V13b): embedder nhận "quen ngủ", note đích vào nhánh vector (hạng 9) và lên **hạng 1** (điểm 1,000, note sau 0,910).

Đo hạng note đích của 15 câu `vi-snippet` trên cùng index:

| Cấu hình | Hạng `vi-snippet-08` | Câu không nằm hạng 1 |
|---|---|---|
| `restoreForEmbedding: false` (như V20b) | 11 | 02 (2), 03 (5), 04 (2), 08 (11) |
| mặc định đã gộp (`restoreForEmbedding: true`) | **1** | 04 (2), 10 (2) |

Khi tắt, cả 15 câu không có note đích trong nhánh vector, trừ 01, 06, 07; nhánh vector thiếu là nguyên nhân chung, câu 08 chỉ là câu có nhiều note mồi nhất (11 note "quán quen").

Các hướng gợi ý đã xét và bỏ:

- Phục hồi hai âm tiết bằng bằng chứng bigram: phục hồi đã đúng (p 0,994), không còn gì để sửa.
- `viewTerms` khớp đúng để chặn khớp tiền tố (`ngu*` khớp "người", "nguội", thấy ở `matchedTerms`): note đích đã hạng 1 ở mọi nhánh chữ; chặn tiền tố chỉ đổi thứ tự giữa các note mồi (chúng vẫn khớp "quen"), không đưa note đích vào nhánh vector.
- Tăng trọng số `rescore` hay view để thắng khi tắt `restoreForEmbedding`: là đổi ngưỡng, ngoài phạm vi.

## Sửa

Không cần đổi mã gói: cơ chế chung là V13b (`restoreForEmbedding` bật mặc định, đã ở master). Nhánh này gộp master vào V20b và đo lại.

## Eval (lõi `wt-p01b` `632209f`, e5-small, k = 10, fixture `v0.11.0`, mặc định)

nDCG@5. "V20b" = cột "từ điển mới" của V20b (`tmp/v20b/pack-final.json`, trước khi gộp V13b); "Đã gộp" = cây này (`tmp/snip/merged.json`).

| Hạng mục | Baseline | V20b | Đã gộp | Δ |
|---|---|---|---|---|
| Tổng | 0,646 | 0,926 | **0,944** | +0,018 |
| `vi-accented` | 1,000 | 1,000 | 1,000 | 0 |
| `vi-partial-accent` | 0,863 | 1,000 | 1,000 | 0 |
| `vi-telex` | 0,333 | 1,000 | 1,000 | 0 |
| `vi-typo` | 0,543 | 0,967 | 1,000 | +0,033 |
| `vi-snippet` | 0,466 | 0,843 | **0,951** | +0,108 |
| `vi-unaccented` | 0,133 | 0,871 | 1,000 | +0,129 |
| `vi-dd` | 0,239 | 0,913 | 0,975 | +0,062 |
| `vi-iy` | 1,000 | 1,000 | 1,000 | 0 |
| `vi-tone-placement` | 1,000 | 1,000 | 1,000 | 0 |
| `vi-tone-precision` | 0,951 | 1,000 | 1,000 | 0 |
| `vi-compound` | 0,632 | 0,983 | 0,988 | +0,005 |
| `vi-mixed-en` | 1,000 | 1,000 | 1,000 | 0 |
| `vi-semantic` | 0,446 | 0,446 | 0,446 | 0 |
| `vi-names` | 0,909 | 1,000 | 1,000 | 0 |
| `vi-synonym` | 0,067 | 0,689 | 0,689 | 0 |
| `vi-abbr` | 0,933 | 1,000 | 1,000 | 0 |
| `vi-alias` | 0,477 | 0,975 | 0,959 | −0,016 |

Hit@5 đã gộp: `vi-unaccented` 1,00, `vi-dd` 1,00, `vi-telex` 1,00, `vi-typo` 1,00, `vi-synonym` 0,93, `vi-abbr` 1,00, `vi-alias` 1,00; `vi-tone-precision` MRR 1,000; `vi-compound` 0,988 ≥ 0,632 + 0,1. Mọi mục tiêu G3/G8 giữ.

`vi-alias` −0,016 so với V20b là do V13b, không do nhánh này: một câu, `vi-alias-15` "Nhat ky tap luyen" (0,631 → 0,387). embedQuery "nhật ký tập luyện" kéo các note mồi "Nhật ký NN" mới của `v0.11.0` lên nhánh vector; note đích `Fitness log.md` hạng 1 ở nhánh alias và mọi view nhưng không có trong nhánh vector, nên hạng 5 (Hit@5 vẫn 1). V13b đo trên `v0.10.0` (chưa có note "Nhật ký NN") nên không thấy. Báo lead.

`check-snippets.mjs` (bản sao vault mới): **15/15**, `matchedTermsOk` 15/15.

Eval upstream `obsidian-help` (171 note): không gói nDCG@5 0,735, MRR 0,783, Hit@5 0,879; có gói 0,735, 0,785, 0,879 (Δ nDCG@5 0,000).

Test gói 461/461; `tsc --noEmit` sạch.
