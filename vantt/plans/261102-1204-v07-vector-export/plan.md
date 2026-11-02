---
title: "v07-vector-export"
description: "Bản vá P03 vector-export: lệnh CLI xuất vector theo note và K note gần nhất, JSON Lines; hàm lõi dùng lại cho stdio (V08)"
status: completed
priority: P1
effort: "1d"
tags: [patch, p03, v07, vector-export]
created: 2026-11-02
---

# V07: bản vá P03 `vector-export`

## Phạm vi (trích PRD 9.4, P03)

- Vấn đề: dự án đọc thẳng `vec_chunks`, `chunks`, `notes` để tính vector trung bình của note và K note gần nhất; upstream đổi schema là vỡ.
- Yêu cầu: `ohs vectors [--path <note>]… [--pooling mean|max] [--normalize]` cho `{path, dim, model, chunks, vector}` (mặc định mean rồi chuẩn hoá L2); `ohs neighbors [--path]… [--k 10] [--min-score x] [--exclude-linked] [--scope …]` cho `{path, neighbors:[{path, score}]}`, không `--path` thì cho mọi note, điểm là cosine trên vector note đã gộp, tính trong JS; đầu ra JSON Lines kèm dòng đầu `{"meta": {model, dim, pooling, note_count, ohs_version}}`; có tương đương stdio (làm ở P04/V08).
- Bất biến: chỉ đọc, không thêm bảng, model hoặc dim lệch thì báo, không trả vector sai.
- Điểm chạm: `storage/` (đọc theo lô mới), lệnh trong `transports/cli.ts`, logic gộp trong `search/`.

## Điều kiện xong (phase-02-core-patches.md, Success Criteria)

Catchup áp sạch trên `v0.17.2`; `test_command` xanh; `npm test` upstream xanh; probe trả 1 trên upstream nguyên gốc và 0 trên bản fork.

## Quyết định

1. Bản vá lõi (PRD 9.0): đọc `vec_chunks` chỉ được làm trong `storage/`; không phải hàm thuần trên chữ nên không đi đường pack.
2. Stdio: PRD gán action `vectors`/`neighbors` cho P04. P03 chỉ làm lệnh CLI và hàm lõi `exportNoteVectors`, `findNoteNeighbors` (trả `{meta, records}`), để V08 chỉ việc gọi và ghi từng bản ghi thành một dòng.
3. `--normalize` mặc định bật (PRD "mặc định chuẩn hoá L2"); thêm `--no-normalize` để lấy vector thô. Cosine của `neighbors` luôn tính trên vector đơn vị.
4. Lỗi theo từng note (`{path, error}`) thay vì bỏ qua hay bịa vector; CLI thoát mã 1 nếu có dòng lỗi.
5. `--scope` chỉ giới hạn tập ứng viên (cùng cú pháp bộ lọc `scope` của tìm kiếm, dùng `buildFilterPredicate`); nguồn là `--path` hoặc mọi note.
6. Không mở embedder: lệnh chỉ đọc DB.

## Trạng thái

Xong. Patch `vantt/patches/0003-vector-export.patch`, spec, probe `vantt/probes/vector-export.mjs`.
