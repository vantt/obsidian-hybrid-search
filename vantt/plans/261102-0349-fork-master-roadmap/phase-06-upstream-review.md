---
phase: 6
title: "Phase 6: Kiểm mỗi bản upstream mới"
status: todo
priority: P2
effort: "2d"
dependencies: [2, 5]
---

# Phase 6: Kiểm mỗi bản upstream mới

## Overview

Mỗi bản upstream mới có báo cáo: bản vá nào còn cần, upstream đã tự giải chỗ nào, chất lượng tìm tốt lên hay xấu đi. Máy làm phần dữ liệu (probe, eval, diff), agent viết báo cáo theo skill. Phục vụ G5.

## Việc

| ID | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|
| V14 | `vantt/scripts/review-upstream.mjs`: chạy probe mọi bản vá trên bản upstream mới, chạy eval upstream và eval `vi` ở cả hai bản, diff các điểm chạm của bản vá; hoàn thiện skill `.claude/skills/ohs-upstream-review/SKILL.md`; báo cáo theo mẫu PRD 12.5 ở `vantt/reviews/<tag>.md` | V06, V07, V08, V12 | vừa | 2 | 12 |

## Quy tắc riêng

- Probe dựa trên giao diện công khai (CLI, MCP, file trên đĩa), không import mã nội bộ; mã thoát 0, 1, 2 theo PRD 9.2.
- Probe của bản vá làm sau V14 (V23–V25 và các bản vá khác) do chính việc đó giao; `review-upstream.mjs` tự đọc danh sách probe từ `series.toml`.
- So sánh định tính chấm mù theo thang PRD 12.4.

## File sở hữu

- `vantt/scripts/review-upstream.mjs`, `.claude/skills/ohs-upstream-review/SKILL.md`, `vantt/reviews/<tag>.md`.

## Todo

- [x] V14 script review, probe đủ, skill hoàn thiện, báo cáo mẫu

## Success Criteria

- Chạy trên cặp `v0.17.1` → `v0.17.2` ra báo cáo đủ mục của mẫu PRD 12.5.
- Mọi bản vá có trong `series.toml` lúc chạy đều có kết quả probe.

## Ghi chú sau V14

- `review-upstream.mjs` dựng 4 cây (upstream và fork của hai tag), chạy mọi probe, eval upstream và `vi`, diff điểm chạm, tạo cặp chấm mù; 22 test xanh. Báo cáo mẫu `vantt/reviews/v0.17.2.md` (cặp `v0.17.1` → `v0.17.2`): upstream chỉ nâng phụ thuộc, 8 bản vá đều còn cần, khuyên nâng.
- Lượt chạy mẫu dựng fork với `--skip-tests --skip-quality`, chưa có P07, và số `vi` (nDCG@5 0,813) thấp hơn gói đầy đủ (0,932). Lead chạy lại báo cáo ở bước kiểm cuối trên chuỗi đủ 9 bản vá.

## Risk

- Eval không ổn định giữa nền: chỉ so hai bản trên cùng máy, cùng lần chạy.
