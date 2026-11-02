# Bản vá db-path: feat(storage): allow the index database outside the vault

- Consumer: bộ cài pkm; người dùng Obsidian Sync, OneDrive, Dropbox
- Trạng thái upstream: unsubmitted (gửi sau khi chạy ổn trong fork, L08)
- Pha: now
- Đường đã chọn (PRD 9.0): **bản vá lõi**. Đổi chỗ DB là chạm vòng đời index (`storage/db.ts`, dò vault), không làm được từ pack hay từ ngoài.

## 1. Vấn đề

DB luôn ở `<vault>/.obsidian-hybrid-search.db` cùng `-wal`, `-shm`. OneDrive, Obsidian Sync, Dropbox chép cả index (hàng trăm MB) và có thể hỏng DB khi hai máy cùng ghi. Không có biến môi trường hay tuỳ chọn nào đổi chỗ lưu (`--db` chỉ dùng để dò vault).

Tái hiện trên upstream v0.17.2: đặt `OBSIDIAN_VAULT_PATH` tới một vault tạm, `ohs reindex`, rồi `ls -a` vault: có `.obsidian-hybrid-search.db`. Probe `vantt/probes/db-path.mjs` làm đúng việc đó với `OBSIDIAN_DB_PATH` và kiểm file ở đâu.

## 2. Yêu cầu

1. `OBSIDIAN_DB_PATH` (đường dẫn tuyệt đối tới file DB; rỗng hoặc toàn khoảng trắng coi như không đặt; đường dẫn tương đối bị từ chối). Có thì mọi transport mở DB ở đó. `-wal` và `-shm` đi theo file DB.
2. Thư mục cha của DB được tạo nếu chưa có (`openDb`). DB ngoài vault không cần mẫu bỏ qua trong vault; mẫu `.obsidian-hybrid-search.db*` của `vault/ignore.ts` giữ nguyên cho trường hợp DB ở trong vault.
3. Không có `OBSIDIAN_VAULT_PATH` mà có `OBSIDIAN_DB_PATH` trỏ tới file đã có: dò vault từ `settings.vault_path` của file đó (dùng như `--db`). Chưa có file thì dò vault như cũ (`.obsidian` ngược lên từ cwd) và DB sẽ được tạo ở `OBSIDIAN_DB_PATH`; không dùng DB trong vault vì sẽ là DB cũ lạc chỗ.
4. `--db <path>` khi có `OBSIDIAN_VAULT_PATH`: nếu file tồn tại và `settings.vault_path` khớp vault đang dùng (so bằng realpath) thì dùng làm DB thật, bằng cách đặt `process.env.OBSIDIAN_DB_PATH` (daemon kế thừa `process.env`, nên cùng một DB). Ngược lại giữ nguyên như upstream (bỏ qua `--db`).
5. `status` (CLI, MCP, stdio IPC) có `db_path` (đường dẫn DB đang mở), luôn có, cả khi không cấu hình.
6. Mở DB có `OBSIDIAN_DB_PATH` mà `settings.vault_path` ghi vault khác vault đang dùng thì từ chối: "Index database … belongs to vault …".

**Lệch so với PRD 9.4 P02 yêu cầu 2** (lead đã đồng ý): PRD viết "nếu chưa tồn tại và có `OBSIDIAN_VAULT_PATH` thì tạo ở đó". Test của upstream (`test/vault-config.test.ts`, ca locator `missing`, `B`, `corrupt`, và hai ca "uses only the actual canonical DB defaults") ép: vault tường minh luôn giữ DB chuẩn của nó khi `--db` trỏ file không có, hỏng hay của vault khác; có `--db` mà không có vault thì chỉ dùng để dò vault, không đổi chỗ DB. Vì vậy `--db` chỉ nhận DB đã có và khớp vault; muốn **tạo** DB ở chỗ khác thì dùng `OBSIDIAN_DB_PATH`.

## 3. Bất biến

1. Không đặt `OBSIDIAN_DB_PATH` (và `--db` không nhận DB ngoài chỗ mặc định): đường dẫn DB và hành vi y hệt upstream; chỉ có thêm trường `db_path` trong `status`.
2. Một DB nằm ngoài chỗ mặc định không bao giờ được dùng cho vault khác vault ghi trong `settings.vault_path` (bài học upstream issue #45). `--db` của vault khác không bao giờ được nhận; `openDb` từ chối khi lệch.
3. Mọi transport (CLI, MCP stdio, HTTP, stdio IPC, daemon) mở cùng một DB: cùng `config.dbPath`, và `--db` được nhận sẽ xuất ra `OBSIDIAN_DB_PATH` trước khi daemon sinh ra (`mcp-supervisor.ts` truyền `...process.env`).
4. File vận hành của daemon (state, log, lock, reranker device) nằm ở `~/.cache/obsidian-hybrid-search` (`getLocalStateDirectory`), không cạnh DB, nên không đổi gì. Chỉ `-wal`, `-shm` đi cạnh DB.
5. Bản vá không đổi schema nên không tăng `INDEX_SCHEMA_VERSION`.
6. `--db` trỏ DB đã có và nằm đúng chỗ mặc định của vault: không đặt `OBSIDIAN_DB_PATH` (giống upstream).

## 4. Điểm chạm

| File | Hàm hoặc chỗ | Vì sao |
|---|---|---|
| `src/runtime/config.ts` | `dbPathOverride` (mới), `dbPath` | đọc `OBSIDIAN_DB_PATH`, kiểm tuyệt đối |
| `src/storage/vault-locator.ts` | `isSameVaultPath` (mới) | so vault bằng realpath |
| `src/storage/db.ts` | `openDb`, `assertDatabaseBelongsToVault` (mới) | tạo thư mục cha, từ chối DB của vault khác |
| `src/vault/vault-config.ts` | `discoverConfig`, `useExternalDatabase` (mới) | nhận `--db` hợp lệ, dò vault từ `OBSIDIAN_DB_PATH` |
| `src/transports/status-payload.ts`, `src/transports/mcp-runtime.ts` | trường `db_path` | `status` CLI, stdio IPC, MCP |
| `src/transports/cli.ts` | mô tả `--db` | chỉ chữ trợ giúp |
| `README.md` | bảng cấu hình, mục chạy từ ngoài vault | tài liệu người dùng |
| `test/vantt/db-path.test.ts` (mới) | test | xem mục 5 |

## 5. Kiểm thử

- `test/vantt/db-path.test.ts`: mặc định không đổi; `OBSIDIAN_DB_PATH` tương đối bị từ chối; index với DB ngoài vault, thư mục cha được tạo, không có file `.obsidian-hybrid-search.db*` trong vault, `status.db_path` đúng; không cấu hình thì `db_path` là đường dẫn mặc định; DB của vault A mở cho vault B thì báo lỗi; `--db` nhận DB khớp vault, bỏ qua DB của vault khác và file không có; không có vault thì `--db` chỉ dò vault; dò vault từ `OBSIDIAN_DB_PATH` đã có; `--db` trong vault không đặt biến.
- Test của upstream `test/vault-config.test.ts` và toàn bộ `npm test`, lint, knip, format:check vẫn xanh.
- Daemon: `mcp-supervisor.ts` truyền `...process.env` cho tiến trình con (không đổi); kiểm bằng đọc mã và bởi bất biến 3.
- Probe: `node vantt/probes/db-path.mjs --ohs <bản đã build>`. Trả 1 trên upstream v0.17.2 (DB xuất hiện trong vault), 0 trên bản đã vá. Upstream không có tuỳ chọn tương đương nên probe chỉ thử `OBSIDIAN_DB_PATH`.
- `test_command`: `npx vitest run test/vantt/db-path.test.ts`.
- `capability_check`: `node vantt/probes/db-path.mjs --ohs .` (cần bản đã build).

## 6. Khi xung đột hoặc khi upstream đổi

- `config.dbPath`: nếu upstream đổi cách dựng đường dẫn, giữ nhánh `dbPathOverride` ở đầu getter.
- `openDb`: `mkdirSync` trước `new Database(`; `assertDatabaseBelongsToVault` ngay sau khi biết bảng `settings` tồn tại, trước `runMigrations`.
- `discoverConfig`: nhánh vault tường minh (chỉ nhận `--db` khi `settings.vault_path` khớp) và dò `OBSIDIAN_DB_PATH` đã có. Upstream sửa test `vault-config.test.ts` để `--db` luôn đổi DB thì xem lại độ lệch ở mục 2.
- `status`: chèn `db_path` ngay trước `db_size_mb` ở hai nơi (`status-payload.ts`, `callStatusTool`).
- `INDEX_SCHEMA_VERSION`: không đụng.

Điều kiện bỏ bản vá: upstream cho cấu hình đường dẫn DB (biến môi trường hoặc tuỳ chọn) đặt được ngoài vault, mọi transport dùng chung và từ chối DB của vault khác. Probe trả 0 trên upstream là tín hiệu xem xét.

## 7. Nội dung issue hoặc PR gửi upstream (nháp)

> **Title:** Allow the index database outside the vault (`OBSIDIAN_DB_PATH`)
>
> The index database always lives at `<vault>/.obsidian-hybrid-search.db`. Sync tools (OneDrive, Obsidian Sync, Dropbox) copy it, and two machines writing at once can corrupt it. `--db` only helps to locate the vault.
>
> This adds an optional `OBSIDIAN_DB_PATH` (absolute file path). The parent directory is created, every transport and the daemon open the same file, `status` reports `db_path`, and a database recording a different vault is refused (see #45). `--db` also selects an existing database that records the active vault. Without the variable nothing changes.
