---
title: 'V22: đợt eval nhánh nghĩa'
status: completed
created: 2026-11-02
---

# V22: đợt eval nhánh nghĩa

Trạng thái: hoàn thành (xem `vantt/reviews/semantic-eval-2026-11-02.md`).

## Kết quả cần có

Chọn model nhúng, `restoreForEmbedding` (Q3) và bật/tắt reranker cho bộ cài dự án (PRD 2.1 G10, 15 Q3). Lõi giữ model mặc định của upstream.

## Ngoài phạm vi

Đổi model mặc định trong lõi; sửa gói `ohs-lang-vi`; đo trên vault thật của user.

## Cách đo

- `vantt/scripts/semantic-eval.mjs` (điều phối) và `vantt/scripts/lib/semantic-worker.mjs` (từng bước, chạy trong cây OHS bằng tsx); `vantt/scripts/lib/semantic-export-onnx.py` xuất model chưa có ONNX.
- Mỗi model index một lần (`OBSIDIAN_DB_PATH` riêng); với mỗi giá trị `restoreForEmbedding` chạy một tiến trình tìm, trong đó chạy cả rerank tắt và bật trên cùng index.
- Corpus `vi-search@v0.10.0`, 363 note, 255 câu; 4 luồng ONNX (mô phỏng máy 4 nhân); cache, DB, log dưới `/home/vantt/projects/ohs-wt/tmp/v22`.

## Tiêu chí đạt

- [x] Bốn model × 2 × 2 biến thể, đủ nDCG@5, Hit@5, tách cặp, thời gian index, thời gian mỗi câu, RAM, dung lượng
- [x] Báo cáo có bảng và đề xuất
