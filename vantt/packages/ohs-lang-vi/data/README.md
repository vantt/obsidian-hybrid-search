# Dữ liệu của gói

## `compounds.txt`: từ điển từ ghép cho view `seg` (PRD 10.4, Q9)

| | |
|---|---|
| Nguồn | `pyvi/models/words.txt` của [trungtv/pyvi](https://github.com/trungtv/pyvi) (Python Vietnamese Toolkit, Viet-Trung Tran) |
| Phiên bản | commit `e2ac2ecfdb3172f1d34e3be728b8b720c1308d67` (nhánh `master`, lần đổi file cuối: `fd88b3b2d7`, 2018-03-28); sha256 của file nguồn `517743d27e71d43343e4b8e9e89015cdc68d84ebe1d48106449e501d918ece4a` |
| Giấy phép | MIT. Đã đọc `LICENSE.txt` ở gốc repo (cùng commit): "The MIT License (MIT) Copyright (c) 2016 Viet-Trung Tran". Bản sao nguyên văn: [`LICENSE-pyvi.txt`](LICENSE-pyvi.txt), đi kèm gói như MIT yêu cầu |
| Kết quả | 22.574 từ, 266 KB (gzip 86 KB); sha256 `9e0dd1b01d0d34ec20b10afb42152d690d76514b5fe60f803e8957c448de0ac3`; digest trong `signature()` (`seg=`) `4a17b242d922` |

Cách lọc (`scripts/compounds.mjs`, chạy lại: `npm run build` rồi `node scripts/compounds.mjs --source <words.txt>`):

1. Bỏ dòng có ký tự khác chữ và dấu cách (từ mượn có gạch nối như `a-ba-giua`, cụm có ` - `, có số).
2. Chuẩn hoá bằng `normalize` của gói: NFC, chữ thường, dấu thanh kiểu `modern` (`hoà`). Lúc nạp, gói chuẩn hoá lại theo `tonePlacement`.
3. Chỉ giữ từ **đúng hai âm tiết**, mỗi âm tiết là âm tiết tiếng Việt hợp lệ (`parseSyllable`). Nguồn có 31.158 mục: 5.743 một âm tiết, 22.705 hai, 1.907 ba, 763 bốn, 40 dài hơn. Bỏ từ ba âm tiết trở lên vì chúng hay nuốt âm tiết đầu của từ sau khi khớp dài nhất (`an toàn khu` + `vực` thay vì `an toàn` + `khu vực`); từ ghép dài do user khai trong lexicon (`## Từ ghép`) thì vẫn dùng, độ dài bất kỳ.
4. Bỏ trùng, sắp xếp.

Về nguồn gốc: pyvi không ghi file này lấy từ đâu. 95% mục của nó (29.468 / 31.122 sau khi hạ chữ thường) cũng có trong `Viet74K.txt` của [duyet/vietnamese-wordlist](https://github.com/duyet/vietnamese-wordlist) (GPL-2.0, gốc từ từ điển của Hồ Ngọc Đức), kể cả những mục hiếm như `a ma tơ`, `à uôm`. Có thể hai danh sách cùng một gốc. Theo tiêu chí Q9 (giấy phép ghi trong LICENSE của nguồn), pyvi đạt; nếu cần chắc chắn về nguồn gốc thì thay file này (cùng định dạng: mỗi dòng một từ, các âm tiết cách nhau một dấu cách) và chạy lại test. Các nguồn khác đã xem: `undertheseanlp/dictionary` (GPL-3.0), `duyet/vietnamese-wordlist` (GPL-2.0), từ điển trong repo `underthesea` (Apache-2.0 nhưng dựng từ Hồ Ngọc Đức và Wiktionary, CC-BY-SA), Wiktionary (CC-BY-SA), lexeme tiếng Việt trên Wikidata (CC0, chỉ 91 mục): không dùng được.
