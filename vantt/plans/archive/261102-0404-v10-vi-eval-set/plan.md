---
title: 'V10: bộ eval tiếng Việt và baseline upstream'
description: 'Việc V10 của lộ trình fork: preset vi-search trong obsidian-test-fixture, golden set 17 hạng mục × 15 câu, smoke-vault, baseline upstream không gói.'
status: completed
priority: P1
effort: '2,5 ngày'
tags: [eval]
created: 2026-11-02
---

# V10: bộ eval tiếng Việt và baseline upstream

## Nguồn yêu cầu

- PRD 11.3: `vantt/eval/vi/smoke-vault/` 10 note viết tay đủ trường hợp; corpus lớn sinh từ preset `vi-search` của `vantt/obsidian-test-fixture`.
- PRD 11.5: định dạng golden set của upstream (`{id, query, relevant_paths, partial_paths, category, notes}`) chạy bằng eval sẵn có; 17 hạng mục, mỗi hạng tối thiểu 15 câu; corpus sinh xác định, có đáp án sinh cùng corpus; baseline là upstream không gói.
- PRD 15 (Q8): lexicon là Markdown `_ohs/lexicon.md` với ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`, mỗi dòng một nhóm nối bằng `=`; mục `## Chờ duyệt` không được dùng.
- Phase 5 của lộ trình: "golden set đủ 17 hạng mục × 15 câu; `npm run eval` chạy được trên corpus sinh; baseline ghi trong `vantt/eval/baselines/`". Chỉ văn bản sinh trong repo công khai. User cho phép đẩy repo fixture (2026-11-02): làm trên nhánh riêng, merge vào `main`, đẩy.

## Điều kiện xong

- [x] Golden set đủ 17 hạng mục × 15 câu (`vantt/eval/vi/golden-set.json`, 255 câu, mỗi câu một note đúng).
- [x] Eval upstream chạy trên corpus sinh (`node vantt/eval/vi/run-eval.mjs`).
- [x] Baseline ghi ở `vantt/eval/baselines/linux-x64/0.17.2.vi-search.json` (và `.smoke.json`).
- [x] Preset chỉ chứa văn bản sinh; test của fixture kiểm không có địa chỉ e-mail hay đường dẫn máy; `scripts/privacy-scan.sh` sạch.
- [x] `vantt/eval/vi/README.md` bằng tiếng Việt, ghi cách chạy.

## Đã làm

- Fixture: preset `presets/vi-search.mjs` (328 note, `_ohs/lexicon.md`, golden set qua `--answers-out`), test `test/vi-search.test.mjs`, README, CHANGELOG. Nhánh `feat/vi-search-preset`, merge vào `main`, thẻ `v0.8.0` rồi `v0.9.0` (đợt hai làm tiêu đề note của `vi-compound` và `vi-synonym` không chứa cụm câu hỏi, vì baseline đầu cho cả hai đã 1,0 nên không đo được gói; đầu ra đổi nên tăng minor). Dùng `v0.9.0`; `v0.8.0` chỉ còn giá trị lịch sử.
- Repo này: `vantt/eval/vi/` (golden set, smoke-vault và golden set, `run-eval.mjs`, README, `.gitattributes` giữ nguyên byte của smoke-vault), `vantt/eval/baselines/linux-x64/`.

## Phát hiện

- Upstream lưu đường dẫn note dạng NFD; eval so chuỗi nguyên văn. Golden set có đường dẫn NFC (tên file thật) cho điểm 0 dù xếp đúng. Golden set trong repo này lưu đường dẫn NFD; `run-eval.mjs` đổi từ NFC của fixture. Mọi bộ eval tiếng Việt sau này (V12, V15) phải tính điều này.
- `npm run` từ chối chạy trên npm khác `devEngines` của upstream (`12.2.0`); script gọi `node --import tsx eval/evaluate.ts`, cùng thứ `npm run eval` chạy. `npm ci` bản thân báo lỗi ở bước `prepare` (`.ai/prepare.mjs`, xung đột `.claude/settings.json`) nhưng cài đủ phụ thuộc; các symlink nó tạo (`.pi`, `.codex`, `AGENTS.md`...) đã bị gitignore.
- Baseline: nDCG@5 0,737, Hit@5 0,827 trên 255 câu; chạy hai lần giống hệt. `vi-iy`, `vi-tone-placement`, `vi-accented` đã 1,0 ở upstream; `vi-synonym` Hit@5 0,13; `vi-telex` 0,53.
- Điều kiện G3 "gấp 2 lần baseline" cho `vi-unaccented`/`vi-dd` không đạt được vì Hit@5 baseline đã 0,93 và 0,87. Cần người quyết đổi sang Hit@1 hoặc bỏ vế "gấp 2 lần" (chưa đổi PRD).

## Rủi ro còn lại

- Baseline theo nền: mới có `linux-x64`; macOS ARM phải chạy riêng.
- `run-eval.mjs` cần mạng (model nhúng, `npx` tải fixture); chưa có chế độ ngoại tuyến ngoài `--otf` trỏ tới bản fixture đã clone.

## Bổ sung (2026-11-02): corpus khó hơn và runner nhận bản OHS/gói khác

- Quyết định của user: giữ ngưỡng PRD (G3), làm corpus khó hơn. Chẩn đoán: tiêu đề note chứa nguyên cụm tìm (`cap(phrase)`), nên nhánh khớp tiêu đề và nhánh vector tìm ra dù FTS5 không gộp được. Đo trực tiếp trên SQLite: `unicode61` gộp dấu khi chữ có một dấu (`ú`, `ê`) nhưng không gộp chữ hai dấu (`ế`, `ữ`, `ợ`) và `đ`; chữ NFC như upstream lưu.
- Fixture `vantt/obsidian-test-fixture` thẻ `v0.10.0` (commit 5d18b8b, nhánh `feat/vi-search-hard-fold` đã vào `main`): `vi-unaccented` và `vi-dd` mỗi hạng là cụm 25 note cùng khuôn chữ khác một từ khoá (tên món toàn âm tiết hai dấu; tên phố có `đ`), tiêu đề chỉ có số; trình sinh kiểm câu đã bỏ dấu chỉ nằm trong đúng note đích. Câu có `query_accented`.
- Baseline mới (363 note): Hit@5 `vi-unaccented` 0,27, `vi-dd` 0,40 (trước 0,93 và 0,87). Có dấu phục hồi: 1,00 cả hai. Hạng khác giữ trong khoảng cũ (xem README); `vi-telex` 0,53 thành 0,47, `vi-alias` 0,67 thành 0,73.
- `run-eval.mjs` thêm `--ohs`, `--lang-pack`, `--lang-options` (đúng `OHS_LANGUAGE_PACK` / `OHS_LANGUAGE_PACK_OPTIONS` của P01), `--compare a b`, `--accented-sanity`; kết quả có `meta.runner`. Chi tiết ở `vantt/eval/vi/README.md`.
- Việc còn lại cho người duyệt: baseline hạ chỉ qua PR có người duyệt (PRD 11.6); V12/V13 dùng các cờ trên.
