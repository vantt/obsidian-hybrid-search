# Bản vá unicode-inline-tags: tag nội dòng nhận mọi chữ Unicode
- Consumer: người dùng tiếng Việt và mọi ngôn ngữ không dùng chữ Latin cơ bản (Hy Lạp, Cyrillic, CJK)   - Trạng thái upstream: unsubmitted   - Pha: now
- Đường: **bản vá lõi** (PRD 9.0). Lý do: tag được tách lúc index (`extractNoteTags`), không nằm trong điểm cắm tìm kiếm của P01; đây là một regex nhỏ, không có logic sản phẩm.

## 1. Vấn đề (người dùng thấy gì, cách tái hiện trên bản upstream)
Regex tag nội dòng (`src/content/note-extractor.ts`, `parseInlineTags`) dùng khoảng `À-ɏ` (U+00C0–U+024F) cho chữ không phải ASCII. Chữ Việt có dấu thanh và dấu mũ nằm ở U+1EA0–U+1EF9, ngoài khoảng đó.

Tái hiện trên upstream v0.17.2: note có dòng `Lịch trình cho #kếhoạch năm nay.`, chạy `reindex`, rồi `ohs search "lịch trình" --mode fulltext --tag kếhoạch` không trả note đó (tag đã lưu là `k`, hoặc không có tag).

## 2. Yêu cầu
1. Ký tự đầu của tag là chữ Unicode (`\p{L}`) hoặc `_`.
2. Các ký tự sau đầu là chữ (`\p{L}`), số (`\p{N}`), dấu kết hợp (`\p{M}`, để tag ở dạng NFD vẫn đủ), `_`, `-`, `/`.
3. Cờ `u` cho regex.

## 3. Bất biến (phải còn đúng sau mọi lần viết lại; đánh số)
1. Tag ASCII cho cùng kết quả như upstream (`#pkm`, `#note/basic/primary`, `#real-tag`, `#a_b`, `#_x`).
2. Tag bắt đầu bằng số không được nhận (`#123`, `#42foo`), như upstream (`test/indexer-edge-cases.test.ts`).
3. Tag trong khối mã và code inline bị bỏ qua, như upstream.
4. Không đổi schema, không tăng `INDEX_SCHEMA_VERSION` (xem mục 6). Một note không đổi nội dung thì tag của nó không đổi cho đến khi `reindex --force`.
5. Thay đổi có chủ đích, ghi nhận: `×` (U+00D7) và `÷` (U+00F7) không còn là ký tự của tag (chúng là ký hiệu toán học, không phải chữ). Upstream từng nhận chúng vì khoảng `À-ɏ` bao cả hai.

## 4. Điểm chạm (file, hàm, vì sao chạm)
- `src/content/note-extractor.ts`, hàm `parseInlineTags`: chỉ đổi regex và chú thích hàm. Đây là nguồn tag duy nhất cho `indexer.ts` (`extractNoteTags`).
- `test/vantt/unicode-inline-tags.test.ts` (mới): tag Unicode, quy tắc giữ nguyên, NFD, khối mã.
- Không chạm: `db.ts`, `search*`, MCP, CLI.

## 5. Kiểm thử (test đơn vị, test tích hợp, probe, capability_check)
- Đơn vị: `npx vitest run test/vantt/unicode-inline-tags.test.ts` (13 test), cùng `test/indexer.test.ts` và `test/indexer-edge-cases.test.ts` (tag ASCII và tag số).
- Toàn bộ: `npm run build`, `npx vitest run` (114 file, 2024 test xanh), `tsc --noEmit`, `eslint --max-warnings 0`, `prettier --check` trên file đã đổi.
- Probe `vantt/probes/unicode-inline-tags.mjs --ohs <bản đã build>`: trả 1 trên v0.17.2 nguyên gốc (đã kiểm), 0 trên bản fork (đã kiểm).
- capability_check: `node vantt/probes/unicode-inline-tags.mjs --ohs .`

## 6. Khi xung đột hoặc khi upstream đổi
- Cách tìm lại điểm chạm: `grep -n "matchAll" src/content/note-extractor.ts` trong hàm `parseInlineTags`. Nếu upstream đổi cách tách tag, giữ bất biến 1–3 và thay regex bằng quy tắc trên.
- Vì sao không tăng `INDEX_SCHEMA_VERSION`: không có thay đổi schema; tăng hằng số chỉ kích hoạt `runMigrations` (`db.ts:553-585`), và không tạo lại tag. Tag của note đã index chỉ đổi khi note đổi (mtime, kích thước, md5) hoặc khi chạy `ohs reindex --force`. Người đã dùng OHS cần chạy `reindex --force` một lần sau khi nâng cấp để tag Việt của note cũ xuất hiện trong `--tag`. Đây là chỗ cần quyết định ở catchup (xem mục 8).
- Điều kiện bỏ bản vá: upstream có tag Unicode đầy đủ theo quy tắc trên (bất biến 1–3 còn đúng).

## 7. Nội dung issue hoặc PR gửi upstream (nháp)
Tiêu đề: `Inline tags drop Vietnamese and other non-Latin letters`

Nội dung: `parseInlineTags` dùng khoảng `À-ɏ` để nhận chữ không phải ASCII. Chữ Việt dùng U+1EA0–U+1EF9 nên `#kếhoạch` bị cắt ở `ế`. Đề xuất dùng `/(?:^|[\s,;(])#([\p{L}_][\p{L}\p{N}\p{M}_\-/]*)/gmu`. Kèm test đơn vị và một kịch bản tái hiện bằng CLI (`reindex`, `search --tag`). Quy tắc cũ cho ký tự đầu (không phải số) được giữ.

## 8. Ghi chú cho lead
- Đề xuất `series.toml`:
```toml
[[patches]]
id = "unicode-inline-tags"
name = "fix(content): accept Unicode letters in inline tags"
patch_file = "0009-unicode-inline-tags.patch"
metadata_file = "0009-unicode-inline-tags.spec.md"
consumer = "người dùng tiếng Việt và mọi ngôn ngữ ngoài Latin cơ bản"
upstream_status = "unsubmitted"
upstream_ref = ""
touches = ["src/content/note-extractor.ts"]
test_command = "npx vitest run test/vantt/unicode-inline-tags.test.ts test/indexer.test.ts test/indexer-edge-cases.test.ts"
capability_check = "node vantt/probes/unicode-inline-tags.mjs --ohs ."
probe = "vantt/probes/unicode-inline-tags.mjs"
phase = "now"
```
- Quyết định cần lead: có chạy `reindex --force` tự động sau catchup hay không. Không tự động thì ghi vào hướng dẫn nâng cấp.
- Bản vá giữ hành vi chữ số đầu theo test hiện có, dù Obsidian cho phép tag bắt đầu bằng số. Nếu muốn đổi, phải sửa test `#42foo` và đổi bất biến 2.
