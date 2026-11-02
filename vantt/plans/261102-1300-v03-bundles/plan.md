---
title: V03 gói dựng sẵn và release đầu tiên
status: in-progress
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
(điền sau khi Release xong)
