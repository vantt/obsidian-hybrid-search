# Bản vá stdio-parity: feat(stdio): add read, vectors, neighbors and reindex actions and drain requests on close

- Consumer: dự án pkm (plugin Obsidian, máy chủ điện thoại, công cụ chạy lô); mọi client giữ một tiến trình `ohs serve --stdio` sống lâu
- Trạng thái upstream: unsubmitted
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Chạm vòng đời tiến trình `serve --stdio` (chờ request đang chạy trước khi đóng DB) và thêm action vào hợp đồng IPC (`contracts/boundary-validation.ts`). Không phải hàm thuần trên chữ nên không đi đường pack. Cơ chế chung, không có logic sản phẩm; `search` không đổi.

## 1. Vấn đề

Upstream v0.17.2 chỉ có hai action stdio: `search` và `status`.

1. Muốn đọc note, lấy vector, K note gần nhất hay index lại, client phải mở tiến trình mới (khoảng 2 s nạp model mỗi lần), dù đã có một tiến trình sống.
2. Khi stdin đóng, `cleanup` trong `serve --stdio` gọi `process.exit(0)` ngay. Request đang chạy mất phản hồi: client gửi N dòng rồi đóng stdin sẽ không nhận đủ N kết quả.

Tái hiện: `vantt/probes/stdio-parity.mjs --ohs <dir>` làm đúng hai việc đó (gửi `{"action":"read",...}`; gửi một loạt `search` rồi đóng stdin).

## 2. Yêu cầu

1. Action mới trong `serve --stdio`, mỗi request một dòng JSON có `id`, phản hồi mang cùng `id`:
   - `{"action":"read","paths":[…]|"a.md","snippetLength":n,"related":bool}` → `{id, notes:[…]}` (cùng nội dung `readNotes`, đúng thứ tự `paths`; `paths` nhận cùng dạng với tool `read` của MCP: chuỗi, mảng, hoặc chuỗi JSON của mảng; không được rỗng).
   - `{"action":"vectors","paths":[…],"pooling":"mean|max","normalize":bool}` → `{id, meta, records:[…]}`, đúng `meta` và các dòng note của `ohs vectors` (P03).
   - `{"action":"neighbors","paths":[…],"k":n,"minScore":x,"excludeLinked":bool,"scope":…,"pooling":"mean|max"}` → `{id, meta, records:[…]}`, đúng đầu ra của `ohs neighbors` (P03).
   - `{"action":"reindex","path":"a.md","force":bool}` → `{id, result:{indexed, skipped, errors:[…]}}`; không `path` thì cả vault. Lỗi index từng file nằm trong `result.errors`, không phải `error` của phong bì.
2. Schema zod cho từng action trong `src/contracts/boundary-validation.ts` (`StdioReadRequestSchema`, `StdioVectorsRequestSchema`, `StdioNeighborsRequestSchema`, `StdioReindexRequestSchema`). Lỗi schema trả `{id, error}`; action lạ vẫn trả `unknown action: <tên>`.
3. Khi stdin đóng: ngừng nhận request mới, chờ mọi request đang chạy trả phản hồi (tối đa `STDIO_DRAIN_TIMEOUT_MS` = 60 s), xả stdout, rồi đóng index và DB và thoát mã 0. SIGTERM/SIGINT vẫn thoát ngay như upstream.
4. `vectors`/`neighbors` dùng đúng `exportNoteVectors`/`findNoteNeighbors` của P03; `ohsVersion` do transport truyền vào. Note không trả lời được là bản ghi `{path, error}` trong `records` (như CLI), lỗi model/dim lệch là `{id, error}`.
5. Không đổi `search` và `status`.

## 3. Bất biến

1. Request cũ (`search`, `status`, dòng không có `action`) giữ nguyên định dạng, thứ tự xử lý đồng thời và hành vi. Phản hồi mỗi request vẫn đúng một dòng JSON.
2. Mỗi request nhận đúng một phản hồi mang `id` của nó, kể cả khi stdin đóng ngay sau khi gửi (tới hết giới hạn chờ).
3. `vectors`/`neighbors`/`read` chỉ đọc; `reindex` là action duy nhất ghi, dùng đúng `IndexService.reindex` như CLI và MCP.
4. Một action không có handler (server nhúng khác) trả `<action> is not available on this server`, không bao giờ treo hay ném ra ngoài phong bì `{id, error}`.
5. `stdio-server.ts` chỉ kiểm tra tham số và định dạng; phép tính nằm ở `search/`, `indexing/` (handler do `cli.ts` cấp).
6. Đường ghi dòng phản hồi là một hàm `writeLine` duy nhất do `serve --stdio` tạo ra; phát sự kiện không có `id` (P07) đi cùng hàm đó.
7. Không đổi schema DB, không đổi `INDEX_SCHEMA_VERSION`.

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/contracts/boundary-validation.ts` | bốn schema `Stdio*RequestSchema` mới, đặt ngay trước `StdioRequestSchema` | hợp đồng IPC |
| `src/transports/stdio-server.ts` | `handleStdioLine` (tham số thứ 5 `actions`, danh sách `KNOWN_ACTIONS`), `runAction`, `drainInFlight`, kiểu `StdioActionHandlers` | phân loại action, kiểm schema, chờ request |
| `src/transports/cli.ts` | khối `if (opts.stdio)` của `serve`: bỏ `rl.on('close'/'end', cleanup)`, theo dõi `inFlight`, `await drainInFlight` sau vòng đọc, nối handler | vòng đời tiến trình |
| `test/vantt/stdio-parity.test.ts` (mới) | | test đơn vị và tiến trình thật |
| `test/transport-parity.test.ts` | thêm một test | `read`, `vectors`, `neighbors` cùng kết quả qua IPC, CLI, MCP |
| `test/serve-stdio.test.ts` | hai danh sách action lạ đổi `reindex` thành `bogus` | `reindex` nay là action hợp lệ |

## 5. Kiểm thử

- `test_command`: `npx vitest run test/vantt/stdio-parity.test.ts test/transport-parity.test.ts test/serve-stdio.test.ts` (cần `npm run build` trước vì có test chạy `dist/src/cli.js`).
- Test của bản vá: phân phối và schema (handler vắng, action lạ, tham số sai, tham số chuyển đúng, lỗi handler), `drainInFlight` (rỗng, chờ cả việc thêm vào giữa chừng, hết giờ), và hai test tiến trình với `serve --stdio` thật + máy chủ nhúng giả: 25 request `search` liền nhau rồi đóng stdin nhận đủ 25 `id`; `read`/`vectors`/`neighbors`/`reindex` chạy tuần tự; một `reindex --force` toàn vault rồi đóng stdin vẫn nhận phản hồi.
- Parity: `read` giống `ohs read --json` và tool MCP `read`; `vectors`/`neighbors` giống JSON Lines của CLI.
- Probe: `vantt/probes/stdio-parity.mjs --ohs <dir>`: trên upstream v0.17.2 trả 1 (`read` bị `unknown action`, và/hoặc mất phản hồi khi đóng stdin); trên bản fork trả 0.
- `capability_check`: `node vantt/probes/stdio-parity.mjs --ohs .`

## 6. Khi xung đột hoặc khi upstream đổi

- Tìm lại điểm chạm: `git grep -n "handleStdioLine" src`; khối `if (opts.stdio)` trong `serveCommand` của `src/transports/cli.ts`; `git grep -n "StdioRequestSchema" src/contracts`.
- Nếu upstream thêm action khác vào `handleStdioLine`: thêm tên vào `KNOWN_ACTIONS` và giữ nhánh `runAction` cho bốn action của bản vá.
- Nếu upstream đổi vòng đọc `for await (const line of rl)`: giữ ba việc, theo dõi promise của từng request, `await drainInFlight` sau vòng, rồi mới `cleanup`.
- Điều kiện bỏ bản vá: upstream có action `read`, `vectors`, `neighbors`, `reindex` qua stdio (hoặc tương đương) và chờ request đang chạy khi stdin đóng. Probe sẽ trả 0 trên upstream; khi đó đặt `upstream_status = "merged"` và đối chiếu định dạng phản hồi với phía dự án.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

**Title:** stdio IPC: add `read`, `vectors`, `neighbors`, `reindex` actions and answer in-flight requests when stdin closes

**Body:** `ohs serve --stdio` answers only `search` and `status`, so a client that already holds a running process still has to spawn another one (and reload the model) to read a note or reindex. Also, when stdin is closed the server calls `process.exit(0)` immediately, so a client that writes N requests and closes stdin does not get N answers. This adds the four actions with zod schemas (responses mirror the MCP `read` and `reindex` tools and the CLI `vectors`/`neighbors` JSON Lines), and on stdin EOF waits up to 60 s for running requests before closing the index. `search` and `status` are unchanged. Tests cover dispatch, schema errors and a real `serve --stdio` process sending 25 requests then closing stdin.
