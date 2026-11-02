# Bản vá index-events: feat(stdio): emit indexed and removed events after index writes

- Consumer: dự án pkm (cập nhật graph theo sự kiện thay vì đọc lại vault mỗi 5 s); mọi client giữ một tiến trình `ohs serve --stdio`
- Trạng thái upstream: unsubmitted
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Chạm vòng đời index (điểm commit note và xoá note trong `indexer.ts`) và dòng ra của `serve --stdio`. Cơ chế chung (client nào cũng muốn biết note vừa đổi), không có logic sản phẩm; phía dự án quyết định xử lý sự kiện ra sao. Không phải hàm thuần trên chữ nên không đi đường pack.

## 1. Vấn đề

`serve --stdio` không báo cho client khi note được index lại hay bị xoá khỏi index. Client giữ bản sao (graph, danh sách note) phải quét lại cả vault theo chu kỳ (5 s).

Tái hiện: `vantt/probes/index-events.mjs --ohs <dir>`: chạy `serve --stdio` (đặt `OHS_STDIO_EVENTS=1`), sửa một note, xoá một note, chờ dòng sự kiện. Upstream không bao giờ gửi.

## 2. Yêu cầu

1. Opt-in bằng biến môi trường `OHS_STDIO_EVENTS=1` của tiến trình `serve --stdio`. Không đặt thì không thêm dòng nào, byte cho byte như upstream (ngoài `{"ready":true}`).
2. Khi bật, sau mỗi lô ghi, tiến trình gửi dòng JSON không có `id`:
   - `{"event":"indexed","paths":["a.md",…],"db_version":n}`: các note vừa commit vào index (thêm mới hoặc đổi nội dung).
   - `{"event":"removed","paths":["a.md",…],"db_version":n}`: các note vừa bị xoá khỏi index (file bị xoá, bị ignore mới, hoặc dọn note mồ côi).
3. `paths` là đường dẫn tương đối vault (dạng đã chuẩn hoá như cột `notes.path`), sắp xếp, không trùng. `db_version` là giá trị `settings.db_version` ngay sau lô (cùng bộ đếm làm khoá cache tìm kiếm).
4. Gộp: các ghi trong 25 ms thành một sự kiện mỗi loại; một path trong cùng cửa sổ chỉ thuộc loại cuối cùng. Thứ tự gửi `removed` trước `indexed`.
5. Chỉ báo các ghi do chính tiến trình này thực hiện (watcher, `reindex` qua stdio, quét đầu). Khi tiến trình khác giữ quyền index (ví dụ máy chủ MCP) thì không có sự kiện từ lần ghi của tiến trình đó.
6. Mọi dòng đi qua `writeLine` của `serve --stdio` (P04).

## 3. Bất biến

1. Không bật `OHS_STDIO_EVENTS`: không đăng ký người nghe, không bộ đếm giờ, không dòng ra mới; kết quả tìm và hành vi index y hệt upstream.
2. Sự kiện chỉ phát sau khi giao dịch ghi đã commit (không phát cho note index lỗi hoặc `skipped`).
3. Người nghe ném lỗi không làm hỏng index; huỷ đăng ký (người nghe cuối) xoá hàng đợi và bộ đếm giờ.
4. Không đổi schema DB, không đổi `INDEX_SCHEMA_VERSION`, không đổi hợp đồng request/response; dòng sự kiện luôn không có `id` nên không lẫn với phản hồi.
5. Phát sự kiện không chặn và không đổi thứ tự công việc index.

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/indexing/indexer.ts` | khối `onIndexEvent` / `noteIndexChange` / `noteIndexPublished` (thêm trước `assertIndexRun`); gọi trong `indexFile` (nhánh `missing` và sau `bumpIndexVersion` khi `indexed`), `cleanupStaleNotes`, `safeHandleUnlink` của `startWatcher`; import `getDbVersion` | điểm commit và xoá note |
| `src/transports/cli.ts` | khối `if (opts.stdio)` của `serve`, ngay sau `writeLine`; import `onIndexEvent` | nối sự kiện vào `writeLine` khi bật |
| `test/vantt/index-events.test.ts` (mới) | | tiến trình `serve --stdio` thật: sửa note, xoá note, không bật thì im |

## 5. Kiểm thử

- `test_command`: `npx vitest run test/vantt/index-events.test.ts` (cần `npm run build` trước; test chạy `dist/src/cli.js`, mất khoảng 15 s vì watcher đợi debounce 5 s).
- Test: sự kiện `indexed` sau khi sửa note, `removed` sau khi xoá, không có `id`, `db_version` là số; không đặt biến thì stdout chỉ có `{"ready":true}`.
- Probe: `vantt/probes/index-events.mjs --ohs <dir>`: trên upstream (không có sự kiện) trả 1; trên bản fork trả 0.
- `capability_check`: `node vantt/probes/index-events.mjs --ohs .`

## 6. Khi xung đột hoặc khi upstream đổi

- Tìm lại điểm chạm: `git grep -n "bumpIndexVersion" src/indexing/indexer.ts` (mỗi chỗ ghi/xoá note thật cần một `noteIndexChange`); `git grep -n "writeLine" src/transports/cli.ts`.
- Nếu upstream thêm đường commit note mới: gọi `noteIndexChange('indexed', [path])` ngay sau commit, `'removed'` ngay sau xoá.
- Nếu rebase lên P09/P05/P06: các bản vá đó đổi `indexFile` (chunker, anchors) nhưng không đổi nhánh commit; giữ hai lệnh gọi xung quanh `bumpIndexVersion`.
- Giới hạn đã biết: độ trễ sự kiện = debounce của watcher (`config.debounce`, 5 s mặc định, cố định trong `config.ts`) + thời gian index; xoá file không qua debounce. Nếu cần dưới 1 s phải hạ debounce (không thuộc bản vá này).
- Điều kiện bỏ bản vá: upstream có sự kiện index tương đương qua stdio. Probe sẽ trả 0 trên upstream (có thể phải đổi cách bật); khi đó đặt `upstream_status = "merged"`.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

**Title:** stdio IPC: opt-in `indexed` / `removed` events after index writes

**Body:** A client that mirrors the index (graph view, note list) has no way to learn that a note was reindexed or removed, so it rescans the vault on a timer. With `OHS_STDIO_EVENTS=1`, `ohs serve --stdio` pushes `{"event":"indexed"|"removed","paths":[...],"db_version":n}` lines (no `id`) after each write burst, coalesced over 25 ms. Off by default; nothing changes without the variable. Tests run a real `serve --stdio` process and edit/delete notes.
