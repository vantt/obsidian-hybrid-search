---
title: "V23 P05 block-anchors"
description: "Bản vá lõi P05: block_id và has_highlight cho mỗi đoạn, OBSIDIAN_CHUNK_TOKENS."
status: completed
priority: P1
effort: "2d"
tags: [feature, backend]
created: 2026-11-02
---

# V23 P05 `block-anchors`

## Yêu cầu (PRD 9.4, P05; mục tiêu G11)

> Lưu `block_id` (chuỗi `^abc` cuối đoạn) và `has_highlight` (đoạn chứa `==…==` hoặc `<mark>`) cho mỗi đoạn; trả trong kết quả (`anchors`). Thêm `OBSIDIAN_CHUNK_TOKENS` (kích thước đoạn tối đa, `min(giới hạn model, giá trị)`), lưu kích thước hiệu lực vào `settings` và dựng lại khi đổi. Theo dõi upstream issue #91; nếu upstream làm thì bỏ phần đó khỏi bản vá.

## Điều kiện xong (phase-02-core-patches)

- Test và probe xanh; probe trả 1 trên upstream v0.17.2, 0 trên bản vá.
- Không đặt `OBSIDIAN_CHUNK_TOKENS` thì cách chia đoạn và kết quả tìm y như upstream.
- Tăng `INDEX_SCHEMA_VERSION`.

## Kết quả

- Issue #91 còn mở (kiểm 2026-11-02, 0 bình luận, không có PR): giữ phần kích thước đoạn.
- `vantt/patches/0005-block-anchors.patch`, `0005-block-anchors.spec.md`, `vantt/probes/block-anchors.mjs`.
- Test `test/vantt/block-anchors.test.ts` nằm trong bản vá; toàn bộ `npm test` (114 file), lint, knip, format:check, tsc xanh.
- Mục `series.toml` do lead ghép.
