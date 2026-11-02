# ohs-lang-de

Gói ngôn ngữ tiếng Đức cho obsidian-hybrid-search, làm theo hợp đồng `LanguagePackV1` của bản vá P01. Mục đích chính là chứng minh G9: hợp đồng P01 thật sự chung, một gói thứ hai chạy được mà **không sửa lõi**. TypeScript thuần, không phụ thuộc runtime.

## Việc gói làm

Một view `de` (tokenizer `unicode61 remove_diacritics 0 tokenchars '+#<U+2060>'`), đồng thời là alias view.

| Chữ trong note | View `de` chứa | Tìm được bằng |
|---|---|---|
| `Käse` | `kase`, `⁠kaese` | `Käse`, `kase`, `kaese` |
| `Große Straße` | `grosse strasse` | `grosse strasse`, `Strasse` |
| `Fußgängerbrücke` | `fussgangerbrucke`, rồi các token tiếp nối (`⁠fuss`, `⁠ganger`, `⁠gaenger`, `⁠brucke`, `⁠bruecke`) | `Brücke`, `bruecke`, `Fußgänger`, cả từ ghép |

- Khoá gộp (token đầu): chữ thường, `ß` thành `ss`, `ä ö ü` mất dấu (`a o u`), dấu khác bị bỏ.
- Dạng chuyển tự: `ä ö ü` thành `ae oe ue`. Chỉ khác khoá gộp khi từ có umlaut; thêm thành token tiếp nối.
- Tách từ ghép không cần từ điển ngoài: quy hoạch động trên danh sách thành phần nhỏ trong `src/lexicon.ts`, cho phép các yếu tố nối `s es n en e er ns ens`, mỗi thành phần tối thiểu 3 chữ, từ tối thiểu 6 chữ, chọn cách ít thành phần nhất. Mỗi thành phần thành token tiếp nối.
- Token tiếp nối (tiền tố U+2060) là quy tắc của P01: không tính vào số token nguồn, nên lõi vẫn ánh xạ trúng lại chữ gốc cho đoạn trích và `matchedTerms`.
- `analyzeQuery`: bỏ từ chức năng (`der die und ...`) khi còn từ khác, sinh mọi cách viết (khoá gộp, chuyển tự, và dạng thành phần, kể cả khi từ truy vấn là từ ghép) rồi lõi nối bằng OR. `aliasKeys` dùng đúng hàm `project`.

Tuỳ chọn (`OHS_LANGUAGE_PACK_OPTIONS`): `{"splitCompounds":true,"extraWords":["Sauerkraut"]}`. Cả hai đổi `signature()`, nên đổi chúng thì lõi dựng lại phần chữ.

## Dùng

```sh
npm ci && npm run build
OHS_LANGUAGE_PACK=/đường/dẫn/tới/ohs-lang-de ohs reindex
```

## Kiểm thử

- `npm test`: test đơn vị (fold, tách từ ghép, project, hợp đồng) và test thuộc tính bằng fast-check: số token không tiếp nối của view luôn bằng số token nguồn.
- `npm run build && npm run eval -- --ohs <cây OHS đã dựng, có P01> [--work-dir <thư mục>] [--out kết-quả.json]`: kiểm tích hợp. Dựng vault `eval/vault` hai lần (không gói, có gói) bằng CLI của OHS dựng sẵn, kiểm `status`, `--explain` (có nhánh `view:de`), đoạn trích là chữ gốc, rồi chạy `eval/golden-set.json` ở chế độ `fulltext` (máy chủ embedding giả chỉ để index thành công, vector không mang tín hiệu, nên eval đo các nhánh chữ). Thoát 0 khi mọi kiểm tra đạt và gói không thấp hơn không gói ở mọi nhóm.
- Bất biến không-gói: bài `test/vantt` của P01 (36 test) xanh trên cây này; khi không đặt `OHS_LANGUAGE_PACK` lõi không tạo bảng nào và kết quả giống upstream.

Dữ liệu chỉ là văn bản tổng hợp (22 note, 39 câu hỏi, nhóm: exact, eszett, umlaut, compound, alias, stopword, control).

## Số đo (2026-11-02, OHS 0.17.2 + P01 `ec84835`, fulltext, k=10)

Không gói thành có gói:

| Nhóm | n | Hit@1 | Hit@5 | MRR | nDCG@5 | Recall@10 |
|---|---|---|---|---|---|---|
| Tất cả | 39 | 0,64 thành 0,95 | 0,64 thành 1,00 | 0,64 thành 0,97 | 0,57 thành 0,97 | 0,56 thành 0,97 |
| exact | 1 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 0,83 thành 0,96 | 1,00 thành 1,00 |
| eszett | 5 | 0,60 thành 0,60 | 0,60 thành 1,00 | 0,60 thành 0,80 | 0,41 thành 0,85 | 0,30 thành 0,90 |
| umlaut | 11 | 0,82 thành 1,00 | 0,82 thành 1,00 | 0,82 thành 1,00 | 0,71 thành 0,96 | 0,68 thành 0,95 |
| compound | 16 | 0,38 thành 1,00 | 0,38 thành 1,00 | 0,38 thành 1,00 | 0,36 thành 1,00 | 0,38 thành 1,00 |
| alias | 2 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 |
| stopword | 1 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 0,83 thành 1,00 | 1,00 thành 1,00 |
| control | 3 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 | 1,00 thành 1,00 |

Không nhóm nào thấp hơn. 14 câu trượt Hit@5 khi không gói (eszett-01, eszett-04, umlaut-06, umlaut-08, compound-01/02/03/05/06/07/08/09/10/12) đều tìm thấy khi có gói; còn lại không câu nào trượt. Hit@1 của nhóm eszett vẫn 0,60 vì hai note cùng khớp và note phụ `stau.md` (có `Straßenverkehr`) xếp trên; đó là kết quả đúng của việc tách từ ghép chứ không phải lỗi.

Giới hạn: golden set do chính người viết gói tạo từ cùng hiểu biết với lexicon, nên là kiểm hợp đồng và hồi quy, không phải đo chất lượng thật trên tiếng Đức ngoài đời.

## Về hợp đồng P01 (G9)

Không cần sửa lõi. Những điểm hợp đồng đủ dùng cho một ngôn ngữ khác tiếng Việt: view và tokenizer riêng, quy tắc token tiếp nối cho tách từ ghép, alias view, `analyzeQuery` trả nhiều từ để OR, `explain` trả nhánh `view:de`.
