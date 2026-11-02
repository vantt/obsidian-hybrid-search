# Bản vá restrict-paths: feat(search): restrict search to a given set of note paths

- Consumer: dự án pkm ("tìm trong vùng": một tập note cho trước, ví dụ từ điện thoại); mọi người dùng OHS cần giới hạn tìm theo danh sách note
- Trạng thái upstream: unsubmitted
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Tính năng đổi cách chọn ứng viên: lọc phải vào SQL của từng nhánh trước khi cắt top-K. Pack không làm được mà không lọc sau top-K. Cơ chế nhỏ, chung (thêm một loại điều kiện vào `buildFilterPredicate`); việc chọn tập note nào là của phía dự án.

## 1. Vấn đề

Không có cách tìm trong một tập note cho trước. Lọc kết quả sau khi tìm làm mất kết quả: vault 60 note lặp "alpha" nhiều lần và 3 note chỉ nhắc một lần; `search alpha --limit 3` chỉ trả 3 trong 60 note mạnh, nên lọc 3 note kia từ kết quả trả về ra rỗng. Tái hiện trên upstream v0.17.2: `ohs search alpha --paths-file paths.txt` báo lỗi tuỳ chọn không biết; qua MCP/stdio, `paths` bị bỏ qua. Probe `vantt/probes/restrict-paths.mjs` làm đúng việc này.

## 2. Yêu cầu

1. `SearchOptions.paths?: string[]`: đường dẫn note (tương đối theo vault, chuẩn hoá bằng `normalizeNotePath`, bỏ trùng). Khớp chính xác, không theo tiền tố.
2. Thành một điều kiện của `buildFilterPredicate`: `n.path IN (SELECT value FROM json_each(?))` với một tham số JSON, nên tập lớn không chạm giới hạn biến ràng buộc của SQLite. Điều kiện kết hợp bằng AND với `tag`, `scope`, `frontmatter`.
3. Đẩy vào mọi nhánh dùng predicate: BM25, vector (`chunk_id IN (subquery)`, lọc trước k), title/trigram, alias chính xác, các nhánh view và alias view của P01, tìm note gần (`notePath`).
4. Chế độ liệt kê (không có truy vấn) và `related` cũng áp `paths` (chế độ `related` lọc bằng JS như tag/scope hiện có).
5. Giao tiếp: CLI `--paths-file <file>` (mỗi dòng một path, `-` đọc stdin, bỏ dòng trống); MCP `paths` (mảng chuỗi, có trong `inputSchema`); stdio `options.paths`; schema biên (`boundary-validation.ts`) nhận `paths: string[]`.
6. Khoá cache tìm có thêm tập path (đã chuẩn hoá, sắp xếp).

## 3. Bất biến

1. Không đặt `paths`: SQL, khoá cache và kết quả giống hệt upstream (không thêm clause, không thêm phần khoá).
2. Tìm giới hạn trong tập S trả cùng danh sách path, cùng thứ tự, như tìm trên vault chỉ có các note của S, ở mọi chế độ (`fulltext`, `title`, `semantic`, `hybrid`), có hoặc không có gói ngôn ngữ.
3. Không bao giờ lọc sau khi đã cắt top-K trong đường tìm văn bản; chỉ `related` và chế độ liệt kê (vốn đã lọc bằng JS ở upstream) lọc trong bộ nhớ.
4. `paths: []` (hoặc `--paths-file` rỗng) là tập rỗng thật: không trả note nào. Khác với tag/scope/frontmatter, nơi mảng rỗng nghĩa là không đặt. Path không có trong index bị bỏ qua.
5. Một tham số ràng buộc bất kể kích thước tập.

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/contracts/filter-predicate.ts` | `FilterOptions.paths`, `hasPathsFilter`, `normalizePathSet`, `pathsClause`, `buildFilterPredicate` | loại điều kiện mới |
| `src/search/searcher.ts` | `SearchOptions.paths`, `pathsKey`, `cacheKey`, khoá và lọc của `related`, chế độ liệt kê | cache và hai đường lọc bằng JS |
| `src/contracts/boundary-validation.ts` | `SearchOptionsBoundarySchema`, `SearchToolArgumentsSchema` | nhận `paths` |
| `src/transports/cli.ts` | `readPathsFile`, tuỳ chọn `--paths-file`, `hasFilters` | CLI |
| `src/transports/mcp-runtime.ts` | `callSearchTool`, `inputSchema` | MCP |
| `src/transports/stdio-server.ts` | phân tích `options` | stdio |
| `test/vantt/restrict-paths.test.ts` (mới) | test | xem mục 5 |

Các nhánh nhận predicate không phải sửa: chúng đã nhận `FilterPredicate` từ `search()`.

## 5. Kiểm thử

- `test/vantt/restrict-paths.test.ts`: vault 30 note vùng và 120 note nhiễu (lặp từ khoá nhiều hơn, chiếm hết top-10 khi chưa giới hạn). Lần 1 tìm với `paths` = 30 note; sau đó xoá 120 note, dựng lại index, tìm không `paths`; hai danh sách path bằng nhau, cùng thứ tự, ở 4 chế độ và 3 câu, có và không có gói giả `lang-upper` (nhánh view). Thêm: path lạ bị bỏ qua, tập rỗng ra rỗng, kết hợp với `scope`, chế độ liệt kê, `notePath`, cache không lẫn giữa hai tập, không đặt thì như cũ, một tham số cho 50 000 path, schema MCP và stdio.
- Probe: `node vantt/probes/restrict-paths.mjs --ohs <bản đã build>`. Trả 1 trên upstream v0.17.2, 0 trên bản đã vá (đã chạy cả hai).
- `test_command`: `npx vitest run test/vantt/restrict-paths.test.ts`.
- `capability_check`: probe ở trên (cần bản đã build).
- Toàn bộ `npm test` (114 file), lint, tsc, knip, format:check xanh trên bản đã vá.

## 6. Khi xung đột hoặc khi upstream đổi

Cách tìm lại điểm chạm:

- `buildFilterPredicate`: điều kiện đầu hàm (nhánh trả `empty`) thêm `!hasPathsFilter(options.paths)`; `pathsClause` đẩy ngay trước khối "Every supplied value was unparsable".
- `cacheKey`: nối `pathsKey(options.paths)` sau `languageStr`. Khoá `related`: nối cùng chuỗi sau `fmStr`.
- `search`: chế độ liệt kê (`!input && !isPathLookup && ...`) thêm `hasPaths` vào điều kiện và một `filter` theo tập path.
- Thêm nhánh tìm mới nhận `predicate` thì phải thoả bất biến 2; thêm chỗ lọc bằng JS mới thì thêm `paths`.
- Câu lệnh SQL con của vector đổi `n.` thành `n2.` bằng `replace`: clause của bản vá dùng `n.path` nên vẫn đúng.

Điều kiện bỏ bản vá: upstream có tuỳ chọn tìm giới hạn theo danh sách path chính xác, đẩy vào mọi nhánh (bất biến 2, 4).

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

> **Title:** Search option to restrict results to an explicit list of note paths
>
> Callers that already know a candidate set (a project area, a graph neighbourhood) cannot search inside it: post-filtering the results of a global top-K drops matches, and over-fetching is slow. This adds a `paths` search option (CLI `--paths-file`, MCP/stdio `paths`) as one more clause of `buildFilterPredicate`, so it reaches every retrieval branch before candidates are cut. The clause binds one JSON parameter (`json_each`), so the set size is unbounded. Unset, SQL and results are unchanged; an empty list matches nothing. Tests compare a restricted search with a vault holding only the restricted notes in every mode.
