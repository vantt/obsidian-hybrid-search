---
phase: 3
title: "Phase 3: Điểm cắm gói ngôn ngữ"
status: todo
priority: P1
effort: "6d"
dependencies: [1]
---

# Phase 3: Điểm cắm gói ngôn ngữ

## Overview

Bản vá P01 thêm điểm cắm chung cho mọi ngôn ngữ vào lõi; lõi không biết tiếng Việt. Gói tiếng Đức chứng minh điểm cắm thật sự chung. Phục vụ G2, G9, và là nền của toàn bộ phase 4. Đây là việc khó nhất về thiết kế và nằm trên đường găng.

## Việc

| ID | Việc | Cần | Mức | Công | PRD |
|---|---|---|---|---|---|
| V11 | P01 `language-pack-api`: thư mục `src/language/` (`types.ts`, `loader.ts`, `noop.ts`); hợp đồng `LanguagePackV1` gồm `views`, `project`, `analyzeQuery`, `rescore`, `aliasViews`, `queryCacheKey`, `QueryContext.vaultPath`; bảng `notes_lex_<v>`, `notes_alias_lex_<v>`, `fts5vocab`; nhánh RRF cho view; đoạn trích từ nhánh view đổi về chữ gốc theo bất biến token, `matchedTerms`; cờ `explain`; nạp ở CLI, MCP, stdio, daemon; cập nhật `dependency-cruiser.config.cjs`, `test/architecture-boundaries.test.ts`. Test bằng gói giả `lang-upper` | V01 | mạnh | 4 | 10.1, 10.2 |
| V21 | Gói `vantt/packages/ohs-lang-de` (tiếng Đức): `ä` khớp `a` và `ae`, `ß` khớp `ss`, từ ghép dài; ít nhất một view và `analyzeQuery`; test riêng; golden set nhỏ. Mọi chỗ phải sửa lõi để gói chạy là lỗi của P01 và sửa trong P01 | V11 | vừa | 2 | 2.1 (G9), 15 (Q10) |

## Quy tắc riêng

- Không cấu hình gói: không tạo bảng `notes_lex_%`, danh sách nhánh RRF và trọng số y như upstream, kết quả trùng snapshot.
- Gói lỗi (ném lỗi khi nạp, sai `apiVersion`, `project` ném lỗi): OHS chạy tiếp như không có gói, `status` báo lỗi.
- Đổi chữ ký gói chỉ dựng lại phần chữ; số lần gọi embedder bằng 0.
- Không thêm gói vào `package.json` của OHS, kể cả `optionalDependencies`.
- Tăng `INDEX_SCHEMA_VERSION`.

## File sở hữu

- V11: `vantt/patches/0001-language-pack-api.{patch,spec.md}`, `vantt/probes/language-pack-api.mjs`; trong bản vá: `src/language/**`, `test/vantt/language-pack*.test.ts`, `test/vantt/fixtures/lang-upper/**`.
- V21: `vantt/packages/ohs-lang-de/**`.

## Todo

- [x] V11 P01 `language-pack-api` và gói giả
- [ ] V21 gói tiếng Đức `ohs-lang-de`

## Success Criteria

- V11: mọi test P01 ở PRD 10.2 xanh (gói giả, không gói, gói lỗi, đổi chữ ký, `rescore` path lạ, `aliasViews`, đoạn trích chữ gốc, `queryCacheKey`); bất biến của V12 xanh.
- V21: gói chạy qua hợp đồng P01 không sửa lõi; bất biến xanh khi không bật gói; eval tiếng Đức có gói không tụt so với không gói.

## Ghi chú sau V11

- P01 làm sớm trên `v0.17.2` (nhánh `vantt/work/p01-language-pack-api`), đã vào `series.toml`. Khi P00 vào series, lead dựng lại P01 sau P00.
- Hợp đồng thêm `QueryContext.dbVersion()` và quy tắc token nối (`U+2060`) cho từ ghép tiếng Đức; chữ ký gói lưu ở `settings.language_pack`, không gộp vào `content_policy`. Chi tiết trong `vantt/patches/0001-language-pack-api.spec.md`.
- Điều kiện "bất biến của V12 xanh" kiểm lại khi V12 xong.
- Diff `searcher.ts` khoảng 400 dòng: P03, P06 và các bản vá sau dựng trên P01.

## Risk

- Đường `rebuildIndex` hiện tại không cho dựng lại riêng view mà giữ embedding: thêm đường dựng lại riêng cho view (PRD 10.2 mục Index).
- Hợp đồng thiếu thứ gói `vi` cần ở phase 4: sửa P01 trước khi phát hành gói, tăng `apiVersion` nếu đổi không tương thích.
