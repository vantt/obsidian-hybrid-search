# Bản vá language-pack-api: feat(language): add a language-pack extension point

- Consumer: gói `ohs-lang-vi` (PRD 10.3), gói `ohs-lang-de` (V21), mọi gói ngôn ngữ sau này
- Trạng thái upstream: unsubmitted
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Đây chính là điểm cắm mà mọi pack dùng. Nó đổi schema (bảng view theo gói) và đổi cách chọn ứng viên (thêm một nhánh RRF cho mỗi view). Pack không tự làm được việc này. Có ít nhất hai cách dùng thật: gói `vi` và gói `de`.

## 1. Vấn đề

Lõi OHS không cho cắm cách khớp riêng của từng ngôn ngữ. FTS5 `unicode61` không gộp được dạng chữ mà người dùng coi là một:

- Tiếng Việt: `giu chan khach` không ra "giữ chân khách" (dấu chồng), `duong` không ra "đường" (PRD 3.5).
- Tiếng Đức: `grosse strasse` không ra "Große Straße" (`ß` không bao giờ thành `ss`); từ ghép dài không tìm được theo từng phần.

Tái hiện trên upstream v0.17.2: vault có note "Die Große Straße am Ende der Stadt.", `ohs reindex`, rồi `ohs search "grosse strasse" --mode fulltext --json` trả `[]`. Không có biến môi trường, tuỳ chọn hay điểm cắm nào sửa được. Probe `vantt/probes/language-pack-api.mjs` tự động làm đúng việc này.

## 2. Yêu cầu

1. `OHS_LANGUAGE_PACK` (tên module hoặc đường dẫn tuyệt đối tới thư mục hay file của gói) và `OHS_LANGUAGE_PACK_OPTIONS` (JSON) cấu hình một gói. Nạp bằng `import()` với chuỗi tính lúc chạy. Gói không nằm trong `package.json` của OHS.
2. Hợp đồng `LanguagePackV1` ở `src/language/types.ts`: `apiVersion: 1`, `id`, `version`, `signature()`, `views` (1 đến 3 view, mỗi view có `name`, `weight`, `tokenizer`), `project(view, field, text)`, `analyzeQuery(query, ctx)`, `aliasViews?`, `queryCacheKey?()`, `rescore?()`. `QueryContext` có `termStats`, `termsWithPrefix`, `phraseDocs`, `noteCount`, `dbVersion`, `vaultPath`. Export của module là object gói, hoặc hàm `(options) => gói`, đặt ở `default` hoặc `createPack`.
3. Index: mỗi view `v` có bảng `notes_lex_<v>`, bảng FTS5 external content `notes_fts_lex_<v>` với tokenizer của view, trigger giữ đồng bộ, và bảng `notes_fts_lex_<v>_vocab` (fts5vocab `row`). Mỗi alias view có `notes_alias_lex_<v>(note_id, key)` với index trên `key`. `settings.language_pack` lưu bố cục `{id, version, signature, views[{name, tokenizer}], aliasViews}`.
4. Tìm: `analyzeQuery` chạy một lần cho mỗi câu. Nhánh BM25 gốc dùng `baseQuery`, nhánh vector dùng `embedQuery`. Mỗi `viewQueries[v]` khác null thành một nhánh BM25 trên `notes_fts_lex_<v>`, cùng giới hạn ứng viên và cùng `buildFilterPredicate`. RRF thêm các nhánh view với trọng số `views[].weight`. Khoá `aliasKeys[v]` tra trong `notes_alias_lex_<v>` và vào nhánh alias (trọng số 2.0), xếp sau khớp alias của upstream, không trùng path. `rescore` chạy sau RRF, trước rerank; với `queries[]` thì chạy một lần sau khi trộn, dùng phân tích của câu đầu. Chế độ `fulltext`: BM25 gốc cộng các nhánh view. Chế độ `title`: tìm thêm cột `title` của từng view. Chế độ `semantic`: chỉ `embedQuery`.
5. Đoạn trích từ nhánh view là chữ gốc: lấy `highlight()` của view, đổi token khớp về token gốc theo bất biến token, cắt từ `notes.content` cùng số token với nhánh BM25 upstream (`max(10, ceil(snippetLength/4))`), dùng cùng mốc và cùng `...`. Kết quả có `matchedTerms` (chữ gốc đã khớp) khi khớp qua view.
6. `explain` (CLI `--explain`, MCP `explain`, stdio `options.explain`): mỗi kết quả có `explain.ranks` (hạng 1-based trong từng nhánh, `null` khi trượt; với `queries[]` thì khoá có tiền tố số thứ tự câu) và `explain.debug` (`analysis.debug` của gói). Dùng được cả khi không có gói.
7. `status` (CLI, MCP, stdio) có `language_pack: {requested, loaded, id, version, signature, views}` hoặc `{requested, loaded: false, error}`. Không cấu hình gói thì không có trường này.
8. Đổi chữ ký gói, đổi bố cục view, thêm hoặc bỏ gói: chỉ dựng lại view từ bảng `notes` (đường riêng, một giao dịch), không quét vault, không gọi embedder.
9. Tăng `INDEX_SCHEMA_VERSION` từ `1` lên `2`.
10. Bổ sung hợp đồng (vẫn `apiVersion: 1`, chỉ thêm, gói cũ chạy y nguyên):
    - `QueryAnalysis.viewTerms?: Record<view, Array<string | {text, prefix?}> | null>`: câu truy vấn có cấu trúc cho từng view. Các term nối bằng `OR`. Chuỗi là khớp đúng (một token thì khớp đúng token, nhiều token thì khớp cụm từ); `{text, prefix: true}` là khớp tiền tố (`"text"*`). Mảng khác rỗng thay cho `viewQueries[v]`; `null`, mảng rỗng hay toàn term trống thì dùng lại `viewQueries[v]`. `viewQueries` giữ nghĩa cũ: mọi từ thành term tiền tố. Dấu `"` trong `text` được nhân đôi, không thoát khỏi chuỗi FTS.
    - `QueryAnalysis.viewWeights?: Record<view, number | null>`: trọng số RRF của view cho riêng câu này. Số hữu hạn `>= 0` thay `views[].weight`; `null`, thiếu hay giá trị hỏng giữ trọng số khai báo. Bỏ nhánh vẫn là `viewQueries[v] = null` (và không có `viewTerms[v]`).
    - `Candidate.matchedTerms: string[]` truyền cho `rescore`: chữ gốc đã khớp qua view, rỗng khi ứng viên không khớp view nào.
    - `signature(ctx?)` và `queryCacheKey(ctx?)` nhận `PackContext = { vaultPath }`. `QueryContext` mở rộng `PackContext`. Khoá cache của bộ nạp có thêm đường dẫn vault, nên đổi vault trong cùng tiến trình thì nạp lại gói và gọi lại `signature`.
    - `termsWithPrefix` có cận trên (`term <= prefix || U+10FFFF`), fts5vocab chỉ quét đoạn tiền tố thay vì tới hết bảng từ vựng. Kết quả không đổi.

## 3. Bất biến

1. Không cấu hình gói: không có bảng nào khớp `notes%lex%`. Danh sách nhánh RRF và trọng số là `[vector, bm25, alias, fuzzy]` / `[1.5, 1.5, 2.0, 0.25]`. Kết quả JSON của 17 câu tìm (mọi chế độ, bộ lọc, anchors, multi-query) trùng từng byte với snapshot sinh trên upstream v0.17.2 (`test/vantt/fixtures/language-pack-baseline.snapshot.json`).
2. Không cấu hình gói và không `explain`: kết quả không có trường `matchedTerms`, `explain`; `matchedBy` không có giá trị `view:*`; khoá cache tìm và `content_policy` giữ chữ của upstream.
3. Gói không nạp được (ném lỗi lúc nạp, `apiVersion` khác 1, JSON tuỳ chọn hỏng, hàm `project` ném lỗi lúc thử khi nạp hay khi dựng view, tokenizer hỏng): cảnh báo một lần, `status.language_pack.error` ghi lý do, bảng view bị xoá, tìm chạy như không có gói.
4. `analyzeQuery`, `rescore` hoặc `queryCacheKey` ném lỗi: chỉ câu đó chạy như không có gói, không lỗi ra ngoài.
5. `notes.content`, `read`, snippet luôn là chữ gốc. Chữ đã chiếu không bao giờ ra khỏi lõi.
6. Đổi, thêm, bỏ gói không gọi embedder và không đổi `vec_chunks`.
7. `storage/` không import `language/`, `search/`, `indexing/`. `language/` chỉ import `runtime/config.ts`. Kiểm bằng `dependency-cruiser.config.cjs` (luật `language-independent`, `storage-no-orchestration`) và `test/architecture-boundaries.test.ts`.
8. Bất biến token (gói phải giữ). Lõi tách chữ gốc bằng quy tắc của tokenizer view, bỏ `_` và `U+2060` khỏi `tokenchars`. Lõi tách chữ view bằng chính tokenizer của view. Hai bên phải cho cùng số token, trừ hai trường hợp. Token view có `_` (ghép từ) đếm bằng số phần khác rỗng. Token view bắt đầu bằng `U+2060` (`VIEW_CONTINUATION`, tách từ ghép) đếm là 0 và thuộc về token gốc đứng trước. Gói vi phạm: lõi lấy đoạn trích từ đầu note, cảnh báo một lần, không lỗi.
9. `rescore` không thêm và không bỏ ứng viên. Lõi bỏ qua path lạ và điểm không hữu hạn. Path thiếu giữ điểm cũ. Có điểm ngoài [0, 1] thì chuẩn hoá min-max cả tập. Thứ tự hoà điểm giữ thứ tự RRF.
10. Ghi note khi bố cục view trong DB khác bố cục của gói đang nạp thì ném lỗi "Language pack mismatch" và giữ index cũ, như lệch `content_policy`. Chỉ chủ index được phép đổi cấu hình (lúc khởi động service mới, `reindex`) mới chuyển trạng thái view.
11. Tìm chỉ dùng gói khi `settings.language_pack` trùng bố cục của gói đang nạp. Tiến trình chỉ tìm mà không cấu hình gói, đọc DB có bảng view, vẫn cho kết quả như upstream.

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/language/types.ts` (mới) | hợp đồng | `LanguagePackV1`, `QueryAnalysis` (`viewTerms`, `viewWeights`), `QueryContext`, `PackContext`, `ViewQueryTerm`, `Candidate`, hằng số |
| `src/language/loader.ts` (mới) | `loadLanguagePack`, `getLanguagePack`, `disableLanguagePack`, `languagePackStatus`, `requestKey` | nạp, kiểm hợp đồng, thử `project`, cache theo cấu hình và vault, trạng thái |
| `src/language/noop.ts` (mới) | `noopAnalysis` | phân tích rỗng khi gói lỗi |
| `src/language/tokens.ts` (mới) | `parseTokenizerRules`, `tokenize`, `mapHighlightedTokens`, `buildMarkedSnippet`, `matchedWords` | bất biến token, đoạn trích chữ gốc |
| `src/storage/language-tables.ts` (mới) | DDL, `writeNoteLexical`, `rebuildLanguageTables`, `dropLanguageTables` | bảng view; storage chỉ ghi chữ đã chiếu |
| `src/storage/language-queries.ts` (mới) | `replaceLanguageViews`, `readViewMatches`, `findViewAliasRows`, vocab (`readViewTermsWithPrefix` có cận trên) | đọc và ghi view qua `getDb` |
| `src/storage/db.ts` | `INDEX_SCHEMA_VERSION`, `PreparedIndexNote.lexical`, `upsertNote`, `replaceActiveIndex`, `bumpDbVersion` (export) | ghi view cùng giao dịch với note; reindex đầy đủ xoá view |
| `src/indexing/language-views.ts` (mới) | `lexicalForNote`, `syncLanguageViews`, `languageViewsOutOfDate` | tính view, dựng lại riêng view |
| `src/indexing/indexer.ts` | `indexFile` | đính `lexical` trước `commitIndexedNote` |
| `src/indexing/index-service.ts` | `openIndexDatabase`, `prepareContentOwner`, `reindex({force})`, `start` | nạp gói cho mọi giao tiếp; đồng bộ view |
| `src/search/language-search.ts` (mới) | phân tích câu, `viewQueriesFor` (`viewTerms`, `viewWeights`), nhánh view, alias view, `rescore`, khoá cache | phía tìm của gói |
| `src/search/searcher.ts` | `searchByQuery`, `search`, `cacheKey`, `rrfFusion`, `searchFuzzyTitle`, `searchBm25` (tách `enrichMarkedSnippets`), `searchLanguageViews`, `applyLanguageRescore`, `toSearchResult`, `SearchResult`, `SearchOptions` | nhánh RRF, `explain`, `matchedTerms` |
| `src/runtime/config.ts` | `languagePack`, `languagePackOptions` | biến môi trường |
| `src/contracts/boundary-validation.ts` | `explain` | MCP và stdio |
| `src/transports/cli.ts`, `mcp-runtime.ts`, `stdio-server.ts`, `status-payload.ts` | `--explain`, `explain`, `language_pack` | đưa tuỳ chọn qua mọi giao tiếp |
| `dependency-cruiser.config.cjs`, `test/architecture/check.ts`, `test/architecture-boundaries.test.ts`, `ARCHITECTURE.md`, `knip.json` | ranh giới | thư mục `language/` |
| `test/vantt/**` (mới) | test, gói giả `lang-upper`, snapshot | xem mục 5 |

## 5. Kiểm thử

- `test/vantt/language-pack-baseline.test.ts`: không gói thì không có bảng view; 17 câu tìm trùng snapshot sinh trên upstream v0.17.2 (cùng file test chạy trên worktree upstream sạch).
- `test/vantt/language-pack.test.ts` (gói giả `test/vantt/fixtures/lang-upper`, view `upper`):
  - Bảng view, FTS, vocab, alias được tạo. `status` đúng. `notes.content` giữ chữ gốc.
  - Nhánh `view:upper` vào RRF. `explain.ranks` có đủ năm nhánh. `explain.debug` có kết quả của `termStats`, `termsWithPrefix`, `phraseDocs`, `noteCount`, `dbVersion`, `vaultPath`.
  - Chế độ `title` khớp cột `title` của view.
  - Đoạn trích chữ gốc đúng vị trí, kể cả token ghép `_` ("grosse strasse" ra `["Große", "Straße"]`). Anchors dùng dòng gốc.
  - Gói vi phạm bất biến: đoạn trích rơi về đầu note, có cảnh báo.
  - `aliasViews`: "fussweg" khớp alias "Fußweg" ở nhánh alias, cả chế độ `title`.
  - `rescore`: tập ứng viên giữ nguyên, bỏ path lạ, bỏ NaN, path thiếu giữ điểm, điểm trong [0, 1]; có cả multi-query.
  - `queryCacheKey`: khoá giữ nguyên thì cache trả kết quả cũ; khoá đổi thì kết quả mới; không dựng lại index, embedder 0.
  - Đổi chữ ký: chỉ dựng lại view, embedder 0, `vec_chunks` giữ nguyên. Bỏ gói thì bảng view bị xoá, embedder 0.
  - Sửa hay xoá note từng file: view theo kịp, FTS view qua `integrity-check`. `reindex --force` dựng lại view.
  - Gói lỗi (`load`, `apiVersion: 2`, `project`, `project` lỗi khi dựng view, JSON tuỳ chọn hỏng, `analyzeQuery` lỗi): chạy như không gói, `status` báo lỗi, không có bảng view.
  - `explain` qua stdio và schema MCP.
  - Bổ sung hợp đồng (khối `contract additions`, gói giả đọc `__langUpperAnalysis`, ghi `__langUpperContexts`, `__langUpperCandidates`):
    - `viewTerms`: `GRAN` khớp đúng không ra "Grand", `{text: 'GRAN', prefix: true}` ra; `GRAND CANYON` khớp cụm, `CANYON GRAND` không; term nối `OR`, dấu `"` không phá câu FTS; mảng rỗng, `null`, term trống dùng lại `viewQueries` (tiền tố); chế độ `title` dùng được.
    - `viewWeights`: trọng số 4 tăng điểm, 0.1 giảm điểm so với trọng số khai báo; `null`, `-1`, `NaN`, view lạ giữ nguyên điểm.
    - `rescore` nhận `matchedTerms` chữ gốc (`Straße`), rỗng với ứng viên không khớp view.
    - `signature` và `queryCacheKey` nhận `{ vaultPath }` đúng vault.
    - `termsWithPrefix` chỉ trả term có tiền tố (cả chữ có dấu, tiền tố rỗng, tiền tố không có term).
- `test/vantt/language-pack-tokens.test.ts`: bộ tách JS cho đúng số token như FTS5 thật (đối chiếu `fts5vocab instance`) với ba tokenizer; ghép `_`; token tiếp nối `U+2060`; cắt cửa sổ đoạn trích; kiểm hợp đồng ở bộ nạp.
- Probe: `node vantt/probes/language-pack-api.mjs --ohs <bản đã build>`. Trả 1 trên upstream v0.17.2, 0 trên bản đã vá (đã chạy cả hai).
- `test_command`: `npx vitest run test/vantt/language-pack-baseline.test.ts test/vantt/language-pack.test.ts test/vantt/language-pack-tokens.test.ts test/architecture-boundaries.test.ts`.
- `capability_check`: probe ở trên (cần bản đã build).

## 6. Khi xung đột hoặc khi upstream đổi

Cách tìm lại điểm chạm:

- `searchByQuery`: tìm `rrfFusion(` có trọng số `[1.5, 1.5, 2.0, 0.25]`. Nhánh view nối vào cuối danh sách đó. `analyzeLanguageQuery` chạy trước các nhánh.
- `search`: tìm `options.queries && options.queries.length > 1` (multi-query) và `searchCache.set(key, final)` (gắn `explain`).
- `cacheKey`: chuỗi khoá có `anchorsStr`; nối `languageStr` vào cuối.
- `searchBm25`: khối "Enrich BM25 snippets with heading breadcrumb" đã tách thành `enrichMarkedSnippets`. Upstream sửa khối này thì sửa trong hàm tách ra.
- `searchFuzzyTitle`: tham số cuối `viewAliasMatches`, chèn sau `aliasExactPaths`.
- `upsertNote`: hai chỗ `insertChunks(db, noteId, note.chunks)`, ngay sau đó là `writeNoteLexical`.
- `replaceActiveIndex`: `dropLanguageTables(db)` trước các lệnh `DELETE FROM`.
- `prepareContentOwner`: `syncLanguageViewsForRun` sau khối `content-policy`. `start()`: điều kiện chuyển cấu hình có thêm `languageViewsOutOfDate()`.
- `indexFile`: `lexicalForNote` ngay trước `retryIndexWrite` có `commitIndexedNote`.
- `searchLanguageViews`: truyền `(q) => toFtsQuery(q, 'OR')` cho `viewQueriesFor`. Upstream đổi hay đổi tên `toFtsQuery` thì giữ nghĩa cũ cho `viewQueries` (mọi từ là term tiền tố nối `OR`); `viewTerms` tự dựng câu FTS trong `language-search.ts`.
- `INDEX_SCHEMA_VERSION`: upstream tăng hằng số này thì lấy số lớn hơn của hai bên, cộng 1 nếu cần, để DB cũ chạy lại migration.
- Upstream đổi tokenizer của `notes_fts_bm25` hoặc số token đoạn trích (`numTokens` trong `prepareBm25Rows`): sửa `windowSize` trong `language-search.ts` cho khớp.

Điều kiện bỏ bản vá: upstream có cơ chế cắm theo ngôn ngữ thoả bất biến 1, 3, 5, 6. Cụ thể là bảng hay chỉ mục phụ theo gói, nhánh xếp hạng phụ có trọng số, đoạn trích chữ gốc, và đổi gói không nhúng lại. Khi đó viết lại các gói trên cơ chế của upstream và bỏ P01. Probe trả 0 trên upstream là tín hiệu để xem xét.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

> **Title:** Language-pack extension point for language-specific lexical matching
>
> SQLite's `unicode61` tokenizer cannot fold many real-world spelling variants: German `ß`/`ss` and `ä`/`ae`, Vietnamese stacked diacritics and `đ`, typing without diacritics, compound words. Today there is no way to add this without forking the core.
>
> This PR adds an optional, versioned extension point. A separately installed ES module, named by `OHS_LANGUAGE_PACK`, declares up to three lexical *views*: pure projections of title, aliases and content. Each view is indexed in its own FTS5 table and searched as one extra RRF branch with its own weight. A pack can also rewrite the BM25 and embedding queries, add exact-alias keys, and re-score fused candidates. Snippets stay original text: matches in a view are mapped back through a token-alignment invariant. `explain` exposes per-branch ranks for evaluation.
>
> Without a pack nothing changes. No tables are created, the RRF branches and weights are identical, and a snapshot test proves byte-identical results. A broken pack is reported in `status` and ignored. Changing packs rebuilds only the view tables from stored notes, so no re-embedding happens.
