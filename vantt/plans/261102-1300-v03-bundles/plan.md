---
title: V03 gói dựng sẵn và release đầu tiên
status: blocked
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
