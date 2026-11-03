# Bản vá block-anchors: feat(index): store block ids and highlight flags per chunk, make chunk size configurable

- Consumer: trang nguyên liệu của dự án (trỏ `note#^block`, ưu tiên đoạn user đã tô); người dùng OHS có model 8192 token muốn đoạn nhỏ hơn
- Trạng thái upstream: unsubmitted (phần kích thước đoạn trùng upstream issue #91, còn mở, chưa có PR, kiểm 2026-11-02)
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Đổi schema (hai cột của bảng `chunks`), đổi cách chia đoạn (kích thước cấu hình được) và chạm vòng đời index (đổi cấu hình thì dựng lại). Pack không làm được. Chỉ chứa cơ chế chung; việc dùng block id để dựng liên kết là của dự án.

## 1. Vấn đề

- Kết quả tìm không chỉ được tới đúng khối của note. Id khối Obsidian (`đoạn văn ^abc`) và chữ tô (`==chữ==`) không được lưu ở đâu, nên client không dựng được `note#^abc` và không biết đoạn nào user đã tô.
- Từ 0.17.0 mọi note dưới khoảng 8k token thành một đoạn duy nhất với model 8192 token (upstream issue #91). Anchor ngữ nghĩa phủ cả note, reranker chỉ thấy đầu note, `headingPath` mất. Không có cách đặt kích thước đoạn nhỏ hơn giới hạn của model, và đổi cỡ đoạn cũng không dựng lại index.

Tái hiện trên upstream v0.17.2: note có đoạn cuối `... ==the compost heap== needs turning. ^probe-block`, `ohs reindex`, rồi `ohs search "steady watering" --mode fulltext --anchors --json`. Anchor không có thông tin khối. Probe `vantt/probes/block-anchors.mjs` làm đúng việc này.

## 2. Yêu cầu

1. Bảng `chunks` thêm `block_id TEXT` và `has_highlight INTEGER NOT NULL DEFAULT 0`.
2. `block_id` là id khối ở cuối đoạn, **kể cả dấu mũ** (ví dụ `^abc-1`, theo PRD để client nối `#`). Nhận `văn bản ^id` ở cuối dòng cuối, hoặc một dòng chỉ có `^id` (danh sách, trích dẫn, bảng). Id gồm `[A-Za-z0-9-]`. Đoạn có nhiều id thì lấy id cuối. Đoạn kết thúc trong khối mã rào (code fence) không có id.
3. `has_highlight` bật khi đoạn có `==chữ==` (không có khoảng trắng sát dấu `==`) hoặc thẻ `<mark>`, không tính trong khối mã rào hay mã dòng.
4. `previewAnchors` (CLI `--anchors`, MCP và stdio `anchors`) thêm `blockId` và `hasHighlight` cho anchor `bm25` và `semantic`. Trường chỉ có mặt khi có giá trị (`blockId` khi đoạn có id, `hasHighlight: true` khi đoạn có chữ tô), nên kết quả của note không có hai thứ này không đổi từng byte.
5. `OBSIDIAN_CHUNK_TOKENS` (số nguyên dương): kích thước đoạn là `min(giới hạn model, giá trị)`. Chưa đặt hoặc không hợp lệ thì dùng giới hạn model như upstream. Giới hạn model vẫn là trần cứng của `getDocumentTokenPolicy()`.
6. Cỡ đoạn là một phần định danh index: đã đặt thì `settings.content_policy` có hậu tố `+chunk=<n>`; đổi hoặc bỏ giá trị thì `reindex` dựng lại index bằng đường `content-policy` có sẵn. Chưa đặt thì chuỗi giữ nguyên chữ của upstream (`none` hoặc chữ ký mẫu lọc nội dung).
7. Tăng `INDEX_SCHEMA_VERSION` từ `2` lên `3`. Migration thêm cột rồi suy `block_id`, `has_highlight` cho các đoạn đã có từ `chunks.text` (không gọi embedder, không chia lại đoạn).

Đã chọn lưu cỡ đoạn trong `content_policy` thay cho khoá `settings` riêng: tái dùng đúng cơ chế "đổi cấu hình thì dựng lại" của upstream, không thêm đường dựng lại mới. PRD nói "kích thước hiệu lực"; ở đây lưu giá trị cấu hình, và giới hạn model đổi thì đã buộc `reindex --force` (đổi model).

## 3. Bất biến

1. Không đặt `OBSIDIAN_CHUNK_TOKENS`: `chunkNote` nhận đúng giới hạn model như upstream; `content_policy` giữ chữ của upstream; kết quả JSON của 17 câu tìm trong `language-pack-baseline.snapshot.json` trùng từng byte (test `language-pack-baseline.test.ts` vẫn xanh, không sửa snapshot).
2. Cờ anchor chỉ thêm trường, không đổi hay bỏ trường có sẵn. Thứ tự RRF, điểm và snippet không phụ thuộc `block_id`, `has_highlight`.
3. `extractChunkAnchors` là hàm thuần trên `chunks.text`; index mới và migration dùng chung nó nên cho cùng kết quả.
4. Đặt `OBSIDIAN_CHUNK_TOKENS` lớn hơn giới hạn model không làm đoạn vượt giới hạn model.
5. Đổi hay bỏ `OBSIDIAN_CHUNK_TOKENS` luôn dẫn tới dựng lại index ở lần `reindex` hay khởi động service kế tiếp (tiến trình chỉ tìm kiếm thì báo "Content policy changed in another process", như đổi mẫu lọc).
6. `storage/` chỉ import hàm thuần `content/block-anchors.ts` (đã có tiền lệ `content/content-ignore.ts`); ranh giới kiến trúc không đổi.

Giới hạn đã biết: một đoạn chỉ có một `block_id` (id cuối). Note ngắn, vừa một đoạn, chỉ lộ id khối cuối cùng; muốn có id ở từng khối thì đặt `OBSIDIAN_CHUNK_TOKENS` nhỏ.

## 4. Điểm chạm

| File                                     | Hàm hoặc chỗ                                                                                                          | Vì sao                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/content/block-anchors.ts` (mới)     | `extractChunkAnchors`                                                                                                 | nhận id khối và chữ tô          |
| `src/content/chunker.ts`                 | `effectiveChunkTokens` (mới)                                                                                          | `min(giới hạn model, cấu hình)` |
| `src/runtime/config.ts`                  | `chunkTokens`                                                                                                         | đọc `OBSIDIAN_CHUNK_TOKENS`     |
| `src/indexing/indexer.ts`                | `prepareIndexFile`: `chunkNote(content, effectiveChunkTokens(contextLength))` và `...extractChunkAnchors(chunk.text)` | áp cỡ đoạn, đính cờ vào đoạn    |
| `src/indexing/index-service.ts`          | `desired` (chữ ký chính sách nội dung)                                                                                | cỡ đoạn thành định danh index   |
| `src/storage/db.ts`                      | `INDEX_SCHEMA_VERSION`, `runMigrations` (+ `backfillChunkAnchors`), `PreparedIndexNote.chunks`, `insertChunks`        | cột mới, migration, ghi cột     |
| `src/storage/search-queries.ts`          | `readChunksForPaths`, truy vấn vector                                                                                 | đọc hai cột                     |
| `src/search/searcher.ts`                 | `MatchAnchor`, `anchorFlags`, `Bm25ChunkData`, `matchChunkDataFromRows`, anchor `bm25` và `semantic`                  | đưa vào `previewAnchors`        |
| `test/vantt/block-anchors.test.ts` (mới) |                                                                                                                       | xem mục 5                       |

## 5. Kiểm thử

- `test/vantt/block-anchors.test.ts`:
  - `extractChunkAnchors`: id cuối đoạn, dòng chỉ có `^id`, `2^10` và `^id` giữa dòng không tính, khối mã rào, `==chữ==`, `<mark>`, `a == b == c`, mã dòng.
  - `effectiveChunkTokens`: chưa đặt, không hợp lệ, `0`, nhỏ hơn và lớn hơn giới hạn model.
  - Tích hợp (embedder giả): không đặt biến thì note là một đoạn, `content_policy` là `none`, anchor không có `blockId`; đặt `40` thì tách ba đoạn theo mục, mỗi đoạn đúng `block_id`/`has_highlight`; anchor `bm25` có `blockId` hoặc `hasHighlight` đúng chỗ; đổi sang `60` rồi bỏ biến thì dựng lại và về một đoạn; migration từ schema 2 (bỏ hai cột, đặt version `2`) suy lại cờ và nâng version lên `3`.
- `test/vantt/language-pack-baseline.test.ts` (của P01) chứng minh bất biến 1.
- Probe: `node vantt/probes/block-anchors.mjs --ohs <bản đã build>`. Trả 1 trên upstream v0.17.2, 0 trên bản đã vá (đã chạy cả hai).
- Cả `npm test` (114 file, 2022 test), lint, knip, format:check, tsc xanh trong worktree.
- `test_command`: `npx vitest run test/vantt/block-anchors.test.ts test/vantt/language-pack-baseline.test.ts`.
- `capability_check`: probe ở trên.

## 6. Khi xung đột hoặc khi upstream đổi

Cách tìm lại điểm chạm:

- `prepareIndexFile`: tìm `chunkNote(content,` (bọc `effectiveChunkTokens`) và khối `chunks: embeddedChunks.map(` (thêm `...extractChunkAnchors(chunk.text)`).
- `createIndexService`: tìm `policySignature(patterns)`; hậu tố `+chunk=` nối sau chữ ký.
- `runMigrations`: khối `block_id` đứng sau khối `source_spans`. `INDEX_SCHEMA_VERSION`: upstream hay bản vá khác tăng hằng số này thì lấy số lớn hơn, cộng 1 nếu cần.
- `insertChunks` và `PreparedIndexNote.chunks`: hai cột cuối của câu `INSERT INTO chunks`.
- `readChunksForPaths` và truy vấn vector có `c.char_start, c.char_end`: thêm `c.block_id, c.has_highlight` cạnh đó. `matchChunkDataFromRows` và hai chỗ dựng anchor (`kind: 'bm25'`, `kind: 'semantic'`) gọi `anchorFlags`.

Điều kiện bỏ bản vá: phần cỡ đoạn bỏ khi upstream (issue #91) có biến môi trường đặt cỡ đoạn và dựng lại khi đổi; phần block id bỏ khi upstream lưu id khối và cờ tô cho mỗi đoạn và trả trong anchor. Probe trả 0 trên upstream cho phần block id. Nếu upstream chỉ làm phần cỡ đoạn, sửa bản vá bỏ `effectiveChunkTokens`, `chunkTokens` và hậu tố `+chunk=`, giữ phần còn lại.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

> **Title:** Per-chunk block ids and highlight flags, and a configurable chunk size (#91)
>
> Search anchors cannot point at an Obsidian block (`^block-id`) or tell that a passage was highlighted (`==text==`). This adds `block_id` and `has_highlight` columns to `chunks`, filled at index time (and backfilled by the schema migration from stored chunk text) and exposed as `blockId` and `hasHighlight` on `--anchors` results, only when present.
>
> It also adds `OBSIDIAN_CHUNK_TOKENS` as requested in #91: the chunk size is `min(model limit, setting)`, and the setting is part of the index identity, so changing it rebuilds the index through the existing content-policy path.
>
> Without the variable nothing changes: the same chunking, the same policy string and byte-identical search results on the existing baseline.
