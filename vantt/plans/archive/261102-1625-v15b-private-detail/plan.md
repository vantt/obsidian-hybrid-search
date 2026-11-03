---
title: 'v15b-private-detail'
description: 'quality-gate --private-detail: file JSON cục bộ theo từng câu để điều tra hạng mục tụt trên vault riêng'
status: completed
priority: P1
effort: '0,3d'
tags: [vi-pack, v15b, quality-gate]
created: 2026-11-02
---

# V15b phần 1: `--private-detail`

Kết quả V15 (`reviews/v0.17.2-vantt.2.private.md`): gói giúp tổng thể nhưng `vi-iy`, `vi-accented`, `vi-compound` tụt. Số tổng hợp không đủ để điều tra, nên cổng chất lượng ghi thêm chi tiết từng câu vào file cục bộ ngoài repo.

## Đã làm

- `scripts/lib/detail-search.mjs`: chạy trong cây OHS, lập chỉ mục bản sao vault như `eval/evaluate.ts`, tìm từng câu với `explain: true`, ghi kết quả theo thứ tự cùng hạng từng nhánh và `explain.debug` của gói. `runDetail` trong `lib/eval-run.mjs` chạy nó trên bản sao vault, nuốt output của tiến trình con.
- `quality-gate.mjs`: cờ `--private-detail <file>` (chỉ với `--private`); `detailPathError` từ chối đường dẫn trong repo, `vantt/`, cây git khác, hoặc đi vào repo qua symlink (thoát 2, chưa chạy gì). File ghi `0600`; chỉ in đường dẫn.
- Tài liệu: `eval/vi/README.md` mục "Đánh giá vault riêng và điều tra hạng mục tụt" (cách điều tra, `learn-abbr`).
- Test (`scripts/test/quality-gate.test.mjs`): nội dung file, không rò nội dung ra stdout/stderr, từ chối đường dẫn, symlink, dùng sai cờ.

## Giới hạn

`explain` cần cây OHS có bản vá P01 (nhánh phát hành); trên cây upstream thuần chỉ thiếu trường `ranks`/`analysis`.

## Hết vòng này

Phần 2: người dùng chạy lệnh, đọc file chi tiết, tìm nguyên nhân từng hạng mục tụt rồi sửa gói.
