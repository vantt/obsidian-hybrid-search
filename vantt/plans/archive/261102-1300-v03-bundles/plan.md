---
title: V03 gói dựng sẵn và release đầu tiên
status: completed
created: 2026-11-02
---

# V03: gói dựng sẵn 4 nền

PRD 7.3, 8. Việc V03 của phase 01.

## Kết quả cần đạt
- `vantt/scripts/bundle.mjs`: dựng gói tự chứa (Node đi kèm, `npm ci --omit=dev` trên đúng nền, gói `ohs-lang-vi`, LICENSES, MANIFEST, sha256).
- `vantt/scripts/bundle-smoke.mjs`: smoke PRD 8.4 (đường dẫn có dấu cách và chữ Việt, `ohs status`, `reindex`, `search`, `serve --stdio`, MCP `initialize` + `tools/list`).
- `.github/workflows/vantt-bundles.yml`: tag `v*-vantt.*`, dispatch, `workflow_call`; 4 nền; smoke job tách riêng, không có setup-node; chỉ khi cả 4 xanh mới đẩy lên Release và đặt `latest`.
- Release có 4 gói kèm `.sha256`, kích thước ghi lại.

## Không làm
- Không ký macOS (Q4). Không đóng model vào gói.

## Quyết định
- Xoá thêm khi thu gọn (chỉ xoá file): provider CUDA/TensorRT của `onnxruntime-node` (cần driver NVIDIA và CUDA mà gói không có) và `*.wasm` của `onnxruntime-web` (đường lùi cho trình duyệt; Node dùng `onnxruntime-node`). Linux: 942 MB trước, 295 MB sau thu gọn.
- `package.json` của gói chỉ giữ trường chạy (có `allowScripts`, vì npm 12 chặn script cài đặt nếu thiếu), không có `scripts` và `devEngines`.
- `macos-13` đã bị GitHub ngừng; dùng `macos-15-intel`.
- Tag đẩy bằng `GITHUB_TOKEN` không kích hoạt workflow khác; catchup cần gọi bundles bằng `workflow_call` hoặc dùng PAT `VANTT_PUSH_TOKEN`.

## Kết quả
Release https://github.com/vantt/obsidian-hybrid-search/releases/tag/v0.17.2-vantt.1 (run 41400682250). Smoke xanh trên 3 nền.

| Nền | Nén (MB) | Giải nén (MB) | Trước thu gọn (MB) |
|---|---|---|---|
| win32-x64 | 102,6 | 279,3 | 632,3 |
| darwin-arm64 | 99,5 | 326,3 | 656,9 |
| linux-x64 | 99,0 | 295,7 | 942,7 |
| darwin-x64 | không dựng được | | |

**darwin-x64 bị chặn bởi phụ thuộc**: `onnxruntime-node` 1.30.0 chỉ có `bin/napi-v6/{darwin/arm64, linux/{arm64,x64}, win32/{arm64,x64}}`. Smoke trên runner Intel báo `Cannot find module ../bin/napi-v6/darwin/x64/onnxruntime_binding.node`. Dùng Node x64 dưới Rosetta cũng không có file này. Cần user quyết: ghim `onnxruntime-node` cũ hơn có binding Intel (đổi lock của upstream, thuộc một bản vá), bỏ Intel, hoặc chờ upstream.

Windows: `tar.exe` đọc argv theo code page ANSI nên không `chdir` được vào thư mục có chữ Việt; smoke truyền thư mục qua `cwd`. Bộ cài `pkm setup` phải tránh cùng lỗi.

## Intel macOS (user chốt ghim phiên bản)
- Kiểm tarball npm: `onnxruntime-node` 1.21.1 đến 1.23.2 có `bin/napi-v6/darwin/x64/onnxruntime_binding.node`, từ 1.24.1 đến 1.30.0 thì không. `@huggingface/transformers` 4.3.1 ghim đúng 1.30.0; thay bằng 1.23.2 lúc đóng gói chạy được (smoke xanh trên `macos-15-intel` và trên Linux).
- Tiêu chí (lead chốt): cùng một máy Linux, một lần chạy, khoá 1.30.0 so với bản thay 1.23.2, mọi hạng mục lệch không quá 0,01 nDCG@5, cộng smoke xanh trên `macos-15-intel`. Run 41404189339: smoke xanh (gói 87,5 MB nén, 281,6 MB giải nén); ảnh hưởng của bản thay **không đạt**: obsidian-help multilingual 0,413 thành 0,476 (+0,063), vi-synonym 0,729 thành 0,712 (-0,017), còn lại trong 0,01 (ALL obsidian-help +0,007).
- Cổng theo từng nền: mỗi job smoke tự đẩy gói của nền mình lên Release; darwin-x64 còn cần job `pin-effect` đạt. Một nền hỏng chỉ giữ gói của nền đó và đỏ job của nó. Run trên cho 3 gói đã đẩy, darwin-x64 đỏ, `latest` giữ nguyên.
- Số eval của gói Intel (tham khảo): `vantt/eval/baselines/darwin-x64/` (obsidian-help nDCG@5 0,742; vi-search có gói 0,932).
- Chờ user quyết với darwin-x64 (không bỏ nền).

## Kết thúc (2026-11-02)
- User chấp nhận độ lệch đã đo của bản thay (multilingual +0,063, vi-synonym -0,017) và ghi thành danh sách cho phép theo hạng mục (sai số 0,005) trong `bundle-parity.mjs`; hạng mục khác vẫn giới hạn 0,01. Run 41405549264 xanh: `pin-effect` đạt, 4 gói lên `v0.17.2-vantt.1` cùng `.sha256` và `.bundle.json`, release được đặt `latest`, release notes ghi bản thay, bảng độ lệch và "user chấp nhận 2026-11-02".
- Gói đã phát hành (nén / giải nén, MB): win32-x64 102,6 / 279,3; darwin-arm64 99,5 / 326,3; darwin-x64 87,5 / 281,6; linux-x64 99,1 / 295,7. Smoke xanh cả 4.
- Việc còn lại ngoài V03: chạy thật đường catchup gọi bundles khi có tag mới.

## Sửa độ ổn định của phép kiểm pin-effect (2026-11-02)
- Run 41406332060 (tag `v0.17.2-vantt.2`) đỏ vì runner lần đó có CPU khác: phía khoá cho `obsidian-help` ALL 0,728 (các lần đạt: 0,735), và độ lệch của bản thay là keyword +0,011, conceptual +0,029, multilingual +0,054, vi-synonym +0,023. Run đó đã dùng bản có danh sách cho phép (đầu ra có dòng "Accepted deltas").
- Đo: 3 runner (AMD EPYC 9V74, 7763, 7763) cho kết quả giống nhau từng số, và chạy lại cùng một phía trên cùng máy cho kết quả giống hệt. Vậy phép đo xác định theo từng loại CPU, không ngẫu nhiên; độ lệch phụ thuộc loại CPU.
- Sửa: `vantt-pin-effect.yml` ghi CPU, chỉ kết luận khi là AMD EPYC (loại CPU của số đã được user chấp nhận), nếu không thì chạy lại trên runner mới, tối đa 3 lần; hết 3 lần thì báo đỏ và không phát hành gói Intel. Danh sách cho phép giữ nguyên, không nới ngưỡng.
- Run 41411464446 cho `v0.17.2-vantt.2`: lần 1 gặp CPU khác (không kết luận), lần 2 đạt; đủ 4 gói (12 file) trên Release, `latest`.

## v0.17.2-vantt.4 (2026-11-02)
- Run 41419225358 đỏ do lỗi hạ tầng: job eval clone fixture `v0.10.0` cố định trong khi `run-eval.mjs` và golden set đã sang `v0.11.0` ("golden-set.json differs..."). Đã sửa: các job lấy tag từ `FIXTURE_TAG` trong `run-eval.mjs`.
- Run 41422251427 (EPYC 7763, cùng máy, khoá 1.30.0 so với bản thay 1.23.2) trên gói vi mới: obsidian-help ALL +0,007, multilingual +0,063 (đã chấp nhận); vi ALL +0,001, vi-semantic +0,004, vi-synonym 0,689 xuống 0,668 (-0,021, vẫn trong danh sách cho phép -0,017 ± 0,005), **vi-snippet 0,951 lên 0,975 (+0,024) vượt ngưỡng 0,01 và chưa được chấp nhận**. Đây là độ lệch thật của bản thay trên bộ dữ liệu và gói mới, không phải lỗi eval. Theo quy tắc, danh sách cho phép không tự sửa; `darwin-x64` của `v0.17.2-vantt.4` chưa phát hành (3 gói kia đã lên), chờ user quyết.

## Quy tắc chỉ chặn khi tụt (2026-11-02)
- User chốt: bỏ danh sách độ lệch được chấp nhận theo từng hạng mục, thay bằng "chỉ chặn khi tụt": (bản thay trừ bản khoá) nDCG@5 không nhỏ hơn -0,01 thì đạt; cải thiện luôn đạt (chỉ báo tham khảo trong release notes); riêng `vi-synonym` được tụt tới -0,03. Giữ nguyên: so trên cùng một máy, chỉ tính trên AMD EPYC (CPU khác thì chạy lại, tối đa 3 lần), thất bại thì đỏ rõ.
- Mã: `vantt/scripts/lib/parity-rule.mjs` (hàm `judgeRegression`), test `vantt/scripts/test/parity-rule.test.mjs`, cờ `--regressions-only` của `bundle-parity.mjs compare`.

