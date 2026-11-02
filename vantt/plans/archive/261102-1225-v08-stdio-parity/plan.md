---
title: "v08-stdio-parity"
description: "Bản vá P04 stdio-parity: action read, vectors, neighbors, reindex cho serve --stdio; chờ request đang chạy khi stdin đóng"
status: completed
priority: P1
effort: "1d"
tags: [patch, p04, v08, stdio-parity]
created: 2026-11-02
---

# V08: bản vá P04 `stdio-parity`

## Phạm vi (trích PRD 9.4, P04)

- Vấn đề: `serve --stdio` chỉ có `search` và `status`; muốn đọc note, lấy vector hay index lại phải mở tiến trình mới. Khi stdin đóng, `cleanup` gọi `process.exit(0)` ngay, request đang chạy mất phản hồi.
- Yêu cầu: (1) action `read`, `vectors`, `neighbors` (dùng `exportNoteVectors`/`findNoteNeighbors` của P03), `reindex`, schema zod trong `contracts/boundary-validation.ts`; (2) stdin đóng thì ngừng nhận request mới, chờ request đang chạy (giới hạn 60 s) rồi mới đóng DB và thoát; (3) không đổi `search`.
- Bất biến: `search`, `status` giữ nguyên; `test/transport-parity.test.ts` mở rộng cho mọi action mới.

## Điều kiện xong (phase-02-core-patches.md)

Gửi N request `search` liền nhau rồi đóng stdin, nhận đủ N phản hồi đúng `id`; test parity mở rộng xanh; `npm test`, lint, knip, format xanh; probe trả 1 trên upstream v0.17.2 và 0 trên bản fork.

## Quyết định

1. Bản vá lõi (PRD 9.0): chạm vòng đời tiến trình và hợp đồng IPC.
2. `handleStdioLine` nhận thêm tham số `actions` (handler do `cli.ts` cấp) để `stdio-server.ts` chỉ kiểm tham số và định dạng; thiếu handler thì trả `<action> is not available on this server`.
3. Phản hồi: `read` -> `notes`, `vectors`/`neighbors` -> `meta` + `records` (đã gom thành mảng), `reindex` -> `result`. Lỗi index từng file nằm trong `result.errors`.
4. Chờ request: `cli.ts` giữ tập promise đang chạy, `drainInFlight` sau vòng đọc, xả stdout rồi `cleanup`. Tín hiệu SIGTERM/SIGINT vẫn thoát ngay.
5. Hai danh sách trong `test/serve-stdio.test.ts` dùng `reindex` làm ví dụ action lạ nên đổi thành `bogus`.
6. Một hàm `writeLine` dùng chung cho mọi dòng ra, chuẩn bị cho P07 (sự kiện không có `id`).

## Trạng thái

Xong. Patch `vantt/patches/0004-stdio-parity.patch`, spec, probe `vantt/probes/stdio-parity.mjs`.
