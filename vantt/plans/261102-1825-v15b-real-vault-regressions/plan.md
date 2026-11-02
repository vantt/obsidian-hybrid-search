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
| 2 | Chạy trên vault thật: `node vantt/scripts/quality-gate.mjs --private <golden-set.json> --vault <bản sao vault> --with-lang vi --out <report.json> --private-detail <file ngoài repo>.json --k 30`; gửi nguyên nhân dạng chung cho từng hạng mục tụt | user | Chờ |
| 3 | Lexicon khởi đầu: `ohs-lang-vi learn-abbr --vault <vault>` (thêm `--dry-run` để xem trước), user duyệt `## Chờ duyệt` sang `## Viết tắt`, thêm đồng nghĩa quen dùng | user | Chờ |
| 4 | Sửa gói `vi` theo nguyên nhân; đo lại eval `vi` trên corpus sinh (không hạng mục nào tụt quá 0,01, G3/G8 còn đạt) | agent | Chờ bước 2 |
| 5 | Chạy lại V15 trên vault thật, ghi số tổng hợp mới vào `vantt/reviews/` | user + lead | Chờ bước 4 |

Hướng dẫn chi tiết: `vantt/eval/vi/README.md` (mục `--private-detail` và `learn-abbr`).

## Xong khi

- [ ] Chạy lại V15 sau khi sửa: không hạng mục nào tụt quá 0,02 nDCG@5 so với không gói (cổng `private-regression` đạt), hoặc user chấp nhận từng hạng mục còn tụt kèm lý do.
- [ ] `vi-synonym`, `vi-abbr` đo với lexicon của vault.
- [ ] Eval `vi` trên corpus sinh và cổng chất lượng CI vẫn xanh.
- [ ] Báo cáo tổng hợp mới trong `vantt/reviews/`; plan này chuyển vào `vantt/plans/archive/`.
