---
status: completed
---

# V17: `ohs-lang-vi` M5a, Telex/VNI gõ dở và gõ sai một chữ

## Phần PRD (10.3, việc V17)

- `telex.ts`: giải chuỗi Telex và VNI gõ dở ("tieengs vieetj", "tie6ng vie65t" thành "tiếng việt"). Chỉ áp cho token không có trong từ vựng vault mà dạng giải ra có trong từ vựng `norm`; "team", "seen", "online" giữ nguyên.
- `typo.ts`: sửa gõ sai một chữ theo từ vựng vault (thêm, bớt, thay, đảo hai chữ liền nhau), token không có trong từ vựng, dài từ 3 chữ, tối đa 3 ứng viên theo tần suất.
- Mặc định của `telex`, `typo` chốt bằng eval: bật khi hạng mục của nó tốt lên và không hạng nào tụt quá 0,01 nDCG@5.

## Tiêu chí xong

- [x] `vi-telex`, `vi-typo` Hit@5 >= 0,8: 1,00 và 1,00 (V13: 0,47 và 0,93).
- [x] Hạng mục khác không tụt quá 0,01 nDCG@5 (chỉ `vi-semantic` MRR -0,002, nDCG@5 không đổi).
- [x] Eval upstream (obsidian-help) không tệ hơn: nDCG@5 0,735, MRR 0,785, Hit@5 0,879, giống V13.
- [x] Test phản ví dụ tiếng Anh, vòng đi về Telex/VNI cho mọi âm tiết, token trong từ vựng không bị sửa.
- [x] Cổng `minSyllableShare` (V13) không giữ gói trơ với chuỗi Telex: token giải được thành âm tiết có dấu trước khi tính cổng.

## Việc làm

1. `src/telex.ts` (hàm thuần), `src/typo.ts`, `src/rewrite.ts` (luật "không có trong vault, dạng sửa có trong vault").
2. Chỗ cắm trong `query.ts`: `makeQueryToken`, gọi `rewriteTokens` sau `tokenizeQuery`, `baseQuery` và `embedQuery` là câu đã giải khi có token Telex/VNI; `options.ts`: `telex`, `typo` (mặc định bật, không vào `signature()`).
3. Test `test/rewrite.test.ts`; quét eval `telex`, `typo`, cả hai; README của gói.
