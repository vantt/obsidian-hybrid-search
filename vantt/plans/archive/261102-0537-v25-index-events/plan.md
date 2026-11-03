---
title: 'v25-index-events'
description: 'Bản vá P07 index-events: serve --stdio phát sự kiện indexed và removed sau mỗi lô ghi'
status: completed
priority: P1
effort: '0.5d'
tags: [patch, p07, v25, index-events]
created: 2026-11-02
---

# V25: bản vá P07 `index-events`

## Phạm vi (trích PRD 9.4, P07)

stdio IPC phát `{"event":"indexed","paths":[…],"db_version":n}` sau mỗi lô ghi, và `{"event":"removed",…}`. Dự án dùng để cập nhật graph theo sự kiện thay vì đọc lại vault mỗi 5 s.

## Điều kiện xong (V25)

Test và probe xanh; dự án nhận sự kiện sau khi sửa note; không có người nghe thì hành vi y hệt upstream; probe trả 1 trên upstream, 0 trên bản fork.

## Quyết định

1. Bản vá lõi (PRD 9.0): chạm điểm commit và xoá note của indexer.
2. Opt-in bằng `OHS_STDIO_EVENTS=1` (PRD không nêu; chọn biến môi trường để không thêm action hay cờ CLI).
3. Bus nhỏ trong `indexer.ts` (`onIndexEvent`), gộp 25 ms, một sự kiện mỗi loại; `cli.ts` nối vào `writeLine` của P04.
4. Phát từ `indexFile` (indexed, missing), `cleanupStaleNotes`, watcher unlink. Không phát cho ghi của tiến trình khác.
5. Tiêu chí 1 s giữ nguyên: thêm `OBSIDIAN_WATCH_DEBOUNCE_MS` (mặc định 5000); test và probe đặt 250 ms.
6. Rebase lên `vantt/work/series-p01b` (sau P06), gates đầy đủ xanh (2091 test).

## Trạng thái

Xong. Patch `vantt/patches/0007-index-events.patch`, spec, probe `vantt/probes/index-events.mjs`.
