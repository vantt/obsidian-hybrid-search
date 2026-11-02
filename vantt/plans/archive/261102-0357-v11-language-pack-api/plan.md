---
title: "v11-language-pack-api"
description: "Bản vá P01 language-pack-api: điểm cắm gói ngôn ngữ chung trong lõi OHS, thử bằng gói giả lang-upper"
status: completed
priority: P1
effort: "4d"
tags: [patch, p01, v11, language-pack]
created: 2026-11-02
---

# V11: bản vá P01 `language-pack-api`

## Phạm vi (trích PRD)

- PRD 9.4, P01: "Xem mục 10.2 (đặc tả đầy đủ). Bản vá chỉ chứa điểm cắm và cách nạp; không chứa một dòng tiếng Việt nào."
- PRD 10.1: lõi không biết tiếng Việt; không gói = upstream; không sửa văn bản gốc; không nhúng lại khi đổi gói; hợp đồng có `apiVersion`.
- PRD 10.2: nạp qua `OHS_LANGUAGE_PACK`, `OHS_LANGUAGE_PACK_OPTIONS`; `src/language/{types,loader,noop}.ts`; hợp đồng `LanguagePackV1` (`views`, `project`, `analyzeQuery`, `aliasViews`, `queryCacheKey`, `rescore`, `QueryContext.vaultPath`); bảng `notes_lex_<v>`, `notes_fts_lex_<v>`, `notes_fts_lex_<v>_vocab`, `notes_alias_lex_<v>`; nhánh RRF cho mỗi view; đoạn trích chữ gốc theo bất biến token, `matchedTerms`; cờ `explain`; tăng `INDEX_SCHEMA_VERSION`; khoá `settings.language_pack`.
- Phase file `phase-03-language-pack-api.md`, việc V11 và quy tắc riêng.
- Gói `vi` (10.3) và gói `de` (V21) phải viết được qua hợp đồng này mà không sửa lõi.

## Ngoài phạm vi

Gói `ohs-lang-vi`, `ohs-lang-de`; `series.toml` (lead giữ); script catchup.

## Quyết định thiết kế

1. **Đường đi: bản vá lõi** (PRD 9.0): đây chính là điểm cắm mà các pack cần; đổi schema và cách chọn ứng viên (thêm nhánh RRF).
2. **Chữ ký gói tách khỏi `content_policy`.** Lưu ở `settings.language_pack` (JSON `{id, version, signature, views, aliasViews}`), so với gói đang nạp. Lệch thì chỉ dựng lại view: duyệt `notes`, gọi `project`, ghi `notes_lex_*`, dựng lại FTS, trong một giao dịch; không quét vault, không gọi embedder. Lý do: `rebuildIndex` đọc lại cả vault và đi qua bảng staging; đường riêng nhanh hơn, embedder = 0 chắc chắn, và không gói thì `content_policy` giữ nguyên chữ của upstream (bất biến). Chuyển trạng thái chỉ chạy ở chủ index được phép chuyển (cùng quy tắc `prepareContentOwner` của upstream); tiến trình theo sau mà lệch thì báo lỗi như lệch `content_policy`.
3. **`storage/` không gọi gói.** `indexing/` tính văn bản view (hàm thuần của gói) rồi truyền vào `upsertNote` qua trường `lexical` của `PreparedIndexNote`; dựng lại view truyền callback. `replaceActiveIndex` (reindex đầy đủ) xoá bảng view, sau đó `indexing/` dựng lại view.
4. **Tìm chỉ dùng gói khi DB đã đồng bộ** với gói đang nạp (so `settings.language_pack`). Không đồng bộ, không nạp được, hoặc gói hỏng: đi đúng mã của upstream.
5. **Bất biến token** đo bằng bộ tách JS mô phỏng `unicode61` (chữ cái, số, dấu tổ hợp, `Co`, cộng `tokenchars`). Phía chữ gốc dùng cùng `tokenchars` của view trừ `_`; token view chứa `_` đếm bằng số phần. Làm rõ PRD (PRD ghi chữ gốc tách bằng `unicode61 remove_diacritics 0`; với tokenizer mặc định có `tokenchars '+#'` thì "a+b" lệch, nên lấy cùng `tokenchars`). Lệch: rơi về đoạn trích đầu note, cảnh báo một lần.
6. **Gói hỏng**: nạp lỗi, sai `apiVersion`, thử `project` lúc nạp ném lỗi, hoặc `project` ném lỗi lúc index: gói bị tắt cho cả tiến trình, bảng view bị xoá, `status.language_pack.error` ghi lý do. `analyzeQuery`, `rescore`, `queryCacheKey` ném lỗi: câu đó chạy như không gói, cảnh báo một lần.
7. **Nạp** trong `openIndexDatabase()` (CLI, MCP stdio và HTTP, stdio IPC, daemon đều đi qua đây; daemon nhận nguyên `process.env`).
8. **`explain`**: mỗi kết quả thêm `explain: {ranks, debug?}`; `matchedTerms` chỉ có khi khớp nhánh view. Không gói và không `explain` thì JSON kết quả giữ nguyên.

## Phase

| # | Phase | Trạng thái |
|---|-------|-----------|
| 1 | [Thực hiện](./phase-01-start.md) | Xong |

## Điều kiện xong (từ phase-03)

- [x] Mọi test P01 ở PRD 10.2 xanh: gói giả, không gói, gói lỗi, đổi chữ ký (embedder = 0), `rescore` path lạ, `aliasViews`, đoạn trích chữ gốc (cả token ghép `_`), `queryCacheKey`.
- [x] Không gói: không có bảng `notes_lex_%`; danh sách nhánh RRF và trọng số như upstream; kết quả trùng snapshot sinh từ upstream v0.17.2.
- [x] `npm test`, `lint`, `build`, `knip`, `format:check` xanh trong worktree.
- [x] Probe trả 1 trên upstream v0.17.2, 0 trên bản đã vá.
- [x] Xuất `vantt/patches/0001-language-pack-api.patch`, spec theo mẫu PRD 9.3, probe `vantt/probes/language-pack-api.mjs`.

<!-- slug: v11-language-pack-api -->

## Kết quả (2026-11-02)

- Commit `ec84835` trên `vantt/work/p01-language-pack-api`, xuất thành `vantt/patches/0001-language-pack-api.patch` (áp sạch lên `v0.17.2`).
- `npm test` 113 file, 2011 test xanh; `build`, `lint`, `knip`, `format:check` xanh.
- Probe: upstream 1, bản vá 0.
- Thêm so với PRD 10.2 (để gói `vi`, `de` không phải sửa lõi): `QueryContext.dbVersion()` (cache từ vựng theo `db_version`, PRD 10.3) và token tiếp nối `U+2060` (tách từ ghép tiếng Đức, V21).
