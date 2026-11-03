---
title: 'v14-upstream-review'
description: 'V14: review-upstream.mjs, hoàn thiện skill ohs-upstream-review, báo cáo mẫu v0.17.2'
status: completed
priority: P2
effort: '2d'
tags: [review, v14, upstream]
created: 2026-11-02
---

# V14: kiểm bản upstream mới

## Kết quả cần có (PRD 12, phase 06)

- `vantt/scripts/review-upstream.mjs`: dựng bốn cây (upstream mới, upstream cũ, fork cũ, fork mới), chạy probe của mọi bản vá trong `series.toml` trên cả bốn, kiểm bản vá áp được không ở hai tag, diff các điểm chạm giữa hai tag, chạy eval upstream và eval `vi` ba phía (fork mới chạy thêm không gói), tạo cặp so sánh mù. Xuất `vantt/reviews/<tag>.data.json`.
- Skill `.claude/skills/ohs-upstream-review/SKILL.md` hoàn chỉnh, gồm chấm mù theo thang PRD 12.4 và lệnh `--unblind`.
- Báo cáo mẫu `vantt/reviews/v0.17.2.md` (cặp `v0.17.1` → `v0.17.2`) đủ mục mẫu PRD 12.5.

## Không làm

- Không sửa `series.toml`, không đẩy gì lên remote, không đụng `catchup.mjs`, `invariance.mjs`, `quality-gate.mjs`.

## Chọn lựa

- Script chạy trong một clone làm việc (nhánh `vantt/<tag>` do catchup dựng, dependencies dùng chung nếu lock giống); probe, series, eval, gói ngôn ngữ lấy từ repo chứa script.
- Phần thuần nằm ở `scripts/lib/review-core.mjs`, phần có tác dụng phụ ở `review-run.mjs`; test ở `scripts/test/review-upstream-*.test.mjs`.
- Chấm mù do agent làm trên `pairs.json` (không có tên phía); khoá A/B ở `key.json`, chỉ đọc sau khi chấm xong (`--unblind`).

## Xong khi

Test xanh; chạy trên `v0.17.1` → `v0.17.2` ra data JSON có kết quả probe cho mọi bản vá; báo cáo đủ mục.
