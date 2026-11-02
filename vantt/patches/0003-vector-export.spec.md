# Bản vá vector-export: feat(search): export note vectors and nearest notes as JSON Lines

- Consumer: dự án pkm (`note_knn.mjs`, `similar_pairs.mjs`, plugin Obsidian, máy chủ điện thoại); mọi người cần vector note mà không đọc SQLite
- Trạng thái upstream: unsubmitted
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Vector chỉ đọc được trong `storage/` (chỉ `storage/` được chạm `better-sqlite3`, `sqlite-vec`), và việc gộp theo note phải đi cùng schema của `chunks`/`vec_chunks`. Không phải hàm thuần trên chữ nên không đi đường pack. Cơ chế chung, không có logic sản phẩm.

## 1. Vấn đề

Upstream v0.17.2 không có lệnh xuất vector hay K note gần nhất (chỉ có `getChunkEmbeddingsByPath` nội bộ và `search --path` cho note tương tự, trả note chứ không trả vector). Dự án tính vector trung bình của note và láng giềng bằng cách đọc thẳng `vec_chunks`, `chunks`, `notes`; mỗi lần upstream đổi schema là vỡ.

Tái hiện: vault tạm đã index, chạy `ohs vectors --path a.md`. Upstream coi `vectors` là câu tìm, không có lệnh. Probe `vantt/probes/vector-export.mjs` làm đúng việc đó.

## 2. Yêu cầu

1. `ohs vectors [--path <note>]… [--pooling mean|max] [--normalize|--no-normalize]`. Một dòng JSON mỗi note: `{path, dim, model, chunks, vector:[…]}`. Mặc định `mean` rồi chuẩn hoá L2. `--path` lặp lại được; không có thì mọi note có vector (theo thứ tự path).
2. `ohs neighbors [--path <note>]… [--k 10] [--min-score x] [--exclude-linked] [--scope <prefix>]… [--pooling mean|max]`. Một dòng mỗi note nguồn: `{path, neighbors:[{path, score}]}`, điểm giảm dần. Không `--path` thì mọi note có vector là nguồn. Điểm là cosine trên vector note đã gộp, tính trong JS trên một ma trận phẳng (`Float32Array`), không gọi KNN của `sqlite-vec`.
   - `--k` nguyên >= 1. `--min-score` trong [-1, 1]: bỏ láng giềng có điểm thấp hơn.
   - `--exclude-linked`: bỏ note có liên kết tới hoặc từ note nguồn (bảng `links`, cả hai chiều).
   - `--scope`: cú pháp của bộ lọc `scope` khi tìm (tiền tố thư mục, `-` đầu để loại), dựng bằng `buildFilterPredicate`; giới hạn tập **ứng viên**, không giới hạn nguồn.
3. Cả hai lệnh in dòng đầu `{"meta": {"model", "dim", "pooling", "note_count", "ohs_version"}}`. `note_count` là số dòng note theo sau (số `--path` đã cho, hoặc số note có vector).
4. Note được yêu cầu mà không trả lời được: dòng `{path, error}` với `note not found in the index` hoặc `note has no stored embeddings`; lệnh thoát mã 1 sau khi in hết. Không bịa vector.
5. Lệch nguồn gốc: `embedding_model` không có trong `settings` khi đã có vector, hoặc độ dài vector khác `embedding_dim` (hay khác giữa các note): ném `VectorExportError`, CLI thoát lỗi, không in vector sai.
6. Hàm lõi cho transport khác: `exportNoteVectors(options)` và `findNoteNeighbors(options)` ở `src/search/note-vectors.ts`, trả `{meta, records}` (`records` là `Iterable`, sinh từng bản ghi). Transport chỉ định dạng. Action stdio `vectors`/`neighbors` thuộc P04 (V08) và dùng lại đúng hai hàm này; `ohsVersion` do transport truyền vào.
7. Lệnh không mở embedder, không cần mạng.

## 3. Bất biến

1. Chỉ đọc: không ghi bảng nào, không đổi `db_version`, không thêm bảng, không đổi `INDEX_SCHEMA_VERSION`. Không dùng thì không đổi hành vi nào của upstream (không có lệnh, tuỳ chọn hay đường tìm nào bị đổi).
2. Không trả vector sai: model không rõ hoặc `dim` lệch thì lỗi, không đoán.
3. Vector của note chỉ gồm các đoạn đã có embedding trong `vec_chunks`, theo thứ tự `chunk_index`. Note có đoạn nhưng không đoạn nào có embedding bị báo `error`, không có vector rỗng.
4. `mean`: trung bình từng chiều trên mọi đoạn, rồi (mặc định) chia cho chuẩn L2; `max`: lớn nhất từng chiều. Vector không (chuẩn 0) giữ nguyên là không.
5. Cosine của `neighbors` luôn tính trên vector đơn vị bất kể `--normalize`. Note nguồn không bao giờ nằm trong láng giềng của chính nó. Hoà điểm giữ thứ tự path.
6. `storage/` không import `search/`. `search/note-vectors.ts` không chạm SQLite; `transports/` không tính toán.
7. Đường dẫn chuẩn hoá NFD như mọi nơi khác (`normalizeNotePath`).

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/storage/note-vectors.ts` (mới) | `iterateNoteChunkVectors`, `getStoredVectorSource`, `countNotesWithVectors`, `findExistingNotePaths`, `listNotePathsMatching` | đọc `vec_chunks`/`chunks`/`notes` theo từng note, ở đúng lớp được chạm SQLite; nhóm theo note bằng `ORDER BY n.path, c.chunk_index` |
| `src/search/note-vectors.ts` (mới) | `exportNoteVectors`, `findNoteNeighbors`, `poolVectors` | gộp, cosine, lọc; dùng `getOutgoingLinksForPaths`, `getBacklinksForPaths` của `storage/db.ts` |
| `src/transports/cli.ts` | lệnh `vectors`, `neighbors`, import | chỉ phân tích tuỳ chọn và in JSON Lines |
| `test/vantt/vector-export.test.ts` (mới) | | test đơn vị và tích hợp |

Không sửa `storage/db.ts`, `searcher.ts`, không đổi schema. Điểm chạm duy nhất của file upstream có sẵn là `src/transports/cli.ts` (thêm một import, thêm khối lệnh trước `serve`).

## 5. Kiểm thử

- Test: `test/vantt/vector-export.test.ts`. Vault tạm 6 note, embedder giả 4 chiều đếm từ khoá (vector tính tay được), một note nhiều đoạn. Kiểm: mean và max so với vector đoạn đọc trực tiếp từ DB, chuẩn hoá bật và tắt, thứ tự và điểm láng giềng tính tay (`3/sqrt(10)`, `2/sqrt(5)`), `--min-score`, `--exclude-linked` cả hai chiều, `--scope`, note không có, `dim` và model lệch báo lỗi, chỉ đọc (`db_version` không đổi), vector không.
- `test_command`: `npx vitest run test/vantt/vector-export.test.ts`.
- Probe: `vantt/probes/vector-export.mjs --ohs <dir>`. Dựng vault tạm, embedder giả kiểu OpenAI, index bằng CLI, gọi `vectors --help` (không thấy lệnh: 1), rồi `vectors` và `neighbors`, kiểm trường. Trên upstream v0.17.2 trả 1; trên bản fork trả 0.
- `capability_check`: `node vantt/probes/vector-export.mjs --ohs .`
- Hiệu năng: vòng cosine đo riêng, 10.000 note x 384 chiều khoảng 30 giây (một luồng, không tính nạp). Với 1536 chiều ước 2 phút; nếu chậm hơn mục tiêu thì chuyển sang KNN của `sqlite-vec` theo đoạn rồi gộp (PRD 9.4).

## 6. Khi xung đột hoặc khi upstream đổi

- Tìm lại điểm chạm: `git grep -n "vec_chunks" src/storage`; `git grep -n "getOutgoingLinksForPaths" src`; khối lệnh `vectors`/`neighbors` đứng ngay trước `const serveCommand` trong `src/transports/cli.ts`. Hai file mới không xung đột; nếu upstream đổi tên bảng `vec_chunks`/`chunks` hay cột, sửa SQL trong `src/storage/note-vectors.ts` (một chỗ, hàm `iterateRows`).
- Điều kiện bỏ bản vá: upstream có lệnh hoặc action chính thức xuất vector theo note (hoặc K note gần nhất) với dòng JSON đủ `path`, `vector`, `model`, `dim`, và trả lỗi khi model hay dim lệch. Probe sẽ thấy `vectors --help` có lệnh nhưng định dạng khác: khi đó đọc đầu ra, nếu thoả bất biến 2 và 3 thì đặt `upstream_status = "merged"` và sửa phía dự án theo định dạng upstream.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

**Title:** Add `ohs vectors` and `ohs neighbors` for note-level embeddings

**Body:** Tools built on OHS (graph builders, duplicate finders, mobile clients) need one vector per note and the K nearest notes. Today they open the SQLite file and join `vec_chunks`, `chunks` and `notes`, which breaks when the schema changes. This adds two read-only commands that print JSON Lines: `ohs vectors [--path …] [--pooling mean|max] [--no-normalize]` and `ohs neighbors [--path …] [--k] [--min-score] [--exclude-linked] [--scope]`. The first line is a `meta` object (model, dim, pooling, note count, version). Vectors are pooled from stored chunk embeddings; cosine runs in JS over a flat buffer; a missing model or a dimension mismatch is reported instead of returning wrong vectors. No schema change, no new table, the embedder is not loaded. Core functions live in `src/search/note-vectors.ts` so MCP or stdio can reuse them.
