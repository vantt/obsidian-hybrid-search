---
title: "V12: bài kiểm bất biến và cổng chất lượng"
description: "vantt/scripts/invariance.mjs (T4) và quality-gate.mjs (T5) theo PRD 11.4 và 11.6, kèm chế độ --private cho V15."
status: completed
priority: P1
effort: "1 ngày"
tags: [infra, eval]
created: 2026-11-02
---

# V12: bài kiểm bất biến và cổng chất lượng

## Nguồn yêu cầu
PRD 11.1 (T4, T5), 11.4, 11.5, 11.6; mốc T4/T5 trong `vantt/scripts/lib/tiers.mjs`.

## Quyết định
- **Hợp đồng mốc:** `node vantt/scripts/{invariance,quality-gate}.mjs --target-ref --target-sha --branch --json [--with-lang <id>]`, chạy ở gốc nhánh phát hành. Mã thoát 0 = đạt, 1 = không đạt, 2 = không chạy được (catchup coi cả hai là hỏng). JSON một đối tượng ra stdout, tiến độ ra stderr.
- **Bất biến:** `git worktree add --detach` tại `--target-sha` (dưới `vantt/.work/invariance/`), dùng chung `node_modules` của nhánh phát hành khi `package-lock.json` hai bên giống nhau (bỏ trường `version`), nếu khác thì `npm ci`. Hai lần chạy `eval/evaluate.ts` cùng corpus (`obsidian-help`, `evergreen-notes`; cấu hình trong `quality-gates.json`), môi trường sạch (không `OHS_*`, `OBSIDIAN_*`, `OPENAI_*`), trên bản sao vault. So `top_paths` đúng thứ tự, điểm lệch tối đa 1e-6. `--with-lang` bị bỏ qua: bài này luôn không gói.
- **Cổng:** ngưỡng ở `vantt/scripts/quality-gates.json`. Mục tiêu mà tính năng chưa có để `status: "pending"` (báo cáo, không làm hỏng; `--strict` coi như hỏng).
- **So số đo cùng lượt, cùng máy (sửa sau lần CI đầu tiên):** điểm ONNX lượng tử hoá khác nhau theo CPU (máy dev 0,735, runner GitHub 0,728 trên cùng cây), nên baseline lưu sẵn không dùng để quyết đạt hay hỏng. Quyết bằng số đo của lượt này:
  - `upstream-no-pack`: nDCG@5 của fork không gói so với upstream nguyên gốc đo cùng lượt (±0,005). Số của upstream lấy từ báo cáo T4 (`vantt/.work/invariance-last.json`, dùng khi khớp sha đích, HEAD và k); không có thì cổng tự dựng worktree upstream và đo (`lib/same-run.mjs`). Trên macOS ARM vẫn dùng ngưỡng sàn của `eval/quality.ts`.
  - `upstream-with-pack`: có gói không tụt quá 0,01 so với không gói, đo cùng lượt (như cũ).
  - `vi-regression-*` và các mục tiêu "hơn upstream" (G3 tỉ lệ, G8 compound): tham chiếu là eval vi không gói của cùng cây, cùng lượt (T4 đã chứng minh cây không gói giống upstream).
  - Baseline lưu sẵn chỉ để báo trôi: `upstream-baseline-drift`, `vi-baseline-drift` (trạng thái `warn`, không bao giờ làm hỏng; baseline cũ sai số câu cũng báo `warn`). So với baseline bản phát hành trước (`vi-previous-release-*`) cũng là `warn` trừ khi `vi.previous_release_enforced` bật.
- **Baseline:** `vantt/eval/baselines/<nền>/<phiên bản>.<bộ>[.<lang>].json`: `0.17.2.obsidian-help.json` (upstream), `0.17.2.vi-search.json` (upstream, corpus vi), `0.17.2-vantt.1.vi-search.vi.json` (bản phát hành có gói). Lấy bản mới nhất không vượt quá phiên bản đang chạy. `--write-baseline` ghi file mới, từ chối ghi đè (`--force` chỉ để thử cục bộ; hạ baseline qua PR).
- **macOS ARM:** thay so với upstream đo cùng lượt bằng ngưỡng sàn của `eval/quality.ts` (gọi `assertEvalQuality` của chính upstream).
- **`--private <thư mục|golden-set.json> [--vault <dir>]`:** chạy cùng cây có và không có gói trên bản sao vault riêng, chỉ in số tổng hợp (số câu, chỉ số theo hạng mục, đạt/không đạt). Đầu ra của tiến trình con bị nuốt; không in câu hỏi, đường dẫn, tiêu đề. Có test kiểm đầu ra không chứa nội dung.

## Trạng thái mục tiêu
- Gói `vi` đã đủ (V13, V17-V20): mọi mục tiêu G3/G8 trong `quality-gates.json` là `enforced`. Mục tiêu muốn tạm hoãn thì đặt `status: "pending"` (báo cáo, không làm hỏng).
- `vi-snippet`: cổng tự sinh vault `vi-search` (cùng thẻ fixture với `run-eval.mjs`), chạy `vantt/eval/vi/check-snippets.mjs` qua cây đang kiểm và ghi `snippet_ok` (tỉ lệ câu đạt) vào kết quả của hạng mục.
- Baseline `obsidian-help` Linux ghi lần đầu bằng `--write-baseline` (ghi mới, không phải hạ).

## Quyết định về evergreen-notes
PRD 11.4 nêu `evergreen-notes`, nhưng dataset là bản cào web (hàng nghìn trang, 1,7 giây mỗi trang, hơn một giờ). Cào trong catchup làm mỗi lần chạy mất hàng giờ, và nội dung trang đổi theo thời gian. Nên nó là corpus tuỳ chọn (`invariance.optional_corpora`): chỉ chạy khi `fixtures/evergreen-notes/dataset` đã có (`npm run eval:prepare-evergreen-notes -- --no-images`), báo cáo ghi `corpora_skipped` khi bỏ. `obsidian-help` (58 câu, cố định theo commit) luôn chạy.

## Kiểm
`npx vitest run --config vantt/scripts/vitest.config.mjs` (`invariance.test.mjs`, `quality-gate.test.mjs`: cây giả với eval giả, không cần mạng) và chạy thật `catchup.mjs --with-lang vi --json` trong bản clone riêng.
