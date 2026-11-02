---
title: "v11b-p01-contract-fixes"
description: "Bổ sung hợp đồng P01 language-pack-api (vẫn apiVersion 1): viewTerms khớp đúng, viewWeights theo câu, matchedTerms cho rescore, ngữ cảnh cho signature/queryCacheKey, cận trên termsWithPrefix"
status: completed
priority: P1
effort: "0.5d"
tags: [patch, p01, v11b, language-pack-api]
created: 2026-11-02
---

# V11b: bổ sung hợp đồng P01 `language-pack-api`

## Phạm vi

Tác giả gói `ohs-lang-vi`, `ohs-lang-de` báo năm chỗ thiếu của P01 (PRD 9.4, P01). Sửa ngay trong commit P01, chỉ thêm, giữ `apiVersion: 1`:

1. View query luôn thành term tiền tố (`"w"*`): cho `analyzeQuery` xin term và cụm từ khớp đúng theo từng view ("bán" không ra "bánh").
2. `readViewTermsWithPrefix` thiếu cận trên, quét tới cuối bảng từ vựng.
3. `Candidate` truyền cho `rescore` thiếu `matchedTerms`.
4. Trọng số view cố định theo gói: cho trọng số theo câu.
5. `signature()`, `queryCacheKey()` không có ngữ cảnh: truyền `{ vaultPath }`.

## Điều kiện xong

- Gói cũ (`ohs-lang-vi`, `ohs-lang-de`, gói giả `lang-upper`) chạy y nguyên, không sửa gói.
- Không cấu hình gói: snapshot baseline vẫn trùng upstream.
- Build, `npm test`, lint, knip, tsc, format:check xanh trên `vantt/work/series-p01b`.
- Eval vi mặc định không kém `tmp/v18/v18-m2.json` quá 0.01 nDCG@5 ở mọi hạng.
- Probe `language-pack-api` trả 1 trên upstream, 0 trên fork.
- Xuất lại 0001..0006, 0009; không sửa `series.toml`.

## Quyết định

1. `viewTerms` là trường riêng, không đổi kiểu `viewQueries` (gói cũ và code đọc `viewQueries` không bị ảnh hưởng). Chuỗi là khớp đúng, `{text, prefix: true}` là tiền tố, nối `OR`. Mảng khác rỗng thay `viewQueries[v]`, còn lại dùng `viewQueries[v]`.
2. `viewWeights[v]`: số hữu hạn `>= 0` thay trọng số khai báo; `null`/thiếu/hỏng giữ trọng số khai báo. Bỏ nhánh vẫn bằng `viewQueries[v] = null`, để `null` chỉ có một nghĩa.
3. `PackContext = { vaultPath }`, `QueryContext extends PackContext`. Khoá cache của bộ nạp thêm đường dẫn vault để `signature(ctx)` luôn đúng vault.
4. Cận trên `prefix || U+10FFFF` (mã UTF-8 lớn nhất), giữ cả điều kiện `substr` cũ.
5. `Candidate.matchedTerms` luôn là mảng (rỗng khi không khớp view).

## Kết quả

- Nhánh `vantt/work/series-p01b` (worktree `/home/vantt/projects/ohs-wt/wt-p01b`). Rebase các patch sau P01 không xung đột; 0002..0006, 0009 chỉ đổi số dòng.
- Test mới: khối `contract additions` trong `test/vantt/language-pack.test.ts`.
- Spec: `vantt/patches/0001-language-pack-api.spec.md` mục 2.10, 4, 5, 6.
