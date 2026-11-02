# PRD: fork `vantt/obsidian-hybrid-search`

| | |
|---|---|
| Upstream | [flowing-abyss/obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) (OHS), MIT, một người duy trì, ra bản gần mỗi tuần (0.16.0 ngày 2026-09-29 tới 0.17.2 ngày 2026-10-26) |
| Fork | [vantt/obsidian-hybrid-search](https://github.com/vantt/obsidian-hybrid-search), tạo 2026-11-02 |
| Mốc khảo sát | upstream `master` = `201dd1f`, tag mới nhất `v0.17.2` |
| Người dùng của fork | Dự án `obsidian-pkm-automation` (sản phẩm PKM cho người làm một mình, freelancer, tiếng Việt). Trong đó OHS là phần tìm theo chữ và theo nghĩa; graph có loại do `kg`/`pkm` lo |
| Tiền lệ | [vantt/herdr](https://github.com/vantt/herdr): fork giữ mã upstream nguyên vẹn, phần riêng là chuỗi bản vá có thứ tự, tự đuổi theo mỗi bản phát hành |
| Người viết code | Một máy khác (agent). Tài liệu này phải đủ để làm mà không cần hỏi lại; chỗ nào còn phải quyết thì ghi rõ ở mục 15 |

Mục lục: 1 Bối cảnh · 2 Mục tiêu và không làm · 3 Hiện trạng OHS · 4 Mô hình fork học từ herdr · 5 Cài đặt fork lần đầu · 6 Catchup · 7 CI · 8 Gói dựng sẵn · 9 Bản vá · 10 Gói ngôn ngữ và tiếng Việt · 11 Kiểm thử · 12 Kiểm upstream bằng LLM · 13 Điện thoại · 14 Lộ trình · 15 Quyết định còn mở · 16 Rủi ro · Phụ lục.

---

## 1. Bối cảnh

Dự án dùng OHS cho: `related` (PageRank cá nhân hoá, hạt giống là hit OHS), trang nguyên liệu khi viết bài (`material`), gom vùng tri thức (`zones`, cần K note gần nghĩa), đề xuất `related` (cặp note gần nghĩa), và tool `search`/`read` cho Claude qua MCP. Đã đo trên vault thật của user (bản B, 1.979 note tiếng Việt): index 10,1 phút, 0 lỗi, model local `multilingual-e5-small`.

Quyết định đã chốt (user, 2026-11-01 và 2026-11-02):
1. Giữ OHS (JS, Node chấp nhận được), không viết lại bằng Rust lúc này.
2. Tự fork và tự duy trì, tự đuổi theo **mỗi** bản phát hành upstream, theo cách đã làm với herdr. Gửi PR hay issue lên upstream là tuỳ chọn, không phải điều kiện, và chỉ làm **sau khi** bản vá đã làm xong và chạy ổn trong fork.
3. Xử lý tiếng Việt là **một thư viện riêng**: có thư viện thì tiếng Việt tốt; không có thì OHS vẫn build, chạy và cho kết quả **y như upstream**. Không viết cứng tiếng Việt vào lõi. Đây là phần được đầu tư nhiều thời gian nhất.
4. Điện thoại: máy tính đang giữ vault chạy web server và trang xem đơn giản; không đồng bộ vault hay index vào điện thoại.

Ba vấn đề đã thấy khi dùng OHS với tiếng Việt và với sản phẩm (chi tiết ở mục 3):
- Tìm theo chữ (BM25) gần như hỏng khi gõ không dấu; `đ` không bao giờ khớp `d`; "hòa"/"hoà" là hai chữ khác nhau; dấu thanh bị gộp khiến "bán" kéo theo "bàn", "bạn".
- DB index luôn nằm trong vault, nên OneDrive, Obsidian Sync chép cả index.
- Dự án đang đọc thẳng bảng nội bộ `vec_chunks` của OHS để lấy vector (script `note_knn.mjs`, `similar_pairs.mjs` trong repo dự án). Upstream đổi cấu trúc là vỡ.

## 2. Mục tiêu và không làm

Mọi mục tiêu, việc và bản vá trong tài liệu mang một trong ba nhãn:
- **Bắt buộc**: phải có để fork dùng được cho dự án (mục 2.1; việc V00–V22).
- **Có thì tốt**: có giá trị nhưng không chặn ai; làm khi đủ điều kiện ghi ở cột "Làm khi" (mục 2.2; việc L01–L26).
- **Không làm**: đã cân nhắc và loại, ghi lý do để khỏi bàn lại (mục 2.3).

Trong mục 2.2, cột "Nguồn" cho biết ý đã bàn với user (`đã bàn`) hay do agent đề xuất khi viết PRD (`ý mới`, cần user xác nhận trước khi làm).

### 2.1. Bắt buộc
| ID | Mục tiêu | Đo bằng |
|---|---|---|
| G1 | Fork luôn có bản dựng trên tag upstream mới nhất trong vòng 24 giờ sau khi upstream phát hành, nếu không có xung đột | Thời điểm release `vX.Y.Z-vantt.N` so với tag upstream |
| G2 | Không có gói ngôn ngữ thì kết quả tìm giống hệt upstream cùng tag | Bài kiểm "bất biến" (mục 11.4): `top_paths` từng câu trong eval của upstream trùng khớp 100% |
| G3 | Có gói tiếng Việt thì tìm tiếng Việt tốt lên rõ, nhất là gõ không dấu | Bộ eval tiếng Việt (mục 11.5): ngưỡng ở mục 11.6 |
| G4 | Khách không phải chạy `npm`; cài từ gói dựng sẵn cho Windows x64, macOS ARM, macOS Intel, Linux x64 | Smoke test trên runner sạch của từng nền (mục 8.4) |
| G5 | Mỗi bản upstream mới đều có báo cáo: bản vá nào còn cần, upstream đã tự giải chỗ nào, chất lượng tìm tốt lên hay xấu đi | File `vantt/reviews/<tag>.md` (mục 12) |
| G6 | Dự án lấy vector và K note gần nhất qua lệnh chính thức của fork, không đọc bảng nội bộ | Bản vá P03 (mục 9) |
| G7 | DB index đặt được ngoài vault | Bản vá P02 |
| G8 | Gói tiếng Việt xử lý cả cách người Việt gõ và viết thật: chuỗi Telex/VNI gõ dở, gõ sai một chữ, đồng nghĩa và Việt–Anh, viết tắt, từ ghép, alias và tiêu đề không dấu; đoạn trích luôn là chữ gốc, đúng chỗ khớp (user chốt 2026-11-02, trước đây là N05, N14–N19) | Hạng mục `vi-telex`, `vi-typo`, `vi-synonym`, `vi-abbr`, `vi-compound`, `vi-alias`, `vi-snippet` của bộ eval (mục 11.5), ngưỡng ở mục 11.6 |
| G9 | Hợp đồng gói ngôn ngữ P01 thật sự chung: một gói ngôn ngữ thứ hai chạy được qua đúng hợp đồng đó mà không sửa lõi (user chốt 2026-11-02, trước đây N08) | Test của gói thứ hai và bài kiểm bất biến xanh khi bật gói đó (V21) |
| G10 | Biết reranker đa ngữ có đáng bật cho tiếng Việt không (user chốt 2026-11-02, trước đây N09) | Báo cáo eval reranker trên mọi hạng mục `vi`, kèm thời gian mỗi câu (V22) |

### 2.2. Có thì tốt
| ID | Mục tiêu | Lợi ích | Phía làm | Nguồn | Làm khi | Việc |
|---|---|---|---|---|---|---|
| N01 | Đoạn trỏ thẳng tới `^block`, biết đoạn nào user đã tô; kích thước đoạn cấu hình được | Trang nguyên liệu mở đúng đoạn, ưu tiên đoạn đã tô | fork (P05) | đã bàn | Khi làm lại trang nguyên liệu; theo dõi upstream issue #91 | L01 |
| N02 | Tìm giới hạn trong một tập note | "Tìm trong vùng", trong note đã nhận, trong hàng xóm graph | fork (P06) | đã bàn | Khi dự án cần tìm theo vùng | L02 |
| N03 | Sự kiện "note vừa index" | Graph cập nhật theo sự kiện, bỏ vòng đọc lại 5 s | fork (P07) | đã bàn | Khi dự án bỏ vòng đọc lại | L03 |
| N04 | Chọn model nhúng tốt nhất cho tiếng Việt (e5-small, e5-base, bge-m3, model chuyên tiếng Việt), có hay không phục hồi dấu cho nhánh vector | e5-small cho điểm nền quá cao, khó tách gần nghĩa thật với nhiễu | cấu hình, eval | đã bàn | Sau V13 | L04 |
| N06 | Gói "đầy đủ" có sẵn model | Cài không cần mạng | fork (bundle) | đã bàn | Khi có khách ở nơi mạng kém | L07 |
| N07 | Phát hành `ohs-lang-vi` công khai | Cộng đồng OHS dùng được, có người báo lỗi | gói vi | đã bàn | Gói ổn định qua 3 bản upstream | L09 |
| N11 | Gợi ý ngay khi đang viết: ô cạnh bài nháp hiện đoạn gần nghĩa với đoạn đang gõ, bấm để chèn link | Giúp bước "express" ngay trên note, không phải đi tìm | dự án (plugin), cần P04 | đã bàn | Sau V08 | L13 |
| N12 | OCR ảnh và PDF đính kèm vào phần chữ để tìm | Note toàn ảnh hết là nguồn nhiễu, tìm được chữ trong ảnh | fork hoặc dự án | đã bàn (đã nói chưa nên) | Khi note toàn ảnh thành phàn nàn thật; dự án riêng | L14 |
| N13 | Phương án dự phòng: viết lại phần tìm bằng Rust | Một binary, một DB, không Node | dự án (kế hoạch E12.7 giai đoạn 8) | đã bàn | Khi gói Node quá nặng, lỗi cài OHS thành phàn nàn thật, hoặc upstream ngừng | L15 |
| N20 | Sổ câu tìm cục bộ (chỉ trên máy user, tắt mặc định): câu không ra kết quả, câu không mở note nào | Nguồn câu thật để bổ sung golden set | dự án | ý mới | Sau V15 | L22 |
| N21 | LLM đề xuất câu hỏi và đáp án ứng viên từ vault để user duyệt nhanh khi làm golden set riêng | Giảm 2 giờ gán nhãn của user | dự án hoặc script fork | ý mới | Cùng V15 | L23 |
| N22 | Biểu đồ chỉ số eval qua các bản phát hành trong báo cáo review | Thấy xu hướng, không chỉ so hai bản | fork (review) | ý mới | Sau V14 | L24 |
| N23 | Gói cho Windows ARM64 | Máy Windows ARM (Snapdragon) đang tăng | fork (bundle) | ý mới | Khi có khách dùng | L25 |
| N24 | Nâng cấp tại chỗ và quay lui bản OHS cho khách (giữ bản cũ, đổi khi bản mới qua smoke) như `install.py --rollback` của herdr | Nâng cấp không làm hỏng máy khách | dự án (bộ cài) | ý mới | Khi phát hành bản thứ hai cho khách | L26 |

N05, N14–N19 đã chuyển thành **bắt buộc** trong gói `ohs-lang-vi` (user chốt 2026-11-02): mục tiêu G8, việc V17–V20, thiết kế ở mục 10. N08, N09, N10 cũng thành bắt buộc (user chốt 2026-11-02): G9 (V21), G10 (V22), và `material` gửi mọi câu tìm trong một lệnh làm trong V16. Giữ ID để tra lại lịch sử.

Đã chốt nhưng làm sau (không phải "có thì tốt"): điện thoại qua `pkm-web` (L06, mục 13), gửi issue/PR lên upstream sau khi đã làm (L08).

### 2.3. Không làm
- Không đổi model mặc định của upstream trong lõi. Model là cấu hình (`LOCAL_EMBEDDING_MODEL`); việc chọn model cho tiếng Việt là thí nghiệm (mục 14, L04), kết quả ghi vào cấu hình của bộ cài dự án.
- Không phát hành lên npm, không đăng MCP Registry dưới tên upstream.
- Không sửa plugin Obsidian của upstream (`obsidian-plugin/` là submodule). Plugin của dự án là plugin riêng.
- Không đưa nội dung vault thật của user vào repo, CI, log hay báo cáo. Eval trên vault thật chạy ở máy user, chỉ ghi số tổng hợp.
- Không đưa logic riêng của sản phẩm (graph, đề xuất, trang nguyên liệu) vào fork. Fork chỉ chứa thứ có ích cho mọi người dùng OHS, cộng gói ngôn ngữ.
- Không tự làm tìm kiếm trên điện thoại.

---

## 3. Hiện trạng OHS (v0.17.2, đã đọc mã)

Đường dẫn tính từ gốc repo. Số dòng là của `201dd1f`, dùng để định hướng; khi upstream đổi, tìm lại theo tên hàm.

### 3.1. Bố cục
- Điểm vào: `src/cli.ts` (preflight rồi `transports/cli.js`), `src/server.ts` (MCP stdio). Bin: `ohs`, `obsidian-hybrid-search` → `dist/src/cli.js`; `obsidian-hybrid-search-mcp` → `dist/src/server.js`.
- Thư mục theo trách nhiệm, được ép bằng `dependency-cruiser.config.cjs` và `test/architecture-boundaries.test.ts` (đọc `ARCHITECTURE.md` trước khi thêm thư mục):
  - `transports/`: `cli.ts`, `mcp-runtime.ts` (tool `search`, `reindex`, `status`, `read`), `mcp-http-server.ts`, `mcp-stdio-server.ts`, `stdio-server.ts` (JSON-lines cho plugin, chỉ có `search`, `status`), `mcp-supervisor.ts` (daemon).
  - `search/searcher.ts` (1.738 dòng): mọi phần tìm, trộn, rerank, related, read.
  - `indexing/`: `indexer.ts`, `index-service.ts`, `rebuild.ts`, `chunk-embedding.ts`, `content-filter*.ts`.
  - `content/`: `chunker.ts`, `note-extractor.ts`, `markdown-references.ts`, `text-normalization.ts` (NFD cho path, tag).
  - `inference/`: `embedder.ts`, `reranker*.ts`.
  - `storage/`: `db.ts` (schema, migration, ghi), `search-queries.ts` (SQL đọc). **Chỉ `storage/` được chạm `better-sqlite3`.**
  - `vault/`, `contracts/` (zod cho MCP và stdio), `runtime/` (`config.ts` biến môi trường, `local-state.ts`, `native-preflight.ts`, `auto-heal.ts`).
- Build: `tsc` thuần. Node `>=22.22.0` (`.node-version` 22.23.3), npm 12.2.0 (devEngines, `onFail: error`).
- Phụ thuộc native: `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`. `@huggingface/transformers` là optionalDependency, nạp bằng `import()` động.

### 3.2. DB
- Bảng chính `notes(id, path, title, tags, content, mtime, hash, aliases, frontmatter, embedding_context)`, `chunks(…, heading_path, char_start, char_end, source_spans)`, `links`, `settings(key, value)`, các bảng tra alias/tag/frontmatter (NFD + chữ thường).
- FTS: `notes_fts_bm25(title, aliases, content)`, external content trên `notes`, `tokenize = "unicode61 tokenchars '+#'"`, xếp hạng `bm25(…, 10.0, 5.0, 1.0)`; `notes_fts_fuzzy(title, aliases)` dùng `trigram`. Trigger `notes_ai/au/ad` giữ FTS khớp `notes`. Đổi `settings.fts_schema_version` thì FTS được dựng lại từ `notes`, không cần index lại.
- Vector: `vec_chunks USING vec0(chunk_id, embedding float[dim])`.
- **Bẫy migration:** `runMigrations` chỉ chạy khi `index_schema_version` khác `INDEX_SCHEMA_VERSION` (`db.ts:236`, `:553-585`). Mọi thay đổi schema phải tăng hằng số này, nếu không DB cũ không bao giờ được nâng.
- **Đường dẫn DB:** luôn là `<vault>/.obsidian-hybrid-search.db` (`runtime/config.ts:48-52`). `--db` chỉ dùng để dò vault (`vault-config.ts:35-65`), không đổi chỗ lưu. Daemon được khởi động với `OBSIDIAN_VAULT_PATH` (`mcp-supervisor.ts:306-310`).
- Dựng lại tự động khi đổi chính sách nội dung: `settings.content_policy` so với chữ ký mong muốn lúc khởi động, lệch thì `rebuildIndex` (`index-service.ts:236-248`). Embedding được dùng lại nhờ băm `embedding_context`.

### 3.3. Index
`prepareIndexFile` (`indexer.ts:294-452`): stat, bỏ qua nếu mtime và md5 không đổi → `extractMarkdownNote` (gray-matter, tiêu đề, tag, alias) → lọc nội dung (tuỳ chọn) → `chunkNote` (đoạn `{text, headingChain, charStart, charEnd}`, **không có id block, không có số dòng**) → nhúng (`passage: ` cho họ e5) → `commitIndexedNote`. Chữ được ghi vào `notes` ở `db.ts:921-936`, `:948-965`, `:1820-1842`.

Lỗi nhỏ phát hiện khi đọc: regex tag nội dòng ở `note-extractor.ts:55` dùng khoảng `À-ɏ`, không phủ chữ Việt U+1EA0–1EF9 (ạ, ế, ộ, ữ…). Tag như `#kếhoạch` bị cắt sai (bản vá P09).

### 3.4. Tìm
`search()` (`searcher.ts:1125`) → `searchByQuery` (`:1500-1596`): bốn nhánh vector, BM25, khớp alias chính xác, trigram tiêu đề; trộn RRF `k=60`, trọng số `[1.5, 1.5, 2.0, 0.25]` (`:1578-1584`). Câu BM25 dựng bằng `toFtsQuery`: mỗi chữ thành `"chữ"*`, nối OR (`:261-266`). Nhiều câu một lần: mỗi câu một lượt, trộn RRF (`:1309-1340`). Rerank (tuỳ chọn) sau RRF. Note tương tự: `searchSimilar` dùng vector đoạn đã lưu (`:1632-1654`). Có sẵn `getChunkEmbeddingsByPath` (`db.ts:707`) nhưng **không có lệnh xuất vector hay K note gần nhất**. Cache LRU 100 mục, khoá gồm `db_version` và mọi tuỳ chọn.

### 3.5. Tiếng Việt với SQLite FTS5 (đã chạy thử)
| Câu tìm | Note "giữ chân khách hàng", "kế hoạch tiếp thị", "đường đi" | Lý do |
|---|---|---|
| `khach` | khớp | á một dấu, `remove_diacritics=1` (mặc định) bỏ được |
| `giu`, `giu chan khach`, `ke hoach`, `tiep thi` | **không** | ữ, ế mang hai dấu; mặc định chỉ bỏ chữ một dấu |
| `duong` | **không** | `đ` (U+0111) không tách được, không bao giờ thành `d` |
| `bán` | ra cả "bàn", "bạn" | bỏ dấu cả hai phía, thanh điệu bị gộp |

Thêm hai biến thể chính tả mà mọi hệ tìm đều phải xử lý: vị trí dấu thanh kiểu cũ/kiểu mới (hòa/hoà, thủy/thuỷ, khỏe/khoẻ) và i/y (kĩ/kỹ, lí/lý).

### 3.6. Máy chủ
`ohs serve` (HTTP, mặc định 127.0.0.1:3939): `GET /health`, `POST /mcp` (MCP Streamable HTTP, không trạng thái). Bảo vệ duy nhất là danh sách Host hợp lệ. **Không có token, không CORS, không có REST JSON.** `ohs serve --stdio`: JSON-lines, chỉ `search` và `status`.

### 3.7. Kiểm thử, eval, CI của upstream
- vitest, 114 file test, `maxWorkers: 1`; cấu hình riêng cho integration (embedder thật), reranker, watcher. Ngưỡng coverage theo file. Test tạo vault tạm bằng `mkdtemp`, đặt `OBSIDIAN_VAULT_PATH`, mock embedder.
- Eval: `npm run eval -- --vault <dir> --golden-set <json> --output <file> --k 10 [--rerank]`. Golden set: mảng `{id, query, relevant_paths[], partial_paths[], category}`. Chỉ số: nDCG@k, MRR, Hit@k, Recall@k; kết quả từng câu có `top_paths`, `missed_paths`. Eval ghi DB vào thư mục vault và dựng lại toàn bộ. Cổng chất lượng `eval/quality.ts` trên `obsidian-help` (171 note, 58 câu): nDCG@5 ≥ 0,725, MRR ≥ 0,775… chạy trên macOS ARM vì ONNX lượng tử cho số khác nhau theo kiến trúc CPU.
- Workflow: `ci.yml` (ubuntu, macOS, Windows × Node 22, 24, 26; job `quality` trên `macos-26`), `auto-tag.yml` (CI xanh thì tự tạo tag), `release.yml` (npm, MCP Registry, GitHub Release), `update-deps.yml` (cron thứ Hai, cần GitHub App).
- Hook git: pre-commit lint-staged, commit-msg commitlint (conventional commits), pre-push chạy `npm run verify` đầy đủ (tải model, chạy eval).

### 3.8. Cơ chế mở rộng sẵn có
Không có cơ chế plugin hay hook. Chỗ gần nhất là giao diện `ContentFilter {signature, project(body), close()}` (`indexing/content-filter.ts:11-15`): chữ ký của nó đi vào `content_policy`, đổi thì tự dựng lại index. Gói ngôn ngữ (mục 10) dùng đúng cơ chế chữ ký này.

---

## 4. Mô hình fork, học từ herdr

### 4.1. herdr làm thế nào (đã đọc `vantt/herdr`)
- **Nhánh mặc định của fork giữ mã upstream nguyên vẹn.** Phần riêng nằm trong thư mục `vantt/` (script, bản vá, tài liệu) và skill `.agents/skills/herdr-catchup/`.
- **Chuỗi bản vá** `vantt/patches/series.toml`: mỗi bản vá có `id`, `name` (dùng làm thông điệp commit), `patch_file` (`git format-patch`), `metadata_file` (spec: yêu cầu, bất biến, cách viết lại khi xung đột), `consumer`, `upstream_status` (`unsubmitted | pr_opened | merged`), `upstream_pr`, `test_command`.
- **Spec của bản vá** là phần giá trị nhất: ghi *thứ phải còn đúng* sau mọi lần merge hay viết lại, các "điểm chạm" trong mã, và điều kiện bỏ bản vá khi upstream đã có cơ chế tương đương. Khi xung đột, agent đọc spec để viết lại thay vì cố áp diff cũ.
- **`catchup.py`**: fetch tag upstream, chọn tag ổn định cao nhất, tạo nhánh `vantt/<tag>` từ tag, chép lại `vantt/` và skill (vì checkout tag làm mất chúng), commit chúng, áp từng bản vá bằng `git apply --3way` (bỏ qua nếu `merged` hoặc áp ngược được, tức upstream đã có), commit mỗi bản vá, build với định danh fork (`0.9.1-vantt.1`), kiểm năng lực ("`--executable` có trong `--help`"), chạy `test_command` của từng bản vá. Xung đột thì dừng, giữ cây làm việc, ghi `vantt/.catchup_state.json`, in bản vá lỗi, file xung đột, đường dẫn spec; người hoặc agent sửa, `git add`, chạy `--continue`. Có `--ref`, `--dry-run`, `--clean`, `--abort`, `--json`, `--skip-tests`. Nhánh đã xanh thì nhận ra trong 1 giây, không build lại.
- **Workflow `fork-catchup-release.yml`**: cron 6 giờ một lần, chạy tay được với `target_ref`, chỉ chạy khi `github.repository == 'vantt/herdr'`. Thành công thì đẩy nhánh, đóng gói, tính sha256, tạo GitHub Release. Hỏng ở bất kỳ bước nào thì mở issue (không mở trùng nếu đã có issue đang mở cùng tiêu đề).
- **Bài học trong lịch sử commit của herdr:**
  1. Checkout tag làm mất `vantt/`; phải sao ra chỗ tạm rồi chép lại (`dirs_exist_ok`).
  2. `GITHUB_TOKEN` không đẩy được nhánh có commit chạm `.github/workflows`; herdr xoá workflow của upstream khỏi nhánh release trước khi đẩy (bản dựng đã xong nên nhánh release không cần chúng).
  3. Dùng một bản vá giả để tập xử lý xung đột (`test: add fake conflict patch`) rồi xoá.
  4. Mã nguồn trên nhánh chính phải trở về đúng upstream; tính năng chỉ sống trong `patches/` (`refactor(fork): restore pristine upstream source`).
  5. Bộ cài thay file nguyên tử (tránh "text file busy").
- **Chỗ herdr còn yếu, fork OHS phải làm tốt hơn:**
  1. Sau khi sửa xung đột, file `.patch` không được xuất lại, nên lần catchup sau lại xung đột đúng chỗ đó. Fork OHS phải xuất lại bản vá đã sửa (mục 6.4).
  2. "Upstream đã có chưa" chỉ được kiểm bằng áp ngược diff, tức trùng từng chữ. Upstream giải cùng vấn đề bằng mã khác thì không phát hiện được. Fork OHS thêm **probe hành vi** cho mỗi bản vá (mục 9.2) và quy trình kiểm bằng LLM (mục 12).
  3. Chỉ một nền (Linux). OHS có module native nên phải dựng theo ma trận nền (mục 8).
  4. Không có kiểm chất lượng. OHS là máy tìm: bản vá có thể làm kết quả xấu đi mà test vẫn xanh. Fork OHS có cổng chất lượng (mục 11.6).

### 4.2. Bố cục fork OHS
```
master (nhánh mặc định của fork)
├── (mã upstream, không sửa tay; chỉ đổi khi đồng bộ master với upstream/master)
├── vantt/
│   ├── PRD.md                      tài liệu này
│   ├── README.md                   tổng quan fork, lệnh hay dùng
│   ├── patches/
│   │   ├── series.toml             chuỗi bản vá có thứ tự (mục 9.1)
│   │   ├── 0000-fork-identity.patch
│   │   ├── 0000-fork-identity.spec.md
│   │   └── …
│   ├── packages/
│   │   └── ohs-lang-vi/            gói tiếng Việt, package npm riêng (mục 10)
│   ├── probes/                     probe hành vi của từng bản vá (mục 9.2)
│   ├── eval/
│   │   ├── vi/                     golden set tiếng Việt, cấu hình corpus (mục 11.5)
│   │   └── baselines/              kết quả eval đã chốt của mỗi bản phát hành
│   ├── scripts/
│   │   ├── catchup.mjs             mục 6
│   │   ├── bundle.mjs              mục 8
│   │   ├── invariance.mjs          mục 11.4
│   │   ├── quality-gate.mjs        mục 11.6
│   │   └── review-upstream.mjs     mục 12
│   ├── reviews/                    báo cáo mỗi bản upstream (mục 12)
│   └── reports/                    báo cáo JSON của catchup (gitignore trừ bản đã phát hành)
├── .claude/skills/
│   ├── ohs-catchup/SKILL.md        hướng dẫn agent chạy catchup, xử lý xung đột
│   └── ohs-upstream-review/SKILL.md  hướng dẫn kiểm bản upstream mới bằng LLM (mục 12)
└── .github/workflows/
    ├── vantt-catchup.yml           mục 7.2
    ├── vantt-bundles.yml           mục 7.3
    └── vantt-pr-check.yml          mục 7.4

vantt/v0.17.2 (nhánh phát hành, tạo bởi catchup)
= tag upstream v0.17.2 + commit "chore(vantt): …" chép vantt/ và skill + một commit cho mỗi bản vá
  + commit gỡ .github/workflows của upstream
```
Viết script bằng **Node (ESM, `.mjs`), không thêm phụ thuộc**, thay cho Python của herdr: Node đã bắt buộc cho OHS, chạy giống nhau trên mọi runner. Đọc TOML bằng một bộ đọc nhỏ tự viết (chỉ cần `[[patches]]`, chuỗi, mảng chuỗi, bool), như `parse_series_toml` của herdr.

### 4.3. Định danh phiên bản
- Bản fork: `<tag upstream>-vantt.<N>`, ví dụ `0.17.2-vantt.1`. `N` tăng khi cùng tag upstream mà chuỗi bản vá hoặc gói ngôn ngữ đổi.
- Ghi vào `package.json` `version` trên nhánh phát hành (bản vá P00 không ghi số cứng; catchup đặt số lúc build).
- `ohs --version` in số này. Gói `ohs-lang-vi` có phiên bản riêng (semver), in trong `ohs status`.

---

## 5. Cài đặt fork lần đầu (việc V00)

Đã làm khi viết PRD (2026-11-02):
- [x] Fork `flowing-abyss/obsidian-hybrid-search` thành `vantt/obsidian-hybrid-search`.
- [x] **Tắt hẳn GitHub Actions trên fork** (`PUT /repos/vantt/obsidian-hybrid-search/actions/permissions enabled=false`). Lý do: fork vừa tạo đang bật Actions; đẩy lên `master` sẽ chạy `ci.yml` của upstream (9 job + job macOS), cron `update-deps.yml` sẽ lỗi mỗi tuần vì thiếu GitHub App, `auto-tag.yml` sẽ tự tạo tag và gọi `release.yml` (npm, MCP Registry).
- [x] Thêm `vantt/PRD.md`, `vantt/README.md`, `.claude/skills/ohs-upstream-review/SKILL.md` lên `master`.
- [x] **Fork chỉ theo `upstream/master`** (user chốt 2026-11-02). Đã xoá 4 nhánh thử nghiệm của upstream bị chép sang lúc fork (`experiment/local-embedding-models`, `feat/graph-hybrid-search`, `node-llama-cpp`, `verify-release-performance`); fork chỉ còn `master` và các nhánh `vantt/*` do catchup tạo. Không đẩy nhánh nào khác của upstream lên fork.

Việc còn lại của V00 (máy làm code):
1. Thêm remote `upstream` chỉ theo `master`, chặn đẩy nhầm lên upstream, fetch tag (tag phát hành nằm trên `master`):
   ```bash
   git remote add -t master upstream https://github.com/flowing-abyss/obsidian-hybrid-search
   git remote set-url --push upstream DISABLE
   git fetch upstream --tags
   ```
   Catchup và CI cũng fetch theo cách này, không fetch mọi nhánh của upstream. Upstream có tag không nằm trên `master` (ví dụ `v0.1.5`, `v0.9.10`, đã xoá khỏi fork 2026-11-02); `--tags` vẫn kéo chúng về máy. Vì vậy catchup **chỉ chọn tag mà `git merge-base --is-ancestor <tag> upstream/master` đúng**, và script của fork không bao giờ `git push --tags`; chỉ đẩy đúng tag phát hành `vX.Y.Z-vantt.N`.
2. Sửa submodule `obsidian-plugin` nếu cần clone trên CI: URL đang là SSH (`git@github.com:…`). Không sửa `.gitmodules` của upstream trên `master`; trên CI dùng `git config --global url."https://github.com/".insteadOf "git@github.com:"` hoặc không clone submodule (OHS không cần nó để build).
3. Thêm `.gitignore` riêng cho `vantt/` (`vantt/.catchup-state.json`, `vantt/reports/*.json` trừ bản phát hành, `vantt/.work/`).
4. Thêm workflow `vantt-*.yml` (mục 7). Sau đó **bật lại Actions** và **tắt từng workflow của upstream**:
   ```bash
   gh api -X PUT repos/vantt/obsidian-hybrid-search/actions/permissions -F enabled=true -f allowed_actions=all
   # đẩy một commit để GitHub đăng ký workflow, rồi:
   for w in ci.yml auto-tag.yml release.yml update-deps.yml; do gh workflow disable "$w" --repo vantt/obsidian-hybrid-search; done
   gh workflow list --repo vantt/obsidian-hybrid-search --all   # chỉ vantt-* ở trạng thái active
   ```
   Trạng thái tắt gắn với đường dẫn file, giữ nguyên khi upstream sửa nội dung file.
5. `.gitignore` của upstream bỏ qua `.claude/`. File trong `.claude/skills/ohs-*` phải thêm bằng `git add -f`; catchup chép chúng sang nhánh phát hành cũng phải dùng `-f`. Không sửa `.gitignore` của upstream.
6. Không cài hook husky của upstream khi làm việc trên `vantt/` (pre-push chạy `verify` đầy đủ, tải model). Đặt `HUSKY=0` trong mọi script của fork; khi cần chạy `verify`, gọi tường minh.
7. Thêm secret nếu bước 2 của bài học herdr (đẩy nhánh có workflow) vẫn bị chặn: PAT `VANTT_PUSH_TOKEN` có quyền `contents:write` (không cần `workflow` nếu đã gỡ workflow khỏi nhánh release).

Xong khi: `gh workflow list` chỉ có `vantt-*` đang bật; `vantt-catchup.yml` chạy tay được trên `v0.17.2` và tạo nhánh `vantt/v0.17.2`.

---

## 6. Catchup: đuổi theo upstream (việc V01)

### 6.1. Lệnh
```
node vantt/scripts/catchup.mjs [--ref <tag|upstream/master|sha>] [--dry-run] [--clean]
                               [--continue] [--abort] [--skip-tests] [--skip-quality] [--json]
                               [--with-lang vi] [--report <file>]
```
| Cờ | Ý nghĩa |
|---|---|
| (không cờ) | Tag ổn định cao nhất dạng `v<semver>` (bỏ tag có `-`) |
| `--ref` | Tag, `upstream/master`, hoặc sha (để thử sớm trên master) |
| `--dry-run` | In kế hoạch: tag, nhánh, bản vá sẽ áp hay bỏ, không đụng git |
| `--clean` | Dựng lại kể cả khi nhánh `vantt/<tag>` đã xanh |
| `--continue` / `--abort` | Tiếp sau khi sửa xung đột / huỷ phiên đang dở, trả repo về nhánh trước đó |
| `--skip-tests`, `--skip-quality` | Chỉ cho dev; CI không bao giờ dùng |
| `--with-lang vi` | Ngoài các bài kiểm mặc định, chạy thêm bài kiểm của gói `ohs-lang-vi` (CI luôn bật) |
| `--json` | In báo cáo JSON (mục 6.5) |

### 6.2. Các bước
1. Kiểm cây làm việc sạch (chỉ file được git theo dõi). Có `vantt/.catchup-state.json` thì từ chối, bảo dùng `--continue` hoặc `--abort`.
2. Đảm bảo remote `upstream`, `git fetch upstream --tags`.
3. Chọn ref đích; tính tên nhánh `vantt/<tag>` (ref không phải tag: `vantt/upstream-master-<sha7>`).
4. Nhánh đã tồn tại, không `--clean`: kiểm báo cáo xanh gần nhất trong `vantt/reports/` khớp sha đích và sha của `series.toml` và của gói ngôn ngữ; khớp thì in "đã xanh" và thoát 0.
5. Sao `vantt/` và `.claude/skills/ohs-*` ra `vantt/.work/backup-<time>/` (ngoài git).
6. `git checkout -B vantt/<tag> <sha đích>`; chép lại phần đã sao; commit `chore(vantt): include fork maintenance files`.
7. Với mỗi bản vá theo thứ tự trong `series.toml`:
   - `upstream_status = "merged"` hoặc `git apply --reverse --check` thành công: ghi `SKIPPED_UPSTREAM_HAS_IT`, sang bản sau.
   - `git apply --3way <patch>`. Lỗi: ghi state (ref, sha, nhánh, chỉ số và id bản vá lỗi, danh sách file xung đột), in khối hướng dẫn (bản vá, file, đường dẫn spec, các lệnh tiếp theo), thoát mã **3**.
   - Thành công: `git add -A`, commit với thông điệp `name` của bản vá cộng dòng `Patch-Id: <id>`.
8. Đặt phiên bản `<tag>-vantt.<N>` vào `package.json` (N: số lớn nhất trong release đã có cho tag này + 1 nếu chuỗi bản vá đổi, ngược lại giữ N).
9. `npm ci` (với `HUSKY=0`), `npm run build`.
10. Kiểm năng lực: `node dist/src/cli.js --version` chứa `-vantt.`; mỗi bản vá có `capability_check` (ví dụ `ohs search --help` có `--paths-file`) thì chạy.
11. Kiểm thử (mục 11): `npm run test` của upstream; `test_command` của từng bản vá; bài kiểm của gói ngôn ngữ; bài kiểm bất biến (mục 11.4); cổng chất lượng (mục 11.6) trừ khi `--skip-quality`.
12. Gỡ `.github/workflows` của upstream khỏi nhánh (commit `chore(vantt): drop upstream workflows from release branch`).
13. Ghi báo cáo `vantt/reports/catchup-<tag>.json`, xoá state, in tóm tắt, thoát 0.

Mã thoát: 0 xanh; 2 lỗi dùng sai (cờ, cây bẩn); 3 xung đột bản vá; 4 build lỗi; 5 test lỗi; 6 cổng chất lượng không đạt; 7 lỗi khác.

### 6.3. Xử lý xung đột
Khi thoát mã 3, người hoặc agent (theo skill `ohs-catchup`):
1. Đọc spec của bản vá (`metadata_file`): mục "Bất biến" và "Điểm chạm".
2. Xem diff upstream ở các file xung đột giữa tag cũ và tag mới (`git log -p <tag cũ>..<tag mới> -- <file>`).
3. Viết lại cho đúng bất biến, **không** cố giữ diff cũ. Nếu upstream đã có cơ chế tương đương thoả mọi bất biến: không áp, đặt `upstream_status = "merged"` kèm ghi chú trong spec, và báo consumer (dự án) đổi sang cơ chế upstream.
4. `git add <file>`, `node vantt/scripts/catchup.mjs --continue`.

### 6.4. Xuất lại bản vá sau khi sửa (cải tiến so với herdr)
Khi một phiên catchup có xung đột đã sửa và chạy xanh, catchup **xuất lại** mọi bản vá đã áp từ commit trên nhánh (`git format-patch -1 <commit> --stdout`, tìm commit theo dòng `Patch-Id:`), ghi đè file trong `vantt/patches/`, rồi:
- CI: mở PR vào `master` với tiêu đề `chore(vantt): refresh patches for <tag>`.
- Chạy tay: in lệnh để chép các file bản vá về `master` và commit.

Nhờ đó lần catchup sau áp sạch trên upstream mới.

### 6.5. Báo cáo JSON
```json
{
  "status": "SUCCESS | CONFLICT | BUILD_FAILED | TESTS_FAILED | QUALITY_FAILED | ERROR",
  "target_ref": "v0.17.2", "target_sha": "…", "release_branch": "vantt/v0.17.2",
  "version": "0.17.2-vantt.1",
  "series_sha256": "…", "lang_packs": [{"id": "vi", "version": "0.1.0", "sha256": "…"}],
  "patches": [{"id": "db-path", "status": "APPLIED | SKIPPED_UPSTREAM_HAS_IT | CONFLICT", "commit": "…"}],
  "tests": {"upstream": "pass", "patches": {"db-path": "pass"}, "lang_vi": "pass", "invariance": "pass"},
  "quality": {"upstream_eval": {…}, "vi_eval": {…}, "gate": "pass"},
  "failed_patch": null, "conflicted_files": [],
  "started_at": "…", "finished_at": "…"
}
```

### 6.6. Đồng bộ `master` của fork với upstream
`master` của fork theo `upstream/master` và chỉ theo nhánh này; các nhánh khác của upstream không được theo dõi hay chép sang fork (để có mã mới nhất khi thử `--ref upstream/master`). Workflow catchup làm thêm một bước: `git merge --ff-only upstream/master` vào `master`; không fast-forward được (do `vantt/` là commit riêng) thì rebase các commit chỉ chạm `vantt/`, `.claude/skills/ohs-*`, `.github/workflows/vantt-*`. Quy tắc: **commit trên `master` của fork không bao giờ chạm file của upstream.** `vantt-pr-check.yml` (mục 7.4) chặn điều này.

---

## 7. CI (việc V02, V03)

### 7.1. Nguyên tắc
- Mọi workflow của fork có tiền tố `vantt-` và điều kiện `if: github.repository == 'vantt/obsidian-hybrid-search'`.
- Workflow của upstream bị tắt (mục 5) và bị gỡ khỏi nhánh phát hành.
- Ghim phiên bản action bằng sha. Node lấy từ `.node-version` của upstream; npm theo `devEngines` (`npm i -g npm@<bản trong package.json>`).
- Cache: `~/.npm`, `~/.cache/huggingface` (model). Không cache `node_modules` giữa các nền.

### 7.2. `vantt-catchup.yml`
- Kích hoạt: `schedule` mỗi 6 giờ; `workflow_dispatch` với `target_ref`, `force_rebuild`; `push` lên `master` chạm `vantt/patches/**` hoặc `vantt/packages/**` (dựng lại bản cho tag hiện tại).
- Runner: `ubuntu-latest`.
- Bước: checkout (`fetch-depth: 0`) → Node → `node vantt/scripts/catchup.mjs --with-lang vi --json --report catchup.json` (bỏ `--ref` thì lấy tag mới nhất; nhánh đã xanh thì thoát sớm) → nếu xanh: gỡ workflow upstream (catchup đã làm), đẩy nhánh `vantt/<tag>` (`--force-with-lease`), tạo tag `v<version>` trên nhánh, gọi `vantt-bundles.yml` (`workflow_call`) → nếu có bản vá được xuất lại: mở PR vào `master` → tải `catchup.json` lên artifact.
- Hỏng: mở issue `[catchup] <tag>: <status>` kèm bản vá lỗi, file xung đột, link run; không mở trùng nếu đã có issue mở cùng tag. Gắn nhãn `catchup`.
- Cổng chất lượng trên Linux chỉ so với baseline Linux (mục 11.6), vì số của ONNX lượng tử khác theo kiến trúc.

### 7.3. `vantt-bundles.yml` (gói dựng sẵn, mục 8)
- Kích hoạt: `workflow_call` từ catchup (với `ref` là nhánh phát hành); `workflow_dispatch`.
- Ma trận:
  | Nền | Runner | Ghi chú |
  |---|---|---|
  | `win32-x64` | `windows-latest` | Nền chính của khách |
  | `darwin-arm64` | `macos-14` hoặc mới hơn | |
  | `darwin-x64` | `macos-13` | Hỏi lại nếu GitHub ngừng runner Intel; khi đó dùng `macos-14` với Node x64 qua Rosetta và kiểm kỹ |
  | `linux-x64` | `ubuntu-latest` | Cho dev và máy chủ |
- Bước mỗi nền: checkout nhánh phát hành → `node vantt/scripts/bundle.mjs --platform <p>` (mục 8.2) → smoke test (mục 8.4) → tải gói và `.sha256` lên GitHub Release `v<version>` (tạo nếu chưa có, `--latest` chỉ khi đủ 4 nền).
- Release notes tự sinh: bản upstream gốc, danh sách bản vá và trạng thái, phiên bản gói ngôn ngữ, bảng chỉ số eval so với bản trước.

### 7.4. `vantt-pr-check.yml`
- Kích hoạt: PR vào `master` của fork.
- Kiểm: PR không sửa file nào ngoài `vantt/**`, `.claude/skills/ohs-*/**`, `.github/workflows/vantt-*`; `series.toml` hợp lệ (mọi `patch_file`, `metadata_file`, `probe` tồn tại; `id` không trùng); test của `ohs-lang-vi` (chạy độc lập, không cần OHS); lint Markdown nhẹ cho spec (có đủ các mục bắt buộc, mục 9.3); chạy `catchup.mjs --dry-run` trên tag hiện tại.

---

## 8. Gói dựng sẵn (việc V03)

### 8.1. Mục đích
Bộ cài của dự án (`pkm setup`) tải gói của đúng nền, kiểm sha256, giải nén vào `%LOCALAPPDATA%\pkm\ohs\<version>\` (Windows) hoặc `~/Library/Application Support/pkm/ohs/<version>/` (macOS). Khách không chạy `npm`. Node đi kèm cố định nên module native luôn khớp ABI.

### 8.2. Nội dung gói
```
ohs-<version>-<platform>/
├── node/                 Node portable đúng bản trong .node-version (tải từ nodejs.org, kiểm SHASUMS256 có chữ ký)
├── app/
│   ├── dist/             bản build của nhánh phát hành
│   ├── node_modules/     npm ci --omit=dev trên chính nền đó
│   └── package.json
├── lang/
│   └── ohs-lang-vi/      gói tiếng Việt đã build (mục 10), tách riêng để bộ cài chọn có hay không
├── bin/
│   ├── ohs.cmd / ohs     gọi node/node app/dist/src/cli.js, đặt NODE_OPTIONS rỗng
│   └── ohs-mcp.cmd / ohs-mcp
├── MANIFEST.json         version, upstream tag, sha từng file, danh sách bản vá, phiên bản gói ngôn ngữ, phiên bản Node
└── LICENSES/             LICENSE của OHS (MIT), Node, và các phụ thuộc (tạo bằng license-checker hoặc tương đương lúc build)
```
- Không đóng model vào gói (model tải lần đầu, khoảng 120 MB cho e5-small, vào thư mục cache của bộ cài). Tuỳ chọn sau: gói "đầy đủ" có model để cài không mạng (L07).
- Thu gọn: bỏ `*.md`, test, bản đồ nguồn, header C trong `node_modules`; bỏ build của nền khác trong `onnxruntime-node` (ví dụ bỏ thư mục `linux`, `darwin` trên gói Windows). Ghi kích thước trước và sau vào release notes. Mục tiêu: dưới 250 MB giải nén (đo thật trên Windows trước đây: 529 MB `node_modules`).
- Không đổi mã của phụ thuộc. Thu gọn chỉ xoá file.

### 8.3. Ký mã
- Windows: `node.exe` đã được Node Foundation ký; file `.cmd` không cần ký. Nếu bộ cài của dự án được ký thì gói không cần ký thêm. Ghi lại để kiểm SmartScreen trong smoke test.
- macOS: file tải về bị gắn quarantine; bộ cài gỡ `com.apple.quarantine` trên thư mục gói sau khi kiểm sha256. Các `.node` của phụ thuộc: kiểm `codesign -dv`; nếu Gatekeeper chặn thì cần ký lại bằng Developer ID của dự án (phụ thuộc ngân sách Apple Developer, mục 15).

### 8.4. Smoke test mỗi nền (trong CI)
1. Giải nén gói vào thư mục tạm có **dấu cách và chữ Việt** trong đường dẫn (ví dụ `Thư mục thử/ohs`).
2. Tạo vault nhỏ từ `vantt/eval/vi/smoke-vault/` (10 note tiếng Việt, có CRLF, tên NFD trên macOS).
3. `bin/ohs status`, `bin/ohs reindex` với model thật (cache model của CI), `bin/ohs search "giu chan khach" --json` khi bật gói tiếng Việt và khi tắt; kiểm số kết quả và note đứng đầu theo file kỳ vọng.
4. `bin/ohs-mcp` bắt tay MCP qua stdio (gửi `initialize`, `tools/list`), có tool `search`.
5. Đo: thời gian index, dung lượng gói, dung lượng DB; ghi vào artifact.

---

## 9. Bản vá

### 9.1. `series.toml`
```toml
[[patches]]
id = "db-path"                                   # duy nhất, kebab-case
name = "feat(storage): allow the index database outside the vault"
patch_file = "0002-db-path.patch"
metadata_file = "0002-db-path.spec.md"
consumer = "pkm installer; Obsidian Sync users"
upstream_status = "unsubmitted"                  # unsubmitted | issue_opened | pr_opened | merged | rejected
upstream_ref = ""                                # link issue hoặc PR
touches = ["src/runtime/config.ts", "src/vault/vault-config.ts", "src/transports/mcp-supervisor.ts"]
test_command = "npx vitest run test/vantt/db-path.test.ts"
capability_check = "node dist/src/cli.js status --json | node vantt/scripts/expect.mjs db_path"
probe = "vantt/probes/db-path.mjs"               # mục 9.2
phase = "now"                                    # now | later
```

### 9.2. Probe hành vi
Mỗi bản vá có một probe: script Node nhận đường dẫn tới một bản OHS **đã build** (`--ohs <dir>`), dựng vault tạm, kiểm **vấn đề gốc** (không kiểm mã của bản vá). Mã thoát: 0 vấn đề không còn; 1 vấn đề còn; 2 không kiểm được (lỗi môi trường). Probe chạy được trên bản upstream nguyên gốc. Dùng ở mục 12 để biết upstream đã tự giải chưa, kể cả khi giải bằng mã khác hoàn toàn. Probe phải dựa trên giao diện công khai (CLI, MCP, file trên đĩa), không import mã nội bộ.

### 9.3. Mẫu spec bắt buộc
```markdown
# Bản vá <id>: <tên>
- Consumer: …   - Trạng thái upstream: …   - Pha: now | later
## 1. Vấn đề (người dùng thấy gì, cách tái hiện trên bản upstream)
## 2. Yêu cầu
## 3. Bất biến (phải còn đúng sau mọi lần viết lại; đánh số)
## 4. Điểm chạm (file, hàm, vì sao chạm)
## 5. Kiểm thử (test đơn vị, test tích hợp, probe, capability_check)
## 6. Khi xung đột hoặc khi upstream đổi
   - Cách tìm lại điểm chạm
   - Điều kiện bỏ bản vá (upstream có cơ chế tương đương thoả bất biến nào)
## 7. Nội dung issue hoặc PR gửi upstream (nháp)
```

### 9.4. Danh sách bản vá
Thứ tự áp đúng như bảng. Bản vá giữ nhỏ, mỗi bản một việc, để ít xung đột.

| # | id | Pha | Việc | Công |
|---|---|---|---|---|
| P00 | `fork-identity` | now (Bắt buộc) | Định danh fork | 0,3 |
| P01 | `language-pack-api` | now (Bắt buộc) | Điểm cắm gói ngôn ngữ trong lõi (mục 10.2) | 2,5–3 |
| P02 | `db-path` | now (Bắt buộc) | DB ngoài vault | 1 |
| P03 | `vector-export` | now (Bắt buộc) | Xuất vector theo note và K note gần nhất | 1 |
| P04 | `stdio-parity` | now (Bắt buộc) | IPC JSON-lines có đủ `search` (mọi tuỳ chọn), `similar`, `read`, `neighbors` | 1 |
| P09 | `unicode-inline-tags` | now (Bắt buộc) | Tag nội dòng nhận mọi chữ Unicode | 0,3 |
| P05 | `block-anchors` | later (Có thì tốt) | Đoạn mang id block `^…` và cờ đoạn tô `==…==`; kích thước đoạn cấu hình được | 2 |
| P06 | `restrict-paths` | later (Có thì tốt) | Giới hạn tìm trong một tập note cho trước | 0,5–1 |
| P07 | `index-events` | later (Có thì tốt) | Phát sự kiện "note vừa index" qua stdio | 1 |

(Số P05–P07 giữ theo thứ tự đã bàn; P09 đứng trước vì là pha "now".)

#### P00 `fork-identity`
- **Vấn đề:** bản fork tự nhận là OHS upstream: kiểm cập nhật npm `obsidian-hybrid-search/latest` (`cli.ts:345`, `checkForUpdates` trong `mcp-runtime.ts`) và báo "có bản mới" sai; `--version` không cho biết đang chạy bản fork.
- **Yêu cầu:** biến `OHS_DISABLE_UPDATE_CHECK=1` (bộ cài luôn đặt) tắt kiểm cập nhật; `--version` và `status` in phiên bản từ `package.json` (đã có) và thêm trường `build: "vantt"` khi `package.json` có `"vanttFork": true`. Không đổi tên package, `bin`, tên tool MCP.
- **Bất biến:** không đặt biến thì hành vi như upstream; không có thay đổi nào khác.
- **Test:** biến bật thì không có request mạng nào tới registry (mock `fetch`).
- **Probe:** không có (bản vá chỉ phục vụ fork). Upstream status: không gửi.

#### P01 `language-pack-api`
Xem mục 10.2 (đặc tả đầy đủ). Bản vá chỉ chứa điểm cắm và cách nạp; không chứa một dòng tiếng Việt nào.

#### P02 `db-path`
- **Vấn đề:** DB luôn ở `<vault>/.obsidian-hybrid-search.db` (cộng `-wal`, `-shm`). OneDrive, Obsidian Sync, Dropbox chép cả index (hàng trăm MB), có thể gây xung đột file và hỏng DB khi hai máy cùng ghi.
- **Yêu cầu:**
  1. Biến `OBSIDIAN_DB_PATH` (đường dẫn tuyệt đối tới file DB). Có thì mở DB ở đó; không có thì như upstream.
  2. `--db <path>` của CLI: nếu file tồn tại và `settings.vault_path` khớp vault đang dùng thì dùng làm DB thật (không chỉ để dò vault). Nếu chưa tồn tại và có `OBSIDIAN_VAULT_PATH` thì tạo ở đó.
  3. Daemon (`mcp-supervisor.ts`) nhận cùng biến.
  4. `status` in `db_path`.
  5. Thư mục cha của DB được tạo nếu chưa có. DB ngoài vault thì không cần mẫu bỏ qua trong vault.
- **Bất biến:** (1) không đặt gì thì đường dẫn và hành vi y hệt upstream. (2) Một DB không bao giờ được dùng cho vault khác vault ghi trong `settings.vault_path` (đã có bài học upstream issue #45: dò cấu hình nhận nhầm DB của vault khác và xoá note); lệch thì từ chối với thông báo rõ. (3) Mọi transport (CLI, MCP stdio, HTTP, stdio IPC, daemon) dùng cùng một DB.
- **Điểm chạm:** `runtime/config.ts` (getter `dbPath`), `vault/vault-config.ts` (`discoverConfig`), `transports/cli.ts` (`preAction`), `transports/mcp-supervisor.ts` (env của daemon), `storage/db.ts` (`getStats` dùng `config.dbPath`), `vault/ignore.ts` (mẫu bỏ qua vận hành vẫn đúng khi DB trong vault).
- **Test:** vault tạm và DB ở thư mục tạm khác; index rồi kiểm không có file `.obsidian-hybrid-search.db*` trong vault; mở lại bằng `--db`; DB của vault A dùng cho vault B thì báo lỗi; daemon dùng đúng DB (test tích hợp với supervisor).
- **Probe:** index vault tạm theo cách upstream khuyên (nếu upstream thêm tuỳ chọn tương đương, probe thử cả tên biến của upstream ghi trong spec); kiểm file DB có xuất hiện trong vault không.
- **Upstream:** gửi sau khi bản vá đã làm xong và chạy ổn trong fork (L08). Nháp ở phụ lục B.

#### P03 `vector-export`
- **Vấn đề:** dự án đọc thẳng `vec_chunks`, `chunks`, `notes` để tính vector trung bình của note và K note gần nhất. Upstream đổi schema là vỡ.
- **Yêu cầu:** hai lệnh CLI, đầu ra JSON Lines (một dòng mỗi note), có tương đương trong stdio IPC (P04):
  - `ohs vectors [--path <note>]… [--pooling mean|max] [--normalize]`: `{path, dim, model, chunks, vector:[…]}`. Mặc định mean rồi chuẩn hoá L2.
  - `ohs neighbors [--path <note>]… [--k 10] [--min-score x] [--exclude-linked] [--scope …]`: `{path, neighbors:[{path, score}]}`. Không có `--path` thì cho mọi note. Điểm là cosine trên vector note đã gộp, tính trong JS theo lô (vault 10.000 note phải chạy dưới 2 phút trên máy phổ thông; nếu chậm hơn, dùng KNN của `sqlite-vec` theo đoạn rồi gộp).
  - Đầu ra kèm dòng đầu `{"meta": {"model", "dim", "pooling", "note_count", "ohs_version"}}`.
- **Bất biến:** chỉ đọc; không thêm bảng; lỗi model hoặc dim lệch thì báo, không trả vector sai.
- **Điểm chạm:** `storage/db.ts` (dùng `getChunkEmbeddingsByPath` và một hàm đọc theo lô mới trong `storage/`), lệnh mới trong `transports/cli.ts`, logic gộp trong `search/` (không để `transports` tính toán).
- **Test:** vault tạm với embedder giả (vector cố định) → so vector trung bình và thứ tự láng giềng với kết quả tính tay.
- **Probe:** gọi `ohs vectors --help`; upstream có lệnh tương đương thì kiểm đầu ra có đủ trường cần.
- **Sau khi có:** sửa `note_knn.mjs`, `similar_pairs.mjs` trong repo dự án dùng lệnh này (việc phía dự án, V14).

#### P04 `stdio-parity`
- **Vấn đề:** IPC JSON-lines (`serve --stdio`) chỉ có `search`, `status`. Plugin của dự án và máy chủ điện thoại (mục 13) cần nạp model một lần rồi gọi nhiều lệnh; hiện phải mở tiến trình mới cho mỗi lệnh (khoảng 2 s nạp model).
- **Yêu cầu:** thêm action `similar`, `read`, `vectors`, `neighbors` (P03), `reindex` (một file hoặc cả vault); `search` nhận đủ tuỳ chọn như MCP (`queries[]`, `scope`, `tag`, `frontmatter`, `rerank`, `mode`, `limit`, `snippetLength`). Mỗi request có `id`, phản hồi mang cùng `id`; nhiều request đồng thời được (xếp hàng nội bộ). Schema bằng zod trong `contracts/boundary-validation.ts`.
- **Bất biến:** request cũ (`search`, `status`) giữ nguyên định dạng; `test/transport-parity.test.ts` phải được mở rộng để mọi tuỳ chọn mới đi qua mọi transport.
- **Test:** mở rộng test parity; test request đồng thời; test lỗi schema trả `{id, error}`.
- **Probe:** gửi `{"action":"similar"}` tới `serve --stdio`; có kết quả hợp lệ thì upstream đã có.

#### P09 `unicode-inline-tags`
- **Vấn đề:** `note-extractor.ts:55` dùng khoảng `À-ɏ`; tag nội dòng có chữ Việt (ạ, ế, ộ, ữ… trong U+1EA0–1EF9) bị cắt hoặc bỏ. Cũng ảnh hưởng tiếng Hy Lạp, Cyrillic, CJK.
- **Yêu cầu:** dùng lớp Unicode (`\p{L}\p{N}`, cờ `u`) cho ký tự của tag, giữ quy tắc hiện có về ký tự đầu và dấu `/`, `-`, `_`.
- **Bất biến:** tag ASCII và Latin mở rộng cho kết quả như cũ (test hồi quy với bộ tag hiện có trong test của upstream).
- **Test:** `#kếhoạch`, `#dự-án/2026`, `#тест`, `#日本`, `#ưu_tiên` nhận đúng; `#123` theo quy tắc hiện có.
- **Probe:** vault tạm có note với `#kếhoạch`, kiểm `ohs search --tag kếhoạch`.
- **Upstream:** gửi sau khi bản vá đã làm xong và chạy ổn trong fork (L08). Nháp ở phụ lục B.

#### P05 `block-anchors` (để sau)
- Lưu `block_id` (chuỗi `^abc` cuối đoạn) và `has_highlight` (đoạn chứa `==…==` hoặc `<mark>`) cho mỗi đoạn; trả trong kết quả (`anchors`). Thêm `OBSIDIAN_CHUNK_TOKENS` (kích thước đoạn tối đa, `min(giới hạn model, giá trị)`), lưu kích thước hiệu lực vào `settings` và dựng lại khi đổi. Theo dõi upstream issue #91 (đề xuất y hệt phần kích thước đoạn); nếu upstream làm thì bỏ phần đó khỏi bản vá.
- Dùng cho: trang nguyên liệu trỏ `note#^block`; ưu tiên đoạn user đã tô.

#### P06 `restrict-paths` (để sau)
- Tuỳ chọn `paths[]` (hoặc `--paths-file`) giới hạn mọi nhánh tìm vào tập note cho trước, đẩy xuống SQL như `buildFilterPredicate`.

#### P07 `index-events` (để sau)
- stdio IPC phát `{"event":"indexed","paths":[…],"db_version":n}` sau mỗi lô ghi, và `{"event":"removed",…}`. Dự án dùng để cập nhật graph theo sự kiện thay vì đọc lại vault mỗi 5 s.

---

## 10. Gói ngôn ngữ và tiếng Việt

### 10.1. Nguyên tắc
1. **Lõi không biết tiếng Việt.** Bản vá P01 chỉ thêm điểm cắm chung cho mọi ngôn ngữ. Mọi quy tắc tiếng Việt nằm trong package riêng `ohs-lang-vi`.
2. **Không có gói = upstream.** Không cấu hình gói thì không tạo bảng nào mới, không thêm nhánh tìm nào, kết quả giống hệt upstream (bài kiểm bất biến, mục 11.4). Cấu hình gói mà không nạp được (thiếu file, lỗi, sai phiên bản API) thì in cảnh báo một lần, `status` báo `language_pack: {requested: "vi", loaded: false, error: "…"}`, OHS chạy tiếp như không có gói.
3. **Không sửa văn bản gốc.** `notes.content`, snippet, `read` luôn trả chữ gốc. Gói chỉ sinh **dạng phụ** để index và để tìm.
4. **Không index lại vector khi đổi gói.** Đổi, thêm, bỏ gói chỉ dựng lại phần chữ (FTS); embedding được dùng lại. Có test đếm số lần gọi embedder bằng 0.
5. **Gói thuần TypeScript, không phụ thuộc runtime, không native.** Chạy được và test được độc lập với OHS.
6. **Hợp đồng có phiên bản.** `apiVersion` tăng khi đổi không tương thích; lõi từ chối gói khác phiên bản với lỗi rõ.

### 10.2. Điểm cắm trong lõi (bản vá P01)

#### Cấu hình và nạp
- Biến `OHS_LANGUAGE_PACK`: tên module (`ohs-lang-vi`) hoặc đường dẫn tuyệt đối tới thư mục gói (bộ cài dùng đường dẫn trong gói dựng sẵn, `lang/ohs-lang-vi`).
- Biến `OHS_LANGUAGE_PACK_OPTIONS`: JSON tuỳ chọn truyền cho gói (ví dụ `{"tonePlacement":"modern","foldIY":true}`).
- Nạp bằng `import()` với chuỗi tính lúc chạy (để `dependency-cruiser` không đòi khai báo trong `package.json`). Gói **không** nằm trong `package.json` của OHS, kể cả `optionalDependencies`.
- Thư mục mới `src/language/`: `types.ts` (hợp đồng), `loader.ts` (nạp, kiểm `apiVersion`, cache), `noop.ts`. Cập nhật `dependency-cruiser.config.cjs` và `test/architecture-boundaries.test.ts`: `language/` chỉ import `runtime/config.ts`; `indexing/`, `search/` được import `language/`; `language/` không chạm `storage/`. Cập nhật `knip.json` nếu cần.
- MCP, CLI, stdio IPC, daemon đều nạp qua `loader.ts`; daemon nhận cùng biến môi trường.

#### Hợp đồng `LanguagePackV1`
```ts
export interface LanguagePackV1 {
  apiVersion: 1;
  id: string;                 // "vi"
  version: string;            // semver của gói
  /** Chữ ký cấu hình: đổi giá trị này thì lõi dựng lại phần chữ. Gồm version và tuỳ chọn có ảnh hưởng tới index. */
  signature(): string;

  /** Các "dạng phụ" để index. Tối đa 3. Mỗi view thành một bảng FTS riêng và một nhánh RRF riêng. */
  views: ReadonlyArray<{
    name: string;             // [a-z][a-z0-9_]{0,15}, ví dụ "norm", "fold"
    weight: number;           // trọng số RRF của nhánh này, ví dụ 1.5 và 0.75
    tokenizer?: string;       // tokenizer FTS5; mặc định "unicode61 remove_diacritics 0 tokenchars '+#'"
  }>;

  /** Sinh văn bản của một view cho một trường. Hàm thuần, xác định, nhanh (dưới 1 ms cho 10 KB). */
  project(view: string, field: 'title' | 'aliases' | 'content', text: string): string;

  /** Phân tích câu tìm. Được gọi một lần mỗi câu (và mỗi câu trong queries[]). */
  analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis | Promise<QueryAnalysis>;

  /** View dùng thêm cho nhánh "alias chính xác" (con của views). Lõi lưu project(v, 'aliases', alias) và project(v, 'title', title) của từng note làm khoá tra. */
  aliasViews?: ReadonlyArray<string>;

  /** Khoá cache phía câu tìm: đổi khi dữ liệu chỉ dùng lúc tìm đổi (file đồng nghĩa, viết tắt). Không làm dựng lại index. */
  queryCacheKey?(): string;

  /** Chấm lại ứng viên sau RRF, trước rerank. Tuỳ chọn. Không được bỏ ứng viên, chỉ đổi điểm. */
  rescore?(candidates: ReadonlyArray<Candidate>, analysis: QueryAnalysis, ctx: QueryContext):
    ReadonlyArray<{ path: string; score: number }> | Promise<…>;
}

export interface QueryAnalysis {
  /** Câu FTS cho từng view; null thì bỏ nhánh view đó cho câu này. Lõi tự làm sạch và dựng biểu thức FTS bằng toFtsQuery. */
  viewQueries: Record<string, string | null>;
  /** Câu dùng cho nhánh BM25 gốc của upstream; mặc định là câu gốc. */
  baseQuery?: string;
  /** Câu gửi cho embedder (nhánh vector); mặc định là câu gốc. */
  embedQuery?: string;
  /** Khoá tra alias chính xác cho từng view trong aliasViews; null thì bỏ. */
  aliasKeys?: Record<string, string | null>;
  /** Dữ liệu riêng của gói, chuyển nguyên cho rescore. */
  data?: unknown;
  /** Ghi chú để debug (in khi LOG_LEVEL=debug và trong --explain). */
  debug?: Record<string, unknown>;
}

export interface QueryContext {
  /** Tần suất của một term trong một view: số note chứa, tổng số lần. Từ bảng fts5vocab của view. */
  termStats(view: string, term: string): { docs: number; hits: number };
  /** Các term của view có tiền tố cho trước (để mở rộng), giới hạn số lượng. */
  termsWithPrefix(view: string, prefix: string, limit: number): Array<{ term: string; docs: number }>;
  /** Số note chứa đúng cụm (phrase query) trong view. */
  phraseDocs(view: string, phrase: string): number;
  /** Tổng số note. */
  noteCount(): number;
  /** Đường dẫn vault, để gói đọc file khai báo của user (đồng nghĩa, viết tắt). Chỉ đọc. */
  vaultPath: string;
}

export interface Candidate {
  path: string;
  score: number;              // điểm hybrid sau RRF
  title: string;
  snippet: string;            // chữ gốc
  matchedViews: string[];     // các view đã khớp
  rank: Record<string, number | null>;   // thứ hạng trong từng nhánh
}
```

**Bất biến token của view** (gói phải giữ, P01 kiểm bằng test): với mọi `view` và `field`, tách `project(view, field, text)` bằng tokenizer của view ra cùng thứ tự token như tách `text` bằng `unicode61 remove_diacritics 0`; token thứ k của view ứng với token thứ k của chữ gốc. Ngoại lệ duy nhất: một token view được ghép từ nhiều token gốc liền nhau bằng `_` (view tách từ) và đếm là bấy nhiêu token gốc. Lõi dùng bất biến này để đưa chỗ khớp ở view về chữ gốc (đoạn trích, mục Tìm).

#### Index
- Với mỗi view `v`: bảng `notes_lex_<v>(note_id INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE, title, aliases, content)` và bảng FTS external content `notes_fts_lex_<v>(title, aliases, content)` trên đó, tokenizer của view, trigger giữ đồng bộ như bảng upstream. Thêm bảng `fts5vocab` `notes_fts_lex_<v>_vocab` (kiểu `row`) cho `termStats`.
- Văn bản view được tính trong `indexing/` (ở `prepareIndexFile`, cạnh nơi dựng `PreparedIndexNote`) và ghi trong cùng giao dịch với `upsertNote` (thêm tham số vào hàm ghi của `storage/`; `storage/` không gọi gói).
- Không có gói: không tạo bảng `notes_lex_*`. Có gói rồi bỏ: xoá các bảng `notes_lex_*` lúc mở DB.
- Chữ ký: nối `lang:<id>@<signature()>` vào chữ ký `content_policy` (cơ chế ở `index-service.ts:236-248`). Đổi chữ ký thì dựng lại; phải bảo đảm đường dựng lại **dùng lại embedding** (kiểm `embedding_context` không đổi vì văn bản đầu vào embedder không đổi) và chỉ tính lại view. Nếu đường `rebuildIndex` hiện tại không cho phép như vậy, thêm đường dựng lại riêng cho view: duyệt `notes`, gọi `project`, ghi `notes_lex_*`, dựng lại FTS (`INSERT INTO notes_fts_lex_v(notes_fts_lex_v) VALUES('rebuild')`).
- Với mỗi `v` trong `aliasViews`: bảng `notes_alias_lex_<v>(note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE, key TEXT)` có index trên `key`, ghi cùng giao dịch; `key` là `project(v, 'aliases', alias)` cho từng alias và `project(v, 'title', title)`.
- Tăng `INDEX_SCHEMA_VERSION` (bẫy migration, mục 3.2) và thêm khoá `settings.language_pack` lưu `{id, version, signature, views}`.

#### Tìm
- Trong `searchByQuery` (`searcher.ts:1500`), trước các nhánh: gọi `analyzeQuery`. Khoá cache (`:1275`) thêm chữ ký gói, `queryCacheKey()` (nếu có) và **câu gốc** (không dùng câu đã phân tích làm khoá).
- Alias chính xác (`searchByAliasExact`, `searcher.ts:384`): ngoài khớp của upstream, tra `aliasKeys[v]` trong `notes_alias_lex_<v>`; note khớp vào cùng nhánh alias (trọng số RRF 2.0), xếp sau khớp của upstream, không trùng path. Không có gói thì nhánh y như upstream.
- Đoạn trích của kết quả đến từ nhánh view: `snippet()` trên bảng view cho chữ đã chiếu (bỏ dấu, nối `_`), **không được trả ra**. Lõi lấy vị trí token khớp (mốc `SNIPPET_MARK_START/END`, `searcher.ts:268-273`, hoặc hàm `offsets`), đổi về token gốc theo bất biến token, rồi cắt đoạn trích từ `notes.content` gốc quanh đó, cùng độ dài và cùng cách đánh dấu như nhánh BM25 upstream; `buildMatchTextFromMarkedSnippet` nhận đoạn đã đổi. Kết quả thêm trường `matchedTerms` (chữ gốc đã khớp, ví dụ gõ "ke hoach" ra `["kế", "hoạch"]`) để client tô.
- Nhánh BM25 gốc dùng `analysis.baseQuery ?? query`. Nhánh vector dùng `analysis.embedQuery ?? query`. Mỗi view có `viewQueries[v]` khác null thành một nhánh BM25 mới trên `notes_fts_lex_<v>`, cùng giới hạn ứng viên, cùng bộ lọc (`buildFilterPredicate`).
- RRF: danh sách nhánh = 4 nhánh upstream + các nhánh view, trọng số view lấy từ `views[].weight`. Không có gói thì danh sách và trọng số y hệt upstream.
- `rescore` (nếu có) chạy sau RRF và gán `scores.hybrid`, trước rerank (`:1586-1593`); với nhiều câu, chạy sau khi trộn (`:1326-1330`) với phân tích của câu đầu. Lõi chuẩn hoá điểm trả về vào [0, 1], giữ nguyên tập ứng viên.
- Chế độ `fulltext`: nhánh BM25 gốc + nhánh view, trộn RRF. Chế độ `title`: dùng thêm view của trường `title`. Chế độ `semantic`: chỉ `embedQuery`.
- Thêm tuỳ chọn `explain` (CLI `--explain`, MCP và stdio cờ `explain: true`): trả thêm `analysis.debug` và thứ hạng từng nhánh của mỗi kết quả. Dùng cho eval và cho mục 12.

#### Test của P01 (trong bản vá, không phụ thuộc tiếng Việt)
- Gói giả `test/vantt/fixtures/lang-upper` (view `upper`: chữ hoa toàn bộ; `analyzeQuery` trả câu viết hoa) chứng minh: bảng view được tạo, nhánh view chạy, RRF có thêm nhánh, `explain` trả đúng.
- Không cấu hình gói: `sqlite_master` không có bảng `notes_lex_%`; kết quả tìm trùng với khi chưa có bản vá (so với snapshot).
- Gói lỗi (ném lỗi lúc nạp, `apiVersion: 2`, `project` ném lỗi): OHS chạy tiếp, `status` báo lỗi, không có bảng view.
- Đổi chữ ký gói: dựng lại view, số lần gọi embedder = 0.
- `rescore` trả điểm cho path lạ hoặc thiếu path: lõi bỏ qua path lạ, giữ điểm cũ cho path thiếu.
- `aliasViews`: gói giả khớp alias viết hoa vào nhánh alias; không có gói thì nhánh alias trùng snapshot.
- Đoạn trích từ nhánh view là chữ gốc, đúng vị trí khớp, kể cả token ghép `_`; `matchedTerms` đúng. Gói vi phạm bất biến token: lõi rơi về đoạn trích đầu note và ghi cảnh báo, không lỗi.
- `queryCacheKey()` đổi thì cache không trả kết quả cũ; index không dựng lại.

### 10.3. Gói `ohs-lang-vi`

Vị trí: `vantt/packages/ohs-lang-vi/` (package npm riêng, `"private": true` cho tới khi quyết phát hành). Build ra ESM. Không phụ thuộc runtime. Dev: TypeScript, vitest, fast-check (test thuộc tính).

#### Mô-đun
| Mô-đun | Việc |
|---|---|
| `normalize.ts` | Chuẩn hoá giữ dấu: NFC; chữ thường; vị trí dấu thanh về một kiểu chuẩn (tuỳ chọn `tonePlacement: "modern" \| "classic"`); thay ký tự lạ hay gặp (U+0110/0111 viết nhầm thành Ð U+00D0, dấu thanh tổ hợp rời, khoảng trắng không ngắt). Hàm idempotent |
| `fold.ts` | Bỏ dấu: NFD, bỏ dấu tổ hợp, `đ→d`, `Đ→D`; tuỳ chọn `foldIY` (i/y cuối âm tiết sau phụ âm: kĩ/kỹ, lí/lý, mĩ/mỹ, hi/hy; không gộp sau nguyên âm: "tai" ≠ "tay"). Idempotent |
| `syllable.ts` | Tách âm tiết tiếng Việt thành phụ âm đầu, âm đệm, âm chính, âm cuối, thanh (bảng quy tắc chính tả, xử lý `qu`, `gi`, `ngh`, `gh`). Dùng cho đặt dấu và cho nhận diện chữ có phải âm tiết Việt không (không đụng chữ tiếng Anh như "online", "team") |
| `views.ts` | Định nghĩa view: `norm` (chuẩn hoá giữ dấu, trọng số 1.5) và `fold` (bỏ dấu, trọng số 0.75). Trọng số chốt bằng eval |
| `query.ts` | `analyzeQuery`: chuẩn hoá câu; xác định câu có dấu (mọi âm tiết Việt có dấu nào không); câu có dấu → `norm` = câu chuẩn hoá, `fold` = câu bỏ dấu; câu không dấu → `norm` = null (hoặc câu phục hồi, xem `restore.ts`), `fold` = câu bỏ dấu; `embedQuery` = câu phục hồi khi tin cậy đủ (bật bằng tuỳ chọn, chốt bằng eval) |
| `restore.ts` | Phục hồi dấu theo từ vựng của vault: với mỗi âm tiết không dấu, lấy các dạng có dấu có thật trong view `norm` có cùng dạng bỏ dấu (dùng `termStats`, `termsWithPrefix` trên view `fold` để tìm, rồi tra ngược sang `norm`) kèm tần suất; với cặp âm tiết liền nhau, ưu tiên cặp có thật (`phraseDocs` trên `norm`); chọn tổ hợp tốt nhất bằng quy hoạch động (Viterbi) trên điểm unigram + bigram, giới hạn tối đa 5 biến thể mỗi âm tiết và câu tối đa 12 âm tiết. Trả danh sách tổ hợp kèm xác suất. Cần bảng ánh xạ ngược fold→norm: dựng từ `fts5vocab` của view `norm` (lõi cung cấp `termsWithPrefix`; gói tự bỏ dấu từng term để gom). Cache trong bộ nhớ theo `db_version` |
| `rescore.ts` | Cộng điểm cho ứng viên có tổ hợp phục hồi xác suất cao xuất hiện đúng (theo `matchedViews` và snippet), cộng điểm cho khớp cụm hai âm tiết; công thức có tham số, chốt bằng eval. Không bao giờ bỏ ứng viên |
| `telex.ts` | Giải chuỗi Telex và VNI gõ dở (bộ gõ tắt hoặc nhầm chế độ): "tieengs vieetj", "tie6ng vie65t" → "tiếng việt". Chỉ áp cho token **không** có trong từ vựng vault (view `fold`) mà dạng giải ra có trong từ vựng `norm`; nếu không thì giữ nguyên ("team", "seen" không bị đổi). Bảng quy tắc Telex (`s f r x j`, `aa ee oo aw ow uw dd w`) và VNI (`1–9`) đầy đủ |
| `typo.ts` | Sửa gõ sai một chữ theo từ vựng vault: khoảng cách sửa 1 (thêm, bớt, thay, đảo hai chữ liền nhau) trên dạng bỏ dấu, chỉ cho token không có trong từ vựng, dài từ 3 chữ, tối đa 3 ứng viên theo tần suất. Dùng chung bảng từ vựng trong bộ nhớ với `restore.ts` (cache theo `db_version`); thêm dạng sửa vào câu view (nối OR), không thay câu gốc |
| `lexicon.ts` | Đồng nghĩa và viết tắt do user khai báo trong một file của vault (đường dẫn qua tuỳ chọn `lexiconPath`, mặc định `_ohs/lexicon.md`; định dạng mỗi dòng một nhóm `khách hàng = customer = KH`, chốt ở Q8). Mở rộng câu ở `analyzeQuery`: thêm các dạng cùng nhóm vào câu view (nối OR, trọng số thấp hơn qua `rescore`), không đổi `embedQuery`. Đọc file qua `ctx.vaultPath`; `queryCacheKey()` = băm nội dung file |
| `abbr.ts` + lệnh `ohs-lang-vi learn-abbr --vault <dir>` | Học viết tắt từ vault: quét Markdown tìm mẫu định nghĩa ("khách hàng (KH)", "KH: khách hàng", "KH = khách hàng") và cụm nhiều âm tiết hay gặp có chữ đầu khớp chữ viết tắt (KH → khách hàng, DN → doanh nghiệp, TP.HCM → thành phố Hồ Chí Minh). Ghi **đề xuất** vào file lexicon dưới mục chờ duyệt; chỉ dòng user đã chuyển lên mục chính mới được dùng. Chạy tay, không chạy lúc index |
| `segment.ts` | Tách từ cho view `seg` (mục 10.4) |
| `index.ts` | `createPack(options): LanguagePackV1`, export mặc định đọc `OHS_LANGUAGE_PACK_OPTIONS` |

#### Bảng dữ liệu cần soạn (kèm test bảng)
- Bảng nguyên âm và dấu: 12 nguyên âm cơ bản × 6 thanh, dạng NFC và NFD.
- Bảng đặt dấu cho vần `oa, oe, uy, uê, ươ, iê, yê, uô` và các ngoại lệ `qu`, `gi`; ít nhất 60 cặp kiểm (hòa/hoà, hỏa/hoả, thủy/thuỷ, khỏe/khoẻ, quý, giá, giường, người, khuỷu, ngoằn…).
- Bảng Telex và VNI: mọi tổ hợp nguyên âm × dấu × thanh, kèm phản ví dụ chữ tiếng Anh không được đổi.
- Từ điển từ ghép cho `segment.ts` (nguồn và giấy phép chốt ở Q9).
- Bảng i/y: danh sách phụ âm đầu áp dụng (`k, l, m, t, s, h, v, d, ng, qu?` theo quy tắc chốt khi soạn), kèm phản ví dụ.

#### Tuỳ chọn
`{ tonePlacement: "modern" | "classic", foldIY: boolean, restore: boolean, restoreForEmbedding: boolean, telex: boolean, typo: boolean, lexiconPath: string, segment: boolean, viewWeights: {norm, fold, seg}, rescoreWeights: {...} }`. Mặc định chốt sau eval (L04 và V11); mọi tuỳ chọn có ảnh hưởng tới index đi vào `signature()`.

#### Test của gói (độc lập với OHS)
- Test bảng: mọi cặp trong bảng dữ liệu.
- Test thuộc tính (fast-check): `normalize(normalize(x)) = normalize(x)`; `fold(fold(x)) = fold(x)`; `fold(normalize(x)) = fold(x)`; NFC và NFD của cùng chữ cho cùng kết quả; chữ không phải tiếng Việt (ASCII, tiếng Anh) qua `normalize` chỉ đổi hoa thường; không làm mất ký tự không phải chữ (số, dấu câu, emoji).
- Test hiệu năng: `project` trên 1 MB văn bản dưới 200 ms; `analyzeQuery` câu 12 âm tiết với từ vựng 50.000 term dưới 20 ms.
- Test `telex`, `typo`, `lexicon` với `QueryContext` giả: "tieengs vieetj" ra "tiếng việt" khi từ vựng có; "team", "seen", "online" giữ nguyên; "khahc" ra "khách"; token có trong từ vựng không bị sửa; file lexicon đổi thì `queryCacheKey()` đổi; dòng ở mục chờ duyệt không được dùng.
- Test `learn-abbr` trên vault mẫu: tìm đúng các mẫu định nghĩa, không đề xuất trùng, không ghi đè mục chính.
- Test bất biến token (mục 10.2) cho mọi view, kể cả `seg`, bằng fast-check.
- Test `restore` với `QueryContext` giả (từ vựng nhỏ cố định): "ban hang online" → "bán hàng online" đứng đầu khi từ vựng có "bán hàng"; "ban" một mình trả nhiều biến thể theo tần suất.

### 10.4. Tách từ (bắt buộc, V20; trước đây N05)
Mục đích: "khách hàng" không kéo "hàng hoá" lên đầu. Thêm view `seg` (view thứ ba, đúng giới hạn 3 view): `project` nối các âm tiết của một từ ghép bằng `_` ("khách_hàng"), giữ bất biến token (mục 10.2). Cách tách: khớp dài nhất theo từ điển từ ghép đóng gói sẵn (Q9), cộng danh sách từ ghép trong file lexicon của user. `project` là hàm thuần nên không dùng thống kê vault lúc index; thống kê cặp âm tiết của vault chỉ dùng lúc tìm (`phraseDocs`) để tách câu tìm. `analyzeQuery` tách câu theo cùng từ điển và đặt `viewQueries.seg`. Bật bằng tuỳ chọn `segment` (mặc định bật nếu eval `vi-compound` tốt lên mà các hạng mục khác không tụt). Đổi từ điển thì đổi `signature()`. Từ ghép trong file lexicon cũng ảnh hưởng tới index nên băm riêng phần từ ghép đó đi vào `signature()` (gói đọc file lúc nạp; đổi thì chỉ dựng lại FTS, không nhúng lại); đồng nghĩa và viết tắt chỉ đi vào `queryCacheKey()`.

### 10.5. Thứ tự làm gói tiếng Việt
1. M1 `normalize`, `fold`, `syllable`, bảng dữ liệu, test (V09).
2. Corpus và golden set tiếng Việt (V10), chạy baseline upstream (không gói).
3. M2 view `norm`, `fold` trong OHS qua P01; eval; chốt trọng số view.
4. M3 `restore`, `rescore`; eval; chốt tham số (V11).
5. M4 `restoreForEmbedding` và thử model khác (L04).
6. M5 (bắt buộc, G8): Telex/VNI gõ dở và gõ sai (V17); đồng nghĩa, viết tắt, `learn-abbr` (V18); alias, tiêu đề không dấu và đoạn trích chữ gốc (V19); tách từ (V20). Mỗi bước có hạng mục eval riêng và chốt tham số bằng eval.

---

## 11. Kiểm thử

### 11.1. Các tầng
| Tầng | Chạy ở | Khi nào hỏng thì |
|---|---|---|
| T1 Test của upstream (`npm test`; `verify:ci` đầy đủ trong `vantt-bundles` trên từng nền) | catchup, bundles | Bản vá phá vỡ upstream: sửa bản vá |
| T2 Test riêng của mỗi bản vá (`test/vantt/*.test.ts`, đi trong bản vá) | catchup | Sửa bản vá |
| T3 Test của `ohs-lang-vi` (độc lập) | pr-check, catchup | Sửa gói |
| T4 Bất biến "không gói = upstream" (mục 11.4) | catchup | Bản vá làm lệch hành vi khi không có gói: sửa P01 hoặc bản vá vi phạm |
| T5 Cổng chất lượng (mục 11.6) | catchup | Xem báo cáo eval, quyết sửa hay hạ baseline (cần người duyệt) |
| T6 Smoke gói dựng sẵn mỗi nền (mục 8.4) | bundles | Sửa bundle.mjs hoặc bản vá |
| T7 Probe (mục 9.2) | review-upstream | Không phải lỗi: là thông tin để quyết giữ hay bỏ bản vá |
| T8 Diễn tập xung đột: bản vá giả cố ý xung đột, chạy catchup, kiểm mã thoát 3, state, `--abort` trả lại sạch, `--continue` sau khi sửa thì xanh và bản vá được xuất lại | test của `catchup.mjs` (vitest trên repo git tạm) | Sửa catchup |

### 11.2. Test của script fork
`vantt/scripts/*.mjs` có test (vitest) chạy trên repo git tạm dựng từ đầu (không cần mạng): chọn tag, bỏ qua tag pre-release, áp bản vá, bỏ bản vá đã có trong upstream, xung đột và `--continue`/`--abort`, xuất lại bản vá, đặt phiên bản `-vantt.N`, đọc `series.toml` (kể cả lỗi cú pháp).

### 11.3. Fixture
- `vantt/eval/vi/smoke-vault/`: 10 note, viết tay, có đủ trường hợp (mục 11.5).
- Corpus tiếng Việt lớn sinh từ [vantt/obsidian-test-fixture](https://github.com/vantt/obsidian-test-fixture) (đã có note tiếng Việt, tên NFC, CRLF; dự án dùng nó cho mọi bài kiểm graph): thêm preset `vi-search` (việc phía repo fixture, V10).

### 11.4. Bài kiểm bất biến (`vantt/scripts/invariance.mjs`)
- Dựng hai bản: upstream nguyên gốc ở tag đích (`git worktree` tại tag) và nhánh phát hành của fork, cả hai **không** cấu hình gói ngôn ngữ, không đặt biến của các bản vá.
- Chạy eval của upstream (`obsidian-help`, có thêm `evergreen-notes`) với cùng model, cùng máy, `--k 10`, không rerank.
- So từng câu: `top_paths` phải trùng thứ tự; điểm lệch tối đa 1e-6. Lệch bất kỳ thì hỏng.
- Ghi chú: bản vá thêm cột hoặc bảng luôn có (P05) thì vẫn phải giữ kết quả tìm y hệt; schema được phép khác.

### 11.5. Bộ eval tiếng Việt
- **Định dạng:** golden set của upstream (`{id, query, relevant_paths, partial_paths, category, notes}`), để chạy bằng `npm run eval` sẵn có.
- **Hạng mục** (`category`), mỗi hạng tối thiểu 15 câu ở bản đầu, 40 câu khi đủ:
  | category | Ví dụ |
  |---|---|
  | `vi-accented` | "giữ chân khách hàng" |
  | `vi-unaccented` | "giu chan khach hang" |
  | `vi-partial-accent` | "giữ chan khach" |
  | `vi-tone-placement` | tìm "hòa giải" ra note viết "hoà giải" |
  | `vi-iy` | "kĩ thuật" ra "kỹ thuật" |
  | `vi-dd` | "duong" ra "đường" |
  | `vi-tone-precision` | "bán hàng" không được để "bàn" đứng trên |
  | `vi-compound` | "khách hàng" không kéo "hàng hoá" lên đầu |
  | `vi-mixed-en` | "kế hoạch marketing", "plan tiếp thị" |
  | `vi-semantic` | hỏi theo ý, không trùng chữ |
  | `vi-names` | tên người, địa danh có dấu và không dấu |
  | `vi-telex` | "tieengs vieetj", "ke61 hoa5ch" |
  | `vi-typo` | "khahc hang", "kees hoach" |
  | `vi-synonym` | "customer" ra note viết "khách hàng" (theo file lexicon của corpus) |
  | `vi-abbr` | "KH tiềm năng" ra "khách hàng tiềm năng" |
  | `vi-alias` | "ke hoach" ra note có alias "Kế hoạch" ở đầu |
  | `vi-snippet` | đoạn trích là chữ gốc có dấu, chứa chỗ khớp; `matchedTerms` đúng |
- **Nguồn:**
  1. Corpus sinh (preset `vi-search` của obsidian-test-fixture): xác định, có đáp án sinh cùng corpus, commit được, chạy trong CI.
  2. Vault thật của user (bản B): golden set do user gán nhãn (khoảng 60 câu, 2 giờ của user), **lưu ngoài repo**, chạy ở máy user bằng `vantt/scripts/quality-gate.mjs --private <đường dẫn>`; chỉ ghi số tổng hợp vào `vantt/reviews/`.
- **Baseline:** chạy upstream không gói trên cả hai nguồn để có số gốc trước khi viết gói.

### 11.6. Cổng chất lượng (`vantt/scripts/quality-gate.mjs`)
| Kiểm | Điều kiện đạt |
|---|---|
| Eval upstream, không gói | Đạt ngưỡng của `eval/quality.ts` (chỉ trên macOS ARM như upstream); trên Linux so với baseline Linux đã chốt, lệch nDCG@5 không quá 0,005 |
| Eval upstream, có gói `vi` | Không tụt quá 0,01 nDCG@5 so với không gói (gói không được làm hỏng tìm tiếng Anh) |
| Eval `vi`, có gói | Mỗi hạng mục không tụt so với baseline bản phát hành trước quá 0,02 nDCG@5; tổng thể không tụt |
| Mục tiêu G8 | `vi-telex`, `vi-typo`, `vi-synonym`, `vi-abbr`, `vi-alias`: Hit@5 ≥ 0,8; `vi-compound`: nDCG@5 hơn baseline upstream tối thiểu 0,1; `vi-snippet`: 100% đoạn trích là chữ gốc và chứa chỗ khớp; các hạng mục khác không tụt quá 0,01 nDCG@5 khi bật từng tính năng |
| Mục tiêu phát hành gói lần đầu (G3) | `vi-unaccented`, `vi-dd`: Hit@5 ≥ 0,85 và gấp tối thiểu 2 lần baseline upstream; `vi-accented`: không tụt so với upstream; `vi-tone-precision`: MRR ≥ 0,9 |

Baseline lưu trong `vantt/eval/baselines/<platform>/<version>.json`. Hạ baseline chỉ qua PR có người duyệt, kèm lý do.

---

## 12. Kiểm bản upstream mới bằng LLM (việc V13)

### 12.1. Mục đích
Mỗi lần upstream phát hành, người cần biết trong 15 phút: (1) bản vá nào upstream đã tự giải (bỏ được), (2) bản vá nào cần viết lại, (3) chất lượng tìm của upstream mới so với bản fork trước và so với bản fork mới, (4) có thay đổi nào của upstream đụng tới giả định của gói ngôn ngữ không.

### 12.2. Công cụ
- Skill `.claude/skills/ohs-upstream-review/SKILL.md` (đã có trên `master`): hướng dẫn agent làm từng bước, kể cả khi script chưa có (lệnh tay tương đương).
- Script `vantt/scripts/review-upstream.mjs --tag <mới> [--prev <tag fork trước>] [--private <golden set riêng>]` làm phần máy: dựng worktree, build, chạy probe, chạy eval ba phía, xuất `vantt/reviews/<tag>.data.json`.
- Agent (LLM) đọc dữ liệu, changelog, diff, viết `vantt/reviews/<tag>.md`. Người đọc báo cáo và quyết; agent không tự sửa `series.toml`.

### 12.3. Quy trình (chi tiết trong skill)
1. **Ba phía:** `upstream@<tag mới>` nguyên gốc; `fork@<tag mới>` (nhánh catchup, nếu xanh); `fork@<bản trước>` (release fork gần nhất).
2. **Đọc thay đổi:** `git log --oneline <tag cũ>..<tag mới>`, CHANGELOG, release notes; lọc commit chạm `touches` của từng bản vá và chạm `searcher.ts`, `db.ts`, `chunker.ts`, `embedder.ts`.
3. **Probe:** chạy mọi probe trên `upstream@<tag mới>`. Probe trả 0 → upstream đã giải vấn đề → đề xuất "bỏ bản vá" (kèm bằng chứng). Trả 1 → còn cần. Trả 2 → ghi lỗi môi trường.
4. **Eval ba phía:** eval upstream (obsidian-help), eval `vi` sinh, và eval riêng nếu có `--private`. Bảng chỉ số theo hạng mục, chênh lệch.
5. **So sánh định tính bằng LLM (mù):** chọn 20 câu tiếng Việt (ưu tiên câu có chênh lệch lớn nhất), lấy top 5 của hai phía cần so, xáo thứ tự A/B, agent chấm theo thang (mục 12.4) mà không biết phía nào là fork; ghi tỉ lệ thắng. Đây là tín hiệu phụ; chỉ số eval là tín hiệu chính.
6. **Báo cáo** `vantt/reviews/<tag>.md` theo mẫu (mục 12.5). Mở issue `[review] <tag>` gắn link báo cáo.
7. **Người quyết:** giữ, bỏ, viết lại từng bản vá; đổi `upstream_status`; chấp nhận hay không bản fork mới cho khách.

### 12.4. Thang chấm định tính
Cho mỗi câu: "Danh sách nào giúp người tìm thấy note họ cần nhanh hơn?" A tốt hơn rõ / A hơi tốt hơn / ngang / B hơi tốt hơn / B tốt hơn rõ. Kèm một câu lý do. Agent được đọc tiêu đề và snippet của kết quả, không đọc mã. Với vault thật, không chép snippet vào báo cáo; chỉ ghi kết quả chấm.

### 12.5. Mẫu báo cáo
```markdown
# Upstream <tag mới> (so với fork <bản trước>)
## Tóm tắt (3 dòng: nên nâng không, bản vá bỏ được, rủi ro)
## Thay đổi của upstream liên quan tới fork
## Bản vá
| id | Probe trên upstream | Áp được không | Đề xuất | Bằng chứng |
## Chất lượng tìm
| Bộ eval | Hạng mục | upstream mới | fork trước | fork mới | Chênh |
## So sánh định tính (mù)
| Cặp so | Thắng | Hoà | Thua | Ghi chú |
## Việc cần người quyết
```

---

## 13. Điện thoại

### 13.1. Cách làm (user chốt 2026-11-02)
Không đồng bộ vault, index hay model vào điện thoại. Máy tính đang giữ vault và Obsidian chạy một web server nhỏ; điện thoại mở trang xem bằng trình duyệt.

```
Điện thoại (trình duyệt)
   │ HTTPS hoặc HTTP trong Tailscale, token
   ▼
pkm-web (máy giữ vault; thuộc repo dự án, không thuộc fork)
   ├── kg / pkm (graph có loại, trang nguyên liệu, hàng chờ đề xuất)
   ├── đọc note, render Markdown
   └── OHS qua stdio IPC (P04): một tiến trình `ohs serve --stdio` sống lâu, model nạp một lần
```

### 13.2. Phần thuộc fork OHS
- P04 `stdio-parity` là toàn bộ thứ fork cần cho điện thoại: `search` đủ tuỳ chọn, `similar`, `read`, `neighbors`, request đồng thời có `id`.
- **Không** mở HTTP của OHS ra mạng. `ohs serve --http` giữ nguyên mặc định 127.0.0.1. Một điểm xác thực duy nhất là `pkm-web`.
- P06 (giới hạn tập note) giúp "tìm trong vùng" từ điện thoại; để sau.

### 13.3. Đặc tả tối thiểu của `pkm-web` (để nhóm dự án làm; ghi ở đây để đủ bối cảnh)
- **Mạng:** mặc định tắt. Bật trong plugin của dự án. Chỉ nghe địa chỉ Tailscale (100.x) hoặc LAN do user chọn; không nghe 0.0.0.0 trừ khi user bật rõ; không có đường ra Internet công khai.
- **Xác thực:** token ngẫu nhiên 256 bit, ghép điện thoại bằng mã QR hiện trong Obsidian (QR chứa URL + token); lưu ở cookie `HttpOnly`, `SameSite=Strict`; giới hạn 10 lần sai mỗi phút; nút "thu hồi mọi thiết bị".
- **Trang xem (MVP):** ô tìm (gọi OHS qua `pkm-web`), danh sách kết quả với snippet; đọc note (Markdown render phía server, ảnh đính kèm, link nội bộ bấm được); "note liên quan" (`related` của `kg`); trang nguyên liệu của một bài nháp; hàng chờ đề xuất (nhận, bỏ kèm lý do); ghi nhanh một ý vào inbox. HTML + JS tĩnh, không framework nặng, dùng tốt ở màn hình 360 px, chế độ tối.
- **Ghi:** chỉ các thao tác trên. Ghi nguyên tử (file tạm rồi đổi tên), kiểm mtime trước khi ghi (đổi từ lúc đọc thì từ chối, yêu cầu tải lại). Obsidian tự nạp lại file đổi từ ngoài.
- **Không làm:** sửa thân note tự do, chạy index trên điện thoại, truy cập công khai, nhiều người dùng.
- **Công:** 5–8 ngày (đã ghi trong kế hoạch E12.7 của dự án).

---

## 14. Lộ trình

Một "ngày" là một phiên làm việc cả ngày của agent có người duyệt. Cột "Cần" là việc phải xong trước.

### 14.1. Làm ngay (nhãn: Bắt buộc)
| ID | Việc | Cần | Công | Xong khi |
|---|---|---|---|---|
| V00 | Cài đặt fork (mục 5): remote, `.gitignore`, `vantt/README.md`, tắt workflow upstream, bật workflow `vantt-*` | — | 0,5 | `gh workflow list` chỉ có `vantt-*` bật |
| V01 | `catchup.mjs` + test (mục 6, 11.2, T8) + skill `ohs-catchup` | V00 | 2 | Chạy trên `v0.17.2` ra nhánh `vantt/v0.17.2` xanh với chuỗi rỗng và với bản vá giả; diễn tập xung đột qua |
| V02 | `vantt-catchup.yml`, `vantt-pr-check.yml` (mục 7.2, 7.4) | V01 | 0,5 | Chạy tay xanh; một lần hỏng cố ý mở đúng một issue |
| V03 | `bundle.mjs` + `vantt-bundles.yml` + smoke (mục 8) | V02 | 2 | Release có 4 gói + sha256; smoke xanh cả 4 nền; ghi kích thước |
| V04 | P00 `fork-identity` | V01 | 0,3 | Test xanh |
| V05 | P09 `unicode-inline-tags` | V01 | 0,3 | Test xanh, probe trả 1 trên upstream, 0 trên fork |
| V06 | P02 `db-path` | V01 | 1 | Test và probe |
| V07 | P03 `vector-export` | V01 | 1 | Test và probe |
| V08 | P04 `stdio-parity` | V07 | 1 | Test parity mở rộng xanh |
| V09 | `ohs-lang-vi` M1: `normalize`, `fold`, `syllable`, bảng dữ liệu, test bảng và thuộc tính | — (song song) | 2,5 | Test của gói xanh, hiệu năng đạt |
| V10 | Bộ eval tiếng Việt: preset `vi-search` trong obsidian-test-fixture (kèm file lexicon mẫu), golden set, smoke-vault, baseline upstream | — (song song) | 2,5 | Golden set đủ 17 hạng mục × 15 câu; baseline ghi trong `vantt/eval/baselines/` |
| V11 | P01 `language-pack-api` (mục 10.2, gồm `aliasViews`, `queryCacheKey`, đoạn trích theo bất biến token) + test bằng gói giả | V01 | 4 | Toàn bộ test của P01 xanh; bất biến (V12) xanh |
| V12 | `invariance.mjs`, `quality-gate.mjs`, nối vào catchup | V10, V11 | 1 | Catchup chạy đủ T1–T5 |
| V13 | `ohs-lang-vi` M2+M3: view `norm`/`fold`, `analyzeQuery`, `restore`, `rescore`; chốt tham số bằng eval | V09, V10, V11 | 3,5 | Đạt mục tiêu G3 (mục 11.6) trên corpus sinh |
| V14 | `review-upstream.mjs` + probe cho mọi bản vá + hoàn thiện skill `ohs-upstream-review` | V06–V08, V12 | 2 | Chạy trên cặp `v0.17.1` → `v0.17.2` ra báo cáo đủ mục |
| V15 | Eval trên vault thật của user (golden set riêng 60 câu) | V13; user 2 giờ gán nhãn | 0,5 + user | Số tổng hợp trong `vantt/reviews/` |
| V16 | Phía dự án: `note_knn.mjs`, `similar_pairs.mjs`, `related.py`, `material.py` dùng P03, P04; bộ cài trỏ gói dựng sẵn; `material` gửi mọi câu tìm trong một lệnh `queries[]` qua stdio IPC, bỏ 8 tiến trình (trước đây N10) | V07, V08, V03 | 1,3 | Không còn đọc bảng nội bộ của OHS |
| V17 | `ohs-lang-vi` M5a: `telex.ts`, `typo.ts` (G8) | V13 | 2,5 | `vi-telex`, `vi-typo` đạt mục 11.6; hạng mục khác không tụt |
| V18 | `ohs-lang-vi` M5b: `lexicon.ts`, `abbr.ts`, lệnh `learn-abbr` (G8) | V13 | 2,5 | `vi-synonym`, `vi-abbr` đạt; đổi đồng nghĩa hay viết tắt trong file lexicon không dựng lại index |
| V19 | `ohs-lang-vi` M5c: `aliasViews` cho `fold`, `matchedTerms`, kiểm đoạn trích (G8) | V13 | 1 | `vi-alias`, `vi-snippet` đạt |
| V20 | `ohs-lang-vi` M5d: `segment.ts`, view `seg`, từ điển (G8, mục 10.4) | V13, Q9 | 4 | `vi-compound` đạt; chốt mặc định `segment` |
| V21 | Gói ngôn ngữ thứ hai `ohs-lang-<x>` trong `vantt/packages/` (G9): ít nhất một view, `analyzeQuery`, test riêng, golden set nhỏ; mọi chỗ phải sửa lõi để gói chạy được là lỗi của P01 và sửa trong P01 | V11, Q10 | 2 | Gói chạy qua hợp đồng P01 không sửa lõi; bất biến xanh; eval của ngôn ngữ đó không tụt so với không gói |
| V22 | Eval reranker đa ngữ trên bộ `vi` (G10): mọi hạng mục, có và không rerank, thời gian mỗi câu trên máy CPU thường | V13 | 0,5 | Báo cáo trong `vantt/reviews/`, kèm đề xuất bật hay tắt mặc định trong bộ cài dự án |
| | **Cộng** | | **~39** | |

Song song được: V09, V10 không cần fork chạy; V04–V08 song song sau V01; V17–V20 song song sau V13 (cùng sửa `query.ts` của gói thì làm lần lượt phần đó).

### 14.2. Để sau
Nhãn: **Có thì tốt** (mục 2.2) hoặc **Đã chốt, làm sau**. Việc nhãn "ý mới" ở mục 2.2 cần user xác nhận trước khi bắt đầu. L05, L16–L21 đã chuyển thành V17–V20 (bắt buộc).

| ID | Nhãn | Việc | Làm khi | Công |
|---|---|---|---|---|
| L01 | Có thì tốt (N01) | P05 `block-anchors` (id block, đoạn tô, kích thước đoạn) | Khi làm lại trang nguyên liệu; theo dõi upstream issue #91 | 2 |
| L02 | Có thì tốt (N02) | P06 `restrict-paths` | Khi cần "tìm trong vùng" | 0,5–1 |
| L03 | Có thì tốt (N03) | P07 `index-events` | Khi dự án bỏ vòng đọc lại 5 s | 1 |
| L04 | Có thì tốt (N04) | Thử model và `restoreForEmbedding` | Sau V13 | 1–2 |
| L06 | Đã chốt, làm sau | `pkm-web` cho điện thoại (phía dự án, mục 13) | Sau khi desktop có người dùng | 5–8 |
| L07 | Có thì tốt (N06) | Gói "đầy đủ" có sẵn model | Khi khách cài ở nơi mạng kém | 0,5 |
| L08 | Đã chốt, làm sau | Gửi issue/PR lên upstream cho P02, P09, P03 (và bản vá khác có ích chung) | **Chỉ sau khi chúng ta đã làm xong bản vá**, nó đã qua ít nhất một bản phát hành của fork và một lần catchup xanh (user chốt 2026-11-02). Gửi kèm test và mô tả từ spec; đổi `upstream_status` | 0,5 mỗi cái |
| L09 | Có thì tốt (N07) | Phát hành `ohs-lang-vi` công khai, README cho cộng đồng OHS | Gói ổn định qua 3 bản upstream | 0,5 |
| L13 | Có thì tốt (N11) | Gợi ý khi đang viết trong plugin dự án | Sau V08 | 2–3 |
| L14 | Có thì tốt (N12) | OCR ảnh và PDF | Khi thành phàn nàn thật | 5+ (dự án riêng) |
| L15 | Có thì tốt (N13) | Viết lại phần tìm bằng Rust | Khi điều kiện ở N13 xảy ra | 10–14 |
| L22 | Có thì tốt (N20), ý mới | Sổ câu tìm cục bộ, tắt mặc định, không rời máy | Sau V15 | 1 |
| L23 | Có thì tốt (N21), ý mới | LLM đề xuất câu hỏi và đáp án ứng viên cho golden set riêng | Cùng V15 | 0,5 |
| L24 | Có thì tốt (N22), ý mới | Biểu đồ chỉ số qua các bản trong báo cáo review | Sau V14 | 0,5 |
| L25 | Có thì tốt (N23), ý mới | Gói Windows ARM64 | Khi có khách dùng | 0,5 |
| L26 | Có thì tốt (N24), ý mới | Nâng cấp tại chỗ và quay lui (phía bộ cài dự án) | Khi phát hành bản thứ hai cho khách | 1 |

---

## 15. Quyết định còn mở
| # | Câu hỏi | Đề xuất | Ai quyết |
|---|---|---|---|
| Q1 | Kiểu đặt dấu chuẩn để so khớp (`modern` hoà/thuỷ hay `classic` hòa/thủy) | Không quan trọng cho tìm (cả hai được gộp về một); chọn `modern` | Agent, ghi trong spec gói |
| Q2 | Bật `foldIY` mặc định không | Bật, nếu eval `vi-iy` tốt lên mà `vi-tone-precision` không tụt | Theo eval |
| Q3 | `restoreForEmbedding` mặc định | Theo eval L04 | Theo eval |
| Q4 | Ký lại `.node` trên macOS bằng Developer ID | Chỉ khi Gatekeeper chặn trong smoke test; cần tài khoản Apple Developer (99 USD/năm) | User |
| Q5 | Gói tiếng Việt để trong fork hay tách repo riêng | Trong fork (`vantt/packages/`) cho tới L09 | User |
| Q6 | ~~Có gửi issue lên upstream không, khi nào~~ | **Đã chốt (user 2026-11-02):** gửi sau khi đã làm xong và chạy ổn trong fork (L08); không gửi trước | — |
| Q7 | Người gán nhãn golden set riêng trên vault thật | User, khoảng 2 giờ | User |
| Q8 | Định dạng file lexicon (đồng nghĩa, viết tắt, từ ghép) | Markdown trong vault, mặc định `_ohs/lexicon.md`, mỗi dòng một nhóm nối bằng ` = `; mục `## Chờ duyệt` cho đề xuất của `learn-abbr` | Agent, ghi trong spec gói |
| Q9 | Nguồn từ điển từ ghép cho tách từ | Chọn danh sách từ có giấy phép cho phép đóng gói lại (MIT, Apache, CC-BY, CC0); ghi nguồn và giấy phép trong gói; không dùng nguồn không rõ giấy phép | Agent đề xuất, user duyệt |
| Q10 | Ngôn ngữ của gói thứ hai (V21) | Tiếng Đức: bỏ umlaut (`ä→a`, `ae`), `ß→ss`, từ ghép dài; nhỏ, khác tiếng Việt đủ để thử hợp đồng | User |

## 16. Rủi ro
| Rủi ro | Khả năng | Ảnh hưởng | Giảm thiểu |
|---|---|---|---|
| Upstream đổi mạnh `searcher.ts`, `db.ts` (file lớn, thay đổi thường xuyên) làm P01 xung đột liên tục | Cao | Mỗi lần nửa ngày | P01 chạm ít chỗ, đặt logic trong `src/language/`; spec có điểm chạm rõ; xuất lại bản vá sau mỗi lần sửa |
| Upstream tự thêm cơ chế ngôn ngữ khác hợp đồng của mình | Thấp | Phải viết lại P01 | Probe và review phát hiện; nếu cơ chế upstream đủ thì chuyển gói sang cơ chế đó |
| ONNX lượng tử cho số khác nhau theo CPU, eval không ổn định giữa nền | Cao | Cổng chất lượng báo sai | Baseline theo từng nền; bất biến so cùng máy, cùng lần chạy |
| Gói dựng sẵn quá nặng | Trung bình | Khách bỏ cài | Thu gọn (mục 8.2); đo trong mỗi release |
| Gatekeeper, SmartScreen chặn | Trung bình | Không chạy được trên máy khách | Smoke test trên runner sạch; ký bộ cài của dự án; Q4 |
| Phục hồi dấu đoán sai làm kết quả tệ hơn khi gõ không dấu | Trung bình | Tìm kém | `rescore` không bỏ ứng viên; nhánh `fold` luôn chạy; chốt bằng eval có hạng mục riêng |
| Một người duy trì upstream ngừng phát triển | Thấp | Fork thành bản chính | Fork đã độc lập; khi đó đánh giá lại phương án viết lại bằng Rust (kế hoạch E12.7 của dự án) |

---

## Phụ lục A. Lệnh hay dùng
```bash
# catchup lên tag mới nhất, có kiểm tiếng Việt
node vantt/scripts/catchup.mjs --with-lang vi
# thử trên master của upstream
node vantt/scripts/catchup.mjs --ref upstream/master --skip-quality
# sau khi sửa xung đột
git add <file> && node vantt/scripts/catchup.mjs --continue
# kiểm bản upstream mới (máy làm phần dữ liệu, agent viết báo cáo theo skill)
node vantt/scripts/review-upstream.mjs --tag v0.17.3 --prev v0.17.2-vantt.1
# chạy OHS với gói tiếng Việt
OHS_LANGUAGE_PACK=$PWD/vantt/packages/ohs-lang-vi/dist OBSIDIAN_VAULT_PATH=/path/vault node dist/src/cli.js search "giu chan khach" --explain
```

## Phụ lục B. Nháp issue gửi upstream (chưa gửi; gửi sau khi đã làm xong bản vá, L08)

Khi gửi: cập nhật nháp theo bản vá đã làm (đường dẫn, tên biến thật), kèm link nhánh có test.

**B1. Inline tags drop Vietnamese letters (and other scripts outside Latin-1/Extended-A/B)**
> `src/content/note-extractor.ts` matches inline tag characters with the range `À-ɏ`. Letters such as ạ, ế, ộ, ữ (U+1EA0–U+1EF9, Latin Extended Additional), Cyrillic, Greek and CJK fall outside it, so `#kếhoạch` is indexed as `#k` (or not at all). Repro: a note containing `#kếhoạch`, then `ohs search --tag kếhoạch` returns nothing. Suggestion: use Unicode property classes (`\p{L}\p{N}` with the `u` flag) for tag characters, keeping the current rules for the first character and for `/ - _`. Happy to send a PR with tests.

**B2. Allow the index database outside the vault**
> The index is always created at `<vault>/.obsidian-hybrid-search.db` (`config.dbPath`); `--db` only helps discovery. Users who sync the vault with OneDrive, Dropbox or Obsidian Sync also sync the index and its `-wal`/`-shm` files (hundreds of MB, and two machines writing the same SQLite file can corrupt it). Proposal: an `OBSIDIAN_DB_PATH` variable (absolute path), honoured by every transport and passed to the daemon, with the existing `settings.vault_path` check so a database is never used for another vault (#45). `status` would show `db_path`. Happy to send a PR.

## Phụ lục C. Tài liệu liên quan
- herdr: `vantt/README.md`, `vantt/patches/0001-agent-start-executable-spec.md`, `vantt/scripts/catchup.py`, `.github/workflows/fork-catchup-release.yml`, `.agents/skills/herdr-catchup/SKILL.md` trong [vantt/herdr](https://github.com/vantt/herdr).
- Upstream: `ARCHITECTURE.md`, `CONTRIBUTING.md`, `eval/README.md`, issue #91 (kích thước đoạn), #45 (dò nhầm DB của vault khác).
- Dự án: kế hoạch `docs/plans/E12.7-port-rust-js.md` (mục 4.1 điện thoại, mục 5 OHS), so sánh OHS và QMD trong `docs/semantic-search-comparison/` của repo `obsidian-pkm-automation`.
