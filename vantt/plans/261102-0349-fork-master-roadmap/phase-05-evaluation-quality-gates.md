---
phase: 5
title: "Phase 5: Đo lường và cổng chất lượng"
status: in-progress
priority: P1
effort: "6.5d"
dependencies: []
---

# Phase 5: Đo lường và cổng chất lượng

## Overview

Bộ eval tiếng Việt, bài kiểm bất biến, cổng chất lượng nối vào catchup, eval trên vault thật của user, và đợt eval nhánh nghĩa. Phục vụ G2, G3, G8, G10. V10 bắt đầu ngay vì phase 4 cần nó để chốt tham số.

## Việc

| ID | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|
| V10 | Preset `vi-search` trong obsidian-test-fixture (kèm file lexicon mẫu), golden set 17 hạng mục × 15 câu theo định dạng eval của upstream, smoke-vault, baseline upstream không gói ở `vantt/eval/baselines/<platform>/` | — | vừa | 2,5 | 11.3, 11.5 |
| V12 | `vantt/scripts/invariance.mjs` (không gói thì `top_paths` từng câu trùng 100% với upstream cùng tag, cùng máy, cùng lần chạy), `vantt/scripts/quality-gate.mjs`, nối cả hai vào catchup để chạy đủ T1–T5 | V10, V11 | vừa | 1 | 11.1, 11.4, 11.6 |
| V15 | Eval trên vault thật của user: golden set riêng khoảng 60 câu do user gán nhãn, lưu ngoài repo, chạy ở máy user bằng `quality-gate.mjs --private <path>`; chỉ ghi số tổng hợp vào `vantt/reviews/` | V13, user | vừa | 0,5 + user | 11.5 |
| V22 | Một đợt eval nhánh nghĩa: mỗi model nhúng (e5-small, e5-base, bge-m3, một model chuyên tiếng Việt chạy được bằng ONNX) × `restoreForEmbedding` bật/tắt × rerank có/không; mỗi model index một lần; đo nDCG@5, Hit@5, mức tách cặp gần nghĩa thật với cặp nhiễu, thời gian index, thời gian mỗi câu, RAM, dung lượng | V13 | vừa | 2–2,5 | 2.1 (G10), 15 (Q3) |

Song song: V10 ngay từ đầu. V12 khi V10 và V11 xong. V15 và V22 sau V13, chạy song song với V17–V20.

## Quy tắc riêng

- Eval upstream ghi DB vào thư mục vault và dựng lại toàn bộ: chạy trên bản sao, không trên vault thật của user trong CI.
- ONNX lượng tử cho số khác nhau theo CPU: baseline theo từng nền; bất biến so cùng máy, cùng lần chạy.
- Hạ baseline chỉ qua PR có người duyệt, kèm lý do.
- Không đưa nội dung vault thật hay câu hỏi của user vào repo, CI, log, báo cáo; chỉ số tổng hợp.
- V22 không đổi model mặc định của upstream trong lõi; kết quả là đề xuất cho bộ cài dự án và chốt Q3.

## File sở hữu

- V10: `vantt/eval/vi/**`, `vantt/eval/baselines/**`; preset `vi-search` trong repo `vantt/obsidian-test-fixture` (của user, nhánh `main`, công khai). User cho phép agent đẩy (2026-11-02); làm trên nhánh riêng rồi merge vào `main`, chỉ chứa dữ liệu sinh.
- V12: `vantt/scripts/invariance.mjs`, `vantt/scripts/quality-gate.mjs`; móc vào `vantt/scripts/catchup.mjs` qua lead.
- V15: `vantt/reviews/vault-eval-<date>.md`.
- V22: `vantt/reviews/semantic-eval-<date>.md`, script đo ở `vantt/scripts/`.

## Todo

- [x] V10 bộ eval tiếng Việt và baseline upstream
- [x] V12 bất biến và cổng chất lượng nối vào catchup
- [x] V15 eval trên vault thật: `vantt/reviews/v0.17.2-vantt.2.private.md` (61 câu; có gói nDCG@5 0,600 lên 0,698; cổng theo hạng mục hỏng, chờ người quyết)
- [x] V22 đợt eval model nhúng, `restoreForEmbedding`, reranker

- [ ] V15b sửa hạng mục tụt trên vault thật (`--private-detail`, lexicon, đo lại)
- [ ] V15c bước trộn `hybrid` không để nhánh fulltext khớp chữ vặt kéo đáp án của nhánh nghĩa xuống (xem ghi chú V15c)

## Success Criteria

- V10: golden set đủ 17 hạng mục × 15 câu; `npm run eval` chạy được trên corpus sinh; baseline ghi trong `vantt/eval/baselines/`.
- V12: `catchup.mjs --with-lang vi` chạy đủ T1–T5; bất biến trùng 100% khi không gói.
- V15: số tổng hợp trong `vantt/reviews/`, không có nội dung vault.
- V22: báo cáo trong `vantt/reviews/` kèm đề xuất model, `restoreForEmbedding`, bật hay tắt reranker cho bộ cài dự án.

## Ghi chú sau V10

- Đường dẫn note trong DB upstream ở dạng NFD; golden set dùng NFD, `vantt/eval/vi/run-eval.mjs` đổi đầu ra NFC của fixture. V12, V15 phải theo cách này.
- `npm run eval` bị npm từ chối khi bản npm khác `devEngines` (12.2.0); dùng `node vantt/eval/vi/run-eval.mjs`.
- User chốt 2026-11-02: làm corpus khó hơn, giữ ngưỡng PRD. Fixture `v0.10.0`: baseline upstream Hit@5 `vi-unaccented` 0,27, `vi-dd` 0,40; khi phục hồi dấu đạt 1,00. SQLite `unicode61` đã tự bỏ dấu cho âm tiết một dấu; chỉ âm tiết hai dấu (`ế`, `ữ`) và `đ` là hỏng (đúng như PRD 3.5; corpus cũ chưa tái hiện được vì tiêu đề lộ câu tìm).
- `run-eval.mjs` có `--ohs <dir>`, `--lang-pack`, `--lang-options`, `--compare`, `--accented-sanity`. Runner dựng vault dưới `os.tmpdir()`: đặt `TMPDIR` ra ngoài `/tmp`.
- V12 xong: `catchup.mjs --with-lang vi --json` trên `v0.17.2`, đủ 9 bản vá, T1–T5 SUCCESS. T4: 58/58 câu trùng upstream khi không gói. T5: mọi mục tiêu G3, G8 bắt buộc và đạt (nDCG@5 `vi` 0,666 → 0,932; `vi-unaccented` Hit@5 0,267 → 1,0; `vi-dd` 0,4 → 1,0; `vi-snippet` 15/15; eval upstream có gói 0,735 không tụt). Baseline `obsidian-help` linux-x64 đã ghi. `evergreen-notes` tuỳ chọn (crawl web quá lâu), lý do ở plan con V12.
- Sau release đầu, ghi baseline có gói bằng `quality-gate.mjs --with-lang vi --write-baseline` qua PR.
- V15 (2026-11-02): user báo một agent khác (phía dự án) đang chuẩn bị golden set riêng và thử cài bản Windows; xong sẽ cập nhật lên remote. Lead chạy `quality-gate.mjs --private` khi có file; golden set và vault thật vẫn ở ngoài repo này. Agent phía dự án đã chạy trên `0.17.2-vantt.2` và sửa lỗi NFD của chế độ `--private` (golden set NFC bị chấm trượt hết).
- V22 xong: `vantt/reviews/semantic-eval-2026-11-02.md`. Đề xuất cho bộ cài: bật `restoreForEmbedding` (nDCG@5 +0,005 đến +0,018); reranker tắt mặc định (+0,05 đến +0,10 ở `vi-semantic` nhưng +150 ms mỗi câu, +616 MB); model mặc định giữ e5-small, hồ sơ chất lượng cao `Xenova/bge-m3` (tách cặp gần nghĩa AUC 0,968). Không model nào index 2.000 note quá 30 phút ở 4 luồng. Cần đo lại trên vault thật (V15).
- V22 tìm ra hai lỗi của gói `vi`: `restoreForEmbedding` đổi nhầm chữ trong câu có đúng 50% âm tiết có dấu ("Hội An"); `package.json` thiếu `data` trong `files` nên gói đóng gói mất `data/compounds.txt` và chạy như không có gói. Lead giao sửa.
- User chốt sau V15 (2026-11-02): **dùng gói `vi`** cho bộ cài với vault thật (tổng nDCG@5 0,600 → 0,698). Việc theo dõi bắt buộc V15b: tìm và sửa các hạng mục tụt trên vault thật (`vi-iy` −0,260, `vi-accented` −0,052, `vi-compound` −0,041; `vi-synonym` chờ lexicon). Cách làm: thêm `quality-gate.mjs --private-detail` ghi kết quả từng câu ra file cục bộ ngoài repo (không in ra log, không commit) để điều tra trên máy user; lexicon khởi đầu bằng `ohs-lang-vi learn-abbr --vault <dir>` rồi user duyệt mục `## Chờ duyệt`, đo lại.
- V15c (2026-11-02, agent phía dự án, đo trên vault thật ở máy user): `vi-semantic` gần 0 ở cả hai phía (0,023 không gói, 0,020 có gói). Một câu điều tra tay: nhánh `semantic` xếp note đúng hạng 7; nhánh `fulltext` không có note đúng trong top 50 và trả các note chỉ khớp chữ vặt rải rác (từ chức năng, từ phổ biến); `hybrid` trộn theo hạng nên rác fulltext kéo note đúng xuống hạng 41. Nghĩa là với câu hỏi theo ý, bước trộn làm tệ hơn chỉ dùng nhánh nghĩa. Việc: đổi cách trộn để nhánh fulltext yếu (chỉ khớp chữ có IDF thấp, khớp ít phần câu, điểm BM25 thấp so với phân bố) được trọng số thấp, hoặc chọn trọng số theo độ tin của từng nhánh; làm trong gói ngôn ngữ nếu hợp đồng P01 cho phép (trọng số view, `rescore`), không thì trong lõi và giữ bất biến "không gói = upstream". Đo: `vi-semantic`, `vi-mixed-en` trên corpus sinh và `--private` trên vault thật; các hạng mục khác không tụt quá 0,01 nDCG@5. Sau đó mới đo lại reranker (V22), vì reranker chỉ xếp lại nhóm đầu mà đáp án đang nằm ngoài nhóm đó. Tạm thời phía dự án dặn chat trong vault gọi `search` với `mode: semantic` cho câu hỏi theo ý.

## Risk

- `vantt/obsidian-test-fixture` là repo công khai: preset chỉ chứa văn bản sinh, không chép nội dung vault thật hay câu hỏi riêng của user.
- Model lớn quá chậm trên máy CPU thường: đo và ghi; không chọn model làm index vault 2.000 note quá 30 phút mà không báo user.
