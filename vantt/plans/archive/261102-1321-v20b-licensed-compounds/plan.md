---
title: "v20b-licensed-compounds"
description: "Gói ohs-lang-vi: thay từ điển pyvi bằng danh sách học thống kê trên văn bản có giấy phép rõ; câu vi-compound khó trong fixture"
status: completed
priority: P1
effort: "1d"
tags: [vi-pack, v20b]
created: 2026-11-02
---

# V20b: từ điển từ ghép có nguồn gốc rõ

## Phạm vi

Quyết định của user (2026-11-02, ghi ở PRD Q9 và `phase-04-vietnamese-pack.md`): danh sách `trungtv/pyvi` (MIT, nhưng 95% trùng Viet74K GPL) bị thay bằng danh sách dựng bằng thống kê cặp âm tiết trên văn bản có giấy phép rõ (MIT, BSD, Apache-2.0, CC0, CC-BY; không GPL, không CC-BY-SA). pyvi chỉ dùng lúc phát triển để chỉnh và đo, không chép hay lọc từng mục theo pyvi. Giữ `segment` bật; thêm câu `vi-compound` khó vào fixture.

Thêm theo lead: gói cài thiếu `data/` phải nạp lỗi rõ ràng (không chạy lặng lẽ như không có gói); test `npm pack` có file dữ liệu; kiểm `vantt/scripts/bundle.mjs` có chép `data/`.

## Tiêu chí xong

- [x] Corpus có giấy phép rõ, đọc giấy phép trên trang dataset ở đúng revision: ALT (`mutiyama/alt`), `nvidia/Nemotron-Personas-Vietnam` (1/11 shard), `th1nhng0/vietnamese-legal-documents` (văn bản pháp luật không được bảo hộ, Luật SHTT Điều 15; dataset CC BY 4.0). 443,5 triệu âm tiết. Ghi nguồn, revision, sha256, cách xử lý ở `data/README.md`; ghi công `data/ATTRIBUTION.md`.
- [x] Script dựng lại được: `scripts/build-compounds.mjs` (tải, kiểm sha256, đếm, chấm điểm, ghi). Chạy lại từ đầu trên thư mục làm việc mới cho đúng file.
- [x] `data/compounds.txt` mới: 20.523 từ, cùng định dạng. Xoá `LICENSE-pyvi.txt` và `scripts/compounds.mjs` (công cụ lọc pyvi). Ranh giới dùng pyvi ghi ở `data/README.md`.
- [x] Fixture `vantt/obsidian-test-fixture` `v0.11.0`: 15 câu `vi-compound` khó (từ ghép không có trong lexicon mẫu), mọi note và câu của `v0.10.0` giữ nguyên. Gói không tách từ: 15 câu khó 0,645 (không còn bão hoà).
- [x] `FIXTURE_TAG` của `run-eval.mjs` (và `semantic-eval.mjs`, `review-upstream.mjs`) lên `v0.11.0`; `golden-set.json` 270 câu; baseline upstream ghi lại. `quality-gate.mjs` đọc thẻ từ `run-eval.mjs` và chọn `0.17.2.vi-search.json` như cũ; không đổi ngưỡng.
- [x] Mọi mục tiêu G3/G8 đo trong eval giữ; `vi-compound` 0,983 ≥ baseline 0,632 + 0,1; không hạng nào kém bản từ điển pyvi trên cùng fixture và lõi.
- [ ] G8-snippet (`check-snippets.mjs`) 14/15 trên `v0.11.0`: câu `vi-snippet-08` ("quen ngu") rơi khỏi top 10. Không do từ điển: pyvi, từ điển mới, gói không tách từ, lõi `wt-p01b` hay `chk-series` đều 14/15; trên `v0.10.0` là 15/15 nhưng note đích đã ở hạng 8 (nDCG@5 = 0 ở mọi lần đo trước). Báo lead.
- [x] Gói thiếu `data/compounds.txt` (hay file rỗng) thì `createPack` ném lỗi khi `segment` bật. Test: đọc file thiếu/rỗng ném lỗi; `npm pack --dry-run` có `data/compounds.txt`, `data/README.md`, `data/ATTRIBUTION.md`, `build/index.js`.
- [x] Test gói: 458/458; `tsc --noEmit` sạch.

## Cách chọn từ (tóm tắt, chi tiết ở `data/README.md`)

Đếm âm tiết, cặp, bộ ba theo nguồn. Giữ cặp khi: ≥ 10 lần; NPMI (nguồn tốt nhất) ≥ 0,2; tỉ lệ thắng hai phía so với cặp chồng lên nó (nguồn tốt nhất) ≥ 0,75; mỗi âm tiết ≥ 5 lần trong nguồn sạch (ALT, personas); ≤ 80% lần cả hai từ viết hoa chữ đầu (tên riêng); cặp ASCII không dấu cần ≥ 10 lần trong nguồn sạch.

Quá trình chỉnh (F1 so với pyvi hai âm tiết, chỉ để đo):

| Bước | Số từ | P | R | F1 | Ghi chú |
|---|---|---|---|---|---|
| PMI ≥ 2, tỉ lệ thắng gộp ≥ 0,5 | 43.957 | 0,16 | 0,32 | 0,21 | đầy lỗi OCR (`quổc lộ`), chữ không dấu, tiếng Anh |
| NPMI, thắng hai phía, lọc âm tiết sạch và ASCII | 20.969 | 0,31 | 0,28 | 0,29 | eval tốt hơn pyvi, nhưng `nhà hàng`, `sinh học` thiếu (luật thua trong văn pháp luật) |
| Tỉ lệ thắng theo từng nguồn | 24.328 | 0,28 | 0,30 | 0,29 | `vi-names` tụt 0,025 vì tên người (`ngọc anh`) |
| Bỏ tên riêng (viết hoa ≥ 80%) | **20.523** | 0,33 | 0,30 | **0,32** | bản gửi đi |

Ngưỡng cuối nằm trong nhóm F1 cao nhất (chênh < 0,003); trong nhóm đó chọn bộ giữ đủ bảy từ mà test của gói kiểm từ V20 và trên 20.000 mục (test cũ). Từ ghép của 15 câu khó trong fixture được chọn trước khi dựng từ điển và không dùng để chỉnh.

## Eval (lõi `wt-p01b` `632209f`, e5-small, k = 10, fixture `v0.11.0`, mặc định)

nDCG@5. Baseline cũ: upstream trên `v0.10.0`.

| Hạng mục | Baseline cũ (`v0.10.0`) | Baseline mới (`v0.11.0`) | Gói không seg | Gói, từ điển pyvi | Gói, từ điển mới |
|---|---|---|---|---|---|
| Tổng | 0,666 | 0,646 | 0,889 | 0,921 | **0,926** |
| `vi-accented` | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| `vi-partial-accent` | 0,872 | 0,863 | 1,000 | 1,000 | 1,000 |
| `vi-telex` | 0,333 | 0,333 | 1,000 | 1,000 | 1,000 |
| `vi-typo` | 0,488 | 0,543 | 0,755 | 0,967 | 0,967 |
| `vi-snippet` | 0,463 | 0,466 | 0,752 | 0,777 | **0,843** |
| `vi-unaccented` | 0,133 | 0,133 | 0,871 | 0,871 | 0,871 |
| `vi-dd` | 0,263 | 0,239 | 0,913 | 0,913 | 0,913 |
| `vi-iy` | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| `vi-tone-placement` | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| `vi-tone-precision` | 0,951 | 0,951 | 1,000 | 1,000 | 1,000 |
| `vi-compound` | 0,844 | 0,632 | 0,822 | 0,971 | **0,983** |
| ↳ câu 1–15 (cũ) | 0,844 | 0,844 | 1,000 | 1,000 | 1,000 |
| ↳ câu 16–30 (khó) | — | 0,421 | 0,645 | 0,942 | **0,967** |
| `vi-mixed-en` | 0,975 | 1,000 | 1,000 | 1,000 | 1,000 |
| `vi-semantic` | 0,555 | 0,446 | 0,446 | 0,446 | 0,446 |
| `vi-names` | 0,909 | 0,909 | 1,000 | 1,000 | 1,000 |
| `vi-synonym` | 0,067 | 0,067 | 0,637 | 0,689 | 0,689 |
| `vi-abbr` | 0,933 | 0,933 | 1,000 | 1,000 | 1,000 |
| `vi-alias` | 0,535 | 0,477 | 0,975 | 0,975 | 0,975 |

Hit@5 của gói với từ điển mới: `vi-unaccented` 0,93, `vi-dd` 1,00, `vi-telex` 1,00, `vi-typo` 1,00, `vi-synonym` 0,93, `vi-abbr` 1,00, `vi-alias` 1,00. Kết quả V20 trên `chk-series` và `v0.10.0` (`tmp/v20/v20-final.json`) không so trực tiếp được (khác lõi và corpus); trên cùng lõi và corpus, cột pyvi là "kết quả trước".

60 note mới làm nhích các hạng khác cả ở upstream (IDF, thứ hạng trong nhánh vector): `vi-semantic` 0,555 → 0,446, `vi-alias` 0,535 → 0,477, `vi-typo` 0,488 → 0,543.

## Kiểm `bundle.mjs`

`vantt/scripts/bundle.mjs` (dòng 295) chép `build`, `data`, `package.json` của gói vào `lang/ohs-lang-vi`, nên `data/compounds.txt` và `data/ATTRIBUTION.md` có trong bundle. `package.json` `files` trên master đã là `["build", "data"]` (từ V20).
