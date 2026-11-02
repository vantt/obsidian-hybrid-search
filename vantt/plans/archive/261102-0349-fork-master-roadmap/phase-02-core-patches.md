---
phase: 2
title: "Phase 2: Bản vá lõi phục vụ dự án"
status: done
priority: P1
effort: "7.5d"
dependencies: [1]
---

# Phase 2: Bản vá lõi phục vụ dự án

## Overview

Tám bản vá nhỏ, mỗi bản một việc, cho thứ dự án cần mà upstream chưa có. Phục vụ G6, G7, G11. Mọi bản vá cần V01 để áp và kiểm qua catchup. Mỗi bản vá giao đủ: file `.patch`, spec theo mẫu PRD 9.3, mục trong `series.toml`, test trong `test/vantt/`, probe ở `vantt/probes/` chạy được trên upstream nguyên gốc.

## Việc

| ID | Bản vá | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|---|
| V04 | P00 `fork-identity` | `ohs --version` in `<tag>-vantt.<N>`; catchup đặt số lúc build | V01 | rẻ | 0,3 | 4.3, 9.4 |
| V05 | P09 `unicode-inline-tags` | Regex tag nội dòng (`src/content/note-extractor.ts`) nhận mọi chữ Unicode, gồm chữ Việt U+1EA0–1EF9 | V01 | rẻ | 0,3 | 3.3, 9.4 |
| V06 | P02 `db-path` | DB index đặt được ngoài vault; daemon, MCP, CLI, stdio cùng dùng | V01 | vừa | 1 | 3.2, 9.4 |
| V07 | P03 `vector-export` | Lệnh xuất vector theo note và K note gần nhất, JSON Lines, có tương đương qua stdio | V01 | vừa | 1 | 9.4 |
| V08 | P04 `stdio-parity` | Thêm action `read`, `vectors`, `neighbors`, `reindex`; chờ request đang chạy trả lời rồi mới thoát khi stdin đóng. `search` của upstream đã đủ tuỳ chọn, không đổi | V07 | vừa | 1 | 9.4 (P04) |
| V23 | P05 `block-anchors` | `block_id`, `has_highlight` cho mỗi đoạn; `OBSIDIAN_CHUNK_TOKENS`. Theo dõi upstream issue #91, upstream làm phần kích thước đoạn thì bỏ phần đó | V01 | vừa | 2 | 9.4 (P05) |
| V24 | P06 `restrict-paths` | `paths[]` / `--paths-file` thêm vào `buildFilterPredicate`, đẩy xuống SQL ở mọi nhánh, không lọc sau top-K | V01 | vừa | 0,5–1 | 9.0, 9.4 (P06) |
| V25 | P07 `index-events` | stdio phát `indexed` và `removed` sau mỗi lô ghi | V08 | vừa | 1 | 9.4 (P07) |

Song song: V04, V05, V06, V07, V23, V24 chạy cùng lúc sau V01. V08 sau V07. V25 sau V08.

## Quy tắc riêng

- Bản vá chỉ chứa cơ chế chung, có ích cho mọi người dùng OHS; không chứa logic sản phẩm (PRD 9.0).
- Đổi schema thì tăng `INDEX_SCHEMA_VERSION` (bẫy migration, PRD 3.2).
- Không cấu hình tính năng mới thì hành vi và kết quả tìm y như upstream (bất biến G2).
- Bản vá đứng sau trong `series.toml` dựng trên các bản đứng trước. P03, P04, P05, P06 có thể chạm `src/search/searcher.ts`, `src/storage/db.ts`: lead ghép theo thứ tự series và yêu cầu dựng lại khi xung đột.
- `series.toml` do lead ghép; agent con gửi mục của mình trong báo cáo.

## File sở hữu

- Mỗi việc: `vantt/patches/NNNN-<id>.patch`, `vantt/patches/NNNN-<id>.spec.md`, `vantt/probes/<id>.mjs`. Mã OHS và `test/vantt/<id>.test.ts` chỉ nằm trong file `.patch`.

## Todo

- [x] V04 P00 `fork-identity`
- [x] V05 P09 `unicode-inline-tags`
- [x] V06 P02 `db-path`
- [x] V07 P03 `vector-export`
- [x] V08 P04 `stdio-parity`
- [x] V23 P05 `block-anchors`
- [x] V24 P06 `restrict-paths`
- [x] V25 P07 `index-events`

## Success Criteria

- Mỗi bản vá: catchup áp sạch trên `v0.17.2`; `test_command` xanh; `npm test` của upstream xanh; probe trả 1 trên upstream nguyên gốc và 0 trên bản fork.
- V08: gửi N request `search` liền nhau rồi đóng stdin, nhận đủ N phản hồi đúng `id`; test parity mở rộng xanh.
- V23: không đặt `OBSIDIAN_CHUNK_TOKENS` thì cách chia đoạn và kết quả tìm y như upstream.
- V24: tìm trong tập 30 note trả đủ kết quả như tìm trên vault chỉ có 30 note đó.
- V25: client nhận sự kiện trong 1 giây sau khi sửa note.

## Ghi chú ghép

- `series.toml` giữ thứ tự P00, P01, P02, P03, P04, P09, P05, P06, P07: bản vá về sau chèn đúng vị trí, không chỉ nối cuối.
- P09 (V05) xong: không tăng `INDEX_SCHEMA_VERSION`; note đã index trước bản vá giữ tag cũ tới khi note đổi hoặc chạy `ohs reindex --force` (ghi ở spec).
- P00 (V04) xong: dựng trên tag `v0.17.2` để đứng đầu chuỗi; đã kiểm P00 → P01 → P09 áp sạch bằng `git am --3way`. Bản vá thêm `OHS_DISABLE_UPDATE_CHECK=1` (bộ cài dự án sẽ đặt biến này) và `build: "vantt"` trong `status` khi có dấu fork.
- P02 (V06), P03 (V07) xong. Nhánh ghép `vantt/work/series` (worktree `/home/vantt/projects/ohs-wt/chk-series`) = P00, P01, P02, P03, P09: 117 file, 2049 test xanh, lint xanh. P03 xung đột import với P00 trong `cli.ts`, lead sửa và xuất lại P02, P03 từ nhánh ghép.
- P02 lệch PRD: `--db` chỉ được nhận khi DB đã có và `vault_path` khớp (test upstream `vault-config` buộc vậy); đặt DB ở chỗ mới dùng `OBSIDIAN_DB_PATH`. Ghi trong spec.
- P03: `ohs vectors`, `ohs neighbors`; hành động stdio làm ở P04 (V08). Chưa đo đầu-cuối trên vault 10.000 note.
- P04 (V08), P05 (V23), P06 (V24) xong. Chuỗi P00, P01, P02, P03, P04, P09, P05, P06 trên `vantt/work/series`: 120 file, 2083 test xanh; build, lint, knip, tsc, format:check xanh. Các bản vá được xuất lại từ nhánh ghép.
- P05 tăng `INDEX_SCHEMA_VERSION` 2 → 3; migration điền cột mới từ chữ đã lưu, không gọi embedder. P04 đổi ví dụ "action lạ" trong `test/serve-stdio.test.ts` từ `reindex` sang `bogus`.
- P07 (V25) xong, đứng cuối chuỗi, dựng trên `vantt/work/series-p01b`: 2091 test xanh. Bật bằng `OHS_STDIO_EVENTS=1`; `OBSIDIAN_WATCH_DEBOUNCE_MS` (mặc định 5000 như upstream, khuyên 250 cho client sự kiện) để sự kiện tới trong 1 giây. Chỉ phát cho lần ghi của chính tiến trình stdio.

## Risk

- Upstream sửa mạnh `searcher.ts`, `db.ts`: giữ điểm chạm ít, ghi rõ trong spec mục "Điểm chạm" và "Khi xung đột".
- Upstream tự làm tính năng tương đương: probe phát hiện; bản vá chuyển `upstream_status` và bị bỏ qua.
