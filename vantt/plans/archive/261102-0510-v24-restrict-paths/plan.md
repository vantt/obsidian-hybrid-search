---
title: "V24 P06 restrict-paths"
description: "Bản vá lõi P06: tuỳ chọn paths[] / --paths-file giới hạn mọi nhánh tìm vào một tập note, đẩy xuống SQL qua buildFilterPredicate."
status: completed
priority: P1
effort: "0,5-1 ngày"
tags: [feature, backend]
created: 2026-11-02
---

# V24 P06 `restrict-paths`

## Yêu cầu (PRD 9.0, 9.4 P06, mục tiêu G11)

> Tuỳ chọn `paths[]` (hoặc `--paths-file`) giới hạn mọi nhánh tìm vào tập note cho trước, đẩy xuống SQL như `buildFilterPredicate`.

PRD 9.0 quy tắc 1: không lọc sau top-K; lọc đi cùng `buildFilterPredicate` vào BM25, title, vector và các nhánh view của P01. Đường đã chọn: bản vá lõi.

## Điều kiện xong (phase-02-core-patches.md)

- Test và probe xanh; tìm trong tập 30 note trả đủ kết quả như tìm trên vault chỉ có 30 note đó.
- Không đặt `paths` thì hành vi y như upstream.
- `npm test`, lint, typecheck, knip, format:check của upstream xanh.

## Kết quả

- [x] `vantt/patches/0006-restrict-paths.patch`, `0006-restrict-paths.spec.md`
- [x] `vantt/probes/restrict-paths.mjs`: 1 trên upstream v0.17.2, 0 trên bản đã vá
- [x] `test/vantt/restrict-paths.test.ts` (trong bản vá): tập 30 note so với vault chỉ có 30 note, mọi chế độ, có và không có gói ngôn ngữ
- [x] Toàn bộ kiểm của upstream xanh (114 file test, 2023 test)
