---
title: 'v21-lang-de'
description: 'Gói ngôn ngữ thứ hai ohs-lang-de chạy qua hợp đồng P01, không sửa lõi (G9)'
status: completed
priority: P1
created: 2026-11-02
---

# v21-lang-de

## Kết quả cần đạt

Gói `vantt/packages/ohs-lang-de/` (TypeScript thuần, không phụ thuộc runtime): `ä` khớp `a` và `ae`, `ß` khớp `ss`, từ ghép dài được tách. Chạy qua P01 mà không sửa lõi; không bật gói thì giống upstream; eval tiếng Đức có gói không thấp hơn không gói.

## Không làm

Không sửa lõi hay bản vá P01; không dùng văn bản thật; không commit trong cây chung.

## Các bước

| #   | Việc                                                                                        | Trạng thái |
| --- | ------------------------------------------------------------------------------------------- | ---------- |
| 1   | Gói: fold, tách từ ghép (lexicon nhỏ + Fugenelemente), project, analyzeQuery, alias view    | xong       |
| 2   | Test đơn vị và thuộc tính bất biến token (fast-check)                                       | xong       |
| 3   | Golden set tổng hợp (22 note, 39 câu) và `scripts/run-eval.mjs` (tích hợp qua OHS dựng sẵn) | xong       |
| 4   | Xác nhận bất biến không-gói bằng test `test/vantt` của P01 (36 test xanh)                   | xong       |
| 5   | README tiếng Việt kèm số đo                                                                 | xong       |

## Tiêu chí nghiệm thu

- [x] Chạy qua P01 không sửa lõi (worktree `wt-v21` sạch, chỉ symlink thư mục phụ thuộc).
- [x] Bất biến xanh.
- [x] Eval có gói >= không gói ở mọi nhóm (số trong README của gói).

## Rủi ro

Lexicon nhỏ nên chỉ tách các thành phần có trong danh sách; mở rộng bằng tuỳ chọn `extraWords`.
