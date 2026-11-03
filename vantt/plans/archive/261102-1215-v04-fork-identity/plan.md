---
title: 'V04: bản vá P00 fork-identity'
status: completed
created: 2026-11-02
---

# V04: bản vá P00 `fork-identity`

Plan con này do lead ghi lại sau khi agent con làm xong (agent bỏ qua bước tạo plan).

## Yêu cầu (PRD 4.3, 9.4 P00)

`ohs --version` in `<tag>-vantt.<N>`; catchup đặt số lúc build bằng cách ghi `version` và `"vanttFork": true` vào `package.json`, `package-lock.json`, `server.json` của nhánh phát hành.

## Đã làm

- `src/runtime/package-identity.ts` đọc `package.json` gần nhất, cho biết bản fork (`vanttFork`) và `updateCheckDisabled()` (`OHS_DISABLE_UPDATE_CHECK=1`).
- CLI, MCP dùng chung bộ đọc; kiểm cập nhật trả trạng thái `disabled` khi tắt; `status` thêm `build: "vantt"` khi có dấu fork.
- Dựng trên tag `v0.17.2` (không trên P01) để P00 đứng đầu chuỗi.

## Xong khi

- [x] `git apply --check` trên `v0.17.2` sạch; P00 → P01 → P09 áp sạch theo thứ tự.
- [x] `npm test` upstream xanh (111 file, 1977 test); build, lint, knip, format:check xanh; `test/vantt/fork-identity.test.ts` 5 test xanh.
- [x] Probe `vantt/probes/fork-identity.mjs` trả 1 trên bản upstream, 0 trên bản có dấu `0.17.2-vantt.1`.

File: `vantt/patches/0000-fork-identity.{patch,spec.md}`, `vantt/probes/fork-identity.mjs`.
