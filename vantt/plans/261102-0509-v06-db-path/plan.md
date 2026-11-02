---
title: "v06-db-path"
description: "Bản vá P02 db-path: DB index đặt được ngoài vault, mọi transport và daemon dùng chung"
status: completed
priority: P1
effort: "1d"
tags: [patch, p02, v06, db-path]
created: 2026-11-02
---

# V06: bản vá P02 `db-path`

## Phạm vi (trích PRD)

- PRD 3.2: DB luôn ở `<vault>/.obsidian-hybrid-search.db`; `--db` chỉ dò vault; daemon nhận `OBSIDIAN_VAULT_PATH`; bẫy migration (không đổi schema thì không tăng `INDEX_SCHEMA_VERSION`).
- PRD 9.4, P02: biến `OBSIDIAN_DB_PATH`; `--db` dùng làm DB thật khi khớp vault; daemon nhận cùng biến; `status` in `db_path`; tạo thư mục cha. Bất biến: không đặt gì thì y hệt upstream; DB không dùng cho vault khác; mọi transport cùng một DB.
- Phase file `phase-02-core-patches.md`, việc V06.

## Điều kiện xong

- `catchup` áp được; `test_command` xanh; `npm test`, lint, knip, format:check của upstream xanh.
- Probe trả 1 trên upstream v0.17.2, 0 trên bản đã vá.

## Quyết định

1. **Đường đi: bản vá lõi** (PRD 9.0).
2. **`--db` chỉ nhận DB đã có và khớp vault** (lệch PRD yêu cầu 2): test của upstream ép vault tường minh giữ DB chuẩn khi `--db` trỏ file không có, hỏng hay của vault khác. Muốn tạo DB ở chỗ khác thì dùng `OBSIDIAN_DB_PATH`. Lead đã đồng ý.
3. **Daemon**: không đổi `mcp-supervisor.ts`; nó truyền `...process.env`, nên `OBSIDIAN_DB_PATH` (đặt sẵn hoặc do `discoverConfig` xuất ra từ `--db`) đến tận daemon. File state, log, lock của daemon nằm ở `~/.cache`, không cạnh DB.
4. **Từ chối DB của vault khác** đặt ở `openDb` (một chỗ cho mọi transport), chỉ khi có `OBSIDIAN_DB_PATH`, để DB mặc định giữ hành vi upstream (vault dời chỗ vẫn chạy).

## Kết quả

- Mã, test, README nằm trong `vantt/patches/0002-db-path.patch`; spec `0002-db-path.spec.md`; probe `vantt/probes/db-path.mjs`.
- Test: 114 file, 2021 test xanh; lint, knip, format:check xanh. Probe: 1 trên upstream, 0 trên fork.
- `series.toml`: lead ghép mục đề xuất trong báo cáo.

## Todo

- [x] Sửa mã, test, README
- [x] Xuất patch, viết spec, probe
- [x] Chạy cổng chất lượng và probe cả hai bản
