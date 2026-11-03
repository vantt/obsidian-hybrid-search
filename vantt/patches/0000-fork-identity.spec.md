# Bản vá fork-identity: feat(cli): report fork build identity and allow disabling update checks

- Consumer: mọi bản fork đã dựng (catchup ghi `version` và `"vanttFork": true` vào package.json), bộ cài và người dùng chạy `ohs --version`, `ohs status`, MCP `status`
- Trạng thái upstream: unsubmitted (PRD 9.4 ghi "không gửi")
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**, nhỏ. Chạm `src/transports/` và thêm một module nhỏ trong `src/runtime/`. Không phải pack vì đọc package.json và kiểm biến môi trường nằm ở lõi. Không đổi schema, không đổi cách chọn ứng viên.

## 1. Vấn đề

- Bản fork tự kiểm cập nhật trên npm `obsidian-hybrid-search/latest`, so với số phiên bản của fork và báo "có bản mới" sai.
- Số phiên bản đã đọc từ package.json, nên `--version` đã in số fork khi catchup ghi số. Nhưng status không cho biết đây là bản fork.

Tái hiện trên upstream v0.17.2: `ohs status` gọi registry và báo `update_available` cho bản fork; không có cách tắt.

## 2. Yêu cầu

1. `OHS_DISABLE_UPDATE_CHECK=1` tắt kiểm cập nhật ở CLI (`status`) và MCP (`checkForUpdates`). Không gửi request nào tới registry.
2. `--version` và `status.version` in số từ package.json (không đổi).
3. Khi package.json có `"vanttFork": true`, `status` có thêm `build: "vantt"`. Không có trường này khi package.json không có marker.
4. Không đổi tên package, `bin`, tên tool MCP.

## 3. Bất biến

1. Không đặt `OHS_DISABLE_UPDATE_CHECK` (hoặc đặt khác `1`): hành vi kiểm cập nhật như upstream.
2. package.json không có `vanttFork`: `status` không có trường `build`; `--version` và `status.version` như upstream.
3. Chỉ `vanttFork === true` mới bật marker; giá trị khác (chuỗi `"true"`, số) được coi là upstream.
4. Không đổi schema DB, không đổi kết quả tìm.

## 4. Điểm chạm

| File                                     | Hàm hoặc chỗ                                                                        | Vì sao                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/runtime/package-identity.ts` (mới)  | `readPackageIdentity`, `packageIdentity`, `updateCheckDisabled`, `buildStatusField` | Đọc package.json một lần, kiểm biến môi trường, sinh trường `build`                                                         |
| `src/transports/cli.ts`                  | `const version`, `fetchUpdateStatus`                                                | Dùng `packageIdentity.version` thay hàm đọc riêng (bỏ `readPackageVersion`); trạng thái `disabled` không in trường cập nhật |
| `src/transports/mcp-runtime.ts`          | `checkForUpdates`                                                                   | Thoát sớm khi tắt kiểm cập nhật                                                                                             |
| `src/transports/status-payload.ts`       | `buildStatusPayload`                                                                | Thêm `...buildStatusField()` sau `version`                                                                                  |
| `test/vantt/fork-identity.test.ts` (mới) |                                                                                     | Xem mục 5                                                                                                                   |

Lưu ý: `mcp-runtime.ts` giữ nguyên cách đọc `packageVersion` của upstream.

## 5. Kiểm thử

- `test/vantt/fork-identity.test.ts`: đọc marker (có và không có), trường `build` chỉ khi là fork, biến môi trường chỉ có giá trị `1` mới tắt, `checkForUpdates` không gọi `fetch` khi tắt.
- Probe `vantt/probes/fork-identity.mjs --ohs <bản đã build>`: trả 0 khi `--version` có `-vantt.`, trả 1 khi không. Đã chạy: bản upstream sạch in `0.17.2` (exit 1); bản với package.json đã stamp `0.17.2-vantt.1` (exit 0).
- `test_command`: `npx vitest run test/vantt/fork-identity.test.ts`.
- `capability_check`: `node vantt/probes/fork-identity.mjs --ohs .` (cần bản đã build).

## 6. Khi xung đột hoặc khi upstream đổi

- Tìm lại `fetchUpdateStatus(` trong `cli.ts`, `checkForUpdates(` trong `mcp-runtime.ts`, `buildStatusPayload(` trong `status-payload.ts`.
- `readPackageVersion` của upstream nằm đầu `cli.ts` (sau import); nếu upstream đổi cách đọc phiên bản thì giữ `packageIdentity.version`.
- Điều kiện bỏ bản vá: upstream có biến tắt kiểm cập nhật và trường nhận biết bản build tương đương (`build` hoặc tương tự), và đọc phiên bản từ package.json.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

Không gửi (bản vá chỉ dùng cho fork).
