# Bộ eval tiếng Việt (V10)

Bộ câu hỏi vàng (golden set) và vault mẫu để đo chất lượng tìm tiếng Việt, theo PRD mục 11.3 và 11.5. Chạy bằng eval sẵn có của upstream (`eval/evaluate.ts`), không sửa file nào của upstream.

## Thành phần

| Đường dẫn | Nội dung |
|---|---|
| `golden-set.json` | 255 câu = 17 hạng mục × 15 câu, đúng định dạng upstream `{id, query, relevant_paths, partial_paths, category, notes}`. Mỗi câu có đúng một note đúng. Hạng `vi-snippet` có thêm `snippet_contains` và `matched_terms` (upstream bỏ qua, cổng chất lượng sẽ dùng) |
| `smoke-golden-set.json`, `smoke-vault/` | 10 note viết tay (có alias, note không dấu, note CRLF, note NFD, `_ohs/lexicon.md`) và 16 câu phủ gần hết hạng mục; chạy nhanh để thử máy |
| `run-eval.mjs` | Dựng corpus trong thư mục tạm, chạy eval, ghi kết quả |
| `../baselines/linux-x64/0.17.2.vi-search.json` | Baseline: upstream `0.17.2`, không gói ngôn ngữ, corpus sinh |
| `../baselines/linux-x64/0.17.2.smoke.json` | Baseline của smoke-vault |

Corpus lớn không nằm trong repo này: nó do preset `vi-search` của [vantt/obsidian-test-fixture](https://github.com/vantt/obsidian-test-fixture) sinh ra (328 note + `_ohs/lexicon.md`, xác định theo `--seed`, chỉ có văn bản sinh). `run-eval.mjs` ghim thẻ `v0.9.0` của fixture và từ chối chạy nếu `golden-set.json` không khớp với bộ câu hỏi mà thẻ đó sinh ra. Lexicon mẫu theo định dạng PRD Q8 (ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`; mục `## Chờ duyệt` không được dùng).

## Chạy

Cần `npm ci` ở thư mục gốc repo và mạng (lần đầu tải model `Xenova/multilingual-e5-small` về `~/.cache/huggingface/`, và `npx` tải fixture từ GitHub).

```bash
# Corpus sinh, in kết quả tổng hợp (kết quả JSON ở thư mục tạm, đường dẫn in ở dòng cuối)
node vantt/eval/vi/run-eval.mjs

# Ghi kết quả ra file chỉ định
node vantt/eval/vi/run-eval.mjs --out /tmp/vi-result.json

# Smoke-vault (vài giây)
node vantt/eval/vi/run-eval.mjs --smoke

# Ghi baseline: vantt/eval/baselines/<nền>/<phiên bản upstream>.vi-search.json (hoặc .smoke.json)
node vantt/eval/vi/run-eval.mjs --baseline
```

Tuỳ chọn khác: `--k <N>` (mặc định 10), `--rerank`, `--otf <đường dẫn otf.mjs>` (dùng bản fixture đã clone thay cho `npx`), `--update-golden` (ghi lại `golden-set.json` từ bản fixture đang dùng, chỉ khi cố ý đổi bộ câu hỏi).

Script làm hộ những việc sau, nên tự gõ lệnh tay thì phải làm đủ:

- Vault luôn là bản sao trong thư mục tạm, xoá khi xong: eval của upstream ghi DB vào thư mục vault và dựng lại toàn bộ.
- `OBSIDIAN_IGNORE_PATTERNS=.obsidian/**,templates/**,*.canvas,_ohs/**` để file lexicon không thành kết quả tìm.
- Bỏ `OPENAI_*` và `LOCAL_EMBEDDING_MODEL` khỏi môi trường, dùng model nhúng cục bộ mặc định.
- Gọi `node --import tsx eval/evaluate.ts ...` (đúng thứ `npm run eval` chạy) vì `npm run` từ chối npm khác `devEngines` (`12.2.0`) của upstream; `npm run eval -- --vault <thư mục> --golden-set vantt/eval/vi/golden-set.json` cũng được nếu máy có npm đúng bản.
- **Đường dẫn trong golden set ở dạng NFD.** Upstream lưu đường dẫn note ở dạng NFD (`src/content/text-normalization.ts`) và eval so chuỗi nguyên văn, nên đường dẫn NFC (tên file thật của fixture) cho điểm 0 dù xếp đúng. `run-eval.mjs` đổi NFC sang NFD khi đối chiếu. Câu hỏi (`query`) giữ NFC.

## Hạng mục

Mỗi hạng 15 câu; bảng dưới là nội dung phép thử (PRD 11.5).

| `category` | Phép thử |
|---|---|
| `vi-accented`, `vi-unaccented`, `vi-partial-accent` | cùng 15 cụm từ: đủ dấu, bỏ hết dấu, chỉ giữ dấu ở từ đầu |
| `vi-telex`, `vi-typo` | cùng 15 cụm từ: gõ Telex chưa bỏ dấu (`giuwx chaan khachs hangf`), hoặc không dấu và đảo hai chữ cuối của hai từ |
| `vi-snippet` | hai từ giữa của cụm, không dấu; đoạn trích phải là chữ gốc có dấu và chứa chỗ khớp |
| `vi-dd` | cụm có `đ`, gõ `d` |
| `vi-iy` | note viết `kỹ`, câu hỏi viết `kĩ` và ngược lại |
| `vi-tone-placement` | note viết `hòa`, câu hỏi viết `hoà` và ngược lại |
| `vi-tone-precision` | "bán hàng" không được để note "bạn hàng" đứng trên (15 cặp sai khác một dấu thanh) |
| `vi-compound` | "học sinh" không được để note "sinh học" đứng trên; tiêu đề note không chứa cụm, chỉ phần thân phân biệt |
| `vi-mixed-en` | note tiếng Việt xen từ tiếng Anh; câu hỏi hoặc giữ từ Anh, hoặc dịch qua lại |
| `vi-semantic` | diễn đạt lại ý, không trùng từ nội dung nào với note |
| `vi-names` | tên người hư cấu (mỗi tên có một tên gần giống làm mồi) và địa danh, có dấu hoặc không dấu |
| `vi-synonym`, `vi-abbr` | câu hỏi dùng dạng khác trong `_ohs/lexicon.md` so với dạng trong note |
| `vi-alias` | câu hỏi (không dấu) chỉ khớp alias ở front matter; tiêu đề và thân note là tiếng Anh |

Khi build corpus, preset tự kiểm: cụm của mỗi câu chỉ xuất hiện đúng ở note đúng; dạng chính tả phía câu hỏi (`kĩ`, `hoà`) và chữ viết tắt không xuất hiện ở đâu trong vault. Nên bộ câu hỏi không thể lệch khỏi corpus.

## Baseline (upstream 0.17.2, không gói, linux-x64, Node 24, e5-small, k=10)

328 note, 255 câu: nDCG@5 0,737; nDCG@10 0,753; MRR 0,713; Hit@1 0,627; Hit@3 0,780; Hit@5 0,827; Recall@10 0,878. Chạy hai lần cho `top_paths` và điểm giống hệt nhau.

| Hạng mục | nDCG@5 | MRR | Hit@1 | Hit@5 |
|---|---|---|---|---|
| `vi-accented` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-unaccented` | 0,784 | 0,742 | 0,60 | 0,93 |
| `vi-partial-accent` | 0,851 | 0,800 | 0,67 | 1,00 |
| `vi-telex` | 0,401 | 0,358 | 0,27 | 0,53 |
| `vi-typo` | 0,572 | 0,534 | 0,33 | 0,73 |
| `vi-snippet` | 0,497 | 0,489 | 0,40 | 0,60 |
| `vi-dd` | 0,717 | 0,667 | 0,53 | 0,87 |
| `vi-iy` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-tone-placement` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-tone-precision` | 0,975 | 0,967 | 0,93 | 1,00 |
| `vi-compound` | 0,855 | 0,806 | 0,67 | 1,00 |
| `vi-mixed-en` | 0,975 | 0,967 | 0,93 | 1,00 |
| `vi-semantic` | 0,543 | 0,488 | 0,33 | 0,73 |
| `vi-names` | 0,846 | 0,823 | 0,73 | 0,93 |
| `vi-synonym` | 0,095 | 0,101 | 0,07 | 0,13 |
| `vi-abbr` | 0,933 | 0,940 | 0,93 | 0,93 |
| `vi-alias` | 0,484 | 0,442 | 0,27 | 0,67 |

Nhận xét cho các mục tiêu ở PRD 11.6:

- `vi-iy`, `vi-tone-placement`, `vi-accented` đã 1,000 ở upstream (gói chỉ được giữ nguyên, không có chỗ để hơn).
- `vi-compound` còn 0,145 nDCG@5 để hơn (mục tiêu G8: hơn baseline tối thiểu 0,1, tức đạt 0,955 trở lên).
- `vi-synonym` Hit@5 0,13 so với mục tiêu 0,8; `vi-telex` 0,53, `vi-typo` 0,73, `vi-alias` 0,67, `vi-abbr` 0,93 (mục tiêu G8 cho `vi-telex`, `vi-typo`, `vi-synonym`, `vi-alias`: Hit@5 ≥ 0,8; `vi-abbr` đã đạt).
- `vi-unaccented` Hit@5 0,93 và `vi-dd` 0,87: mục tiêu G3 là Hit@5 ≥ 0,85 *và* gấp 2 lần baseline; với Hit@5 đã cao ở baseline, điều kiện "gấp 2 lần" không thể đạt trên corpus này (Hit@1 0,60 và 0,53 mới có chỗ). Điều chỉnh điều kiện G3 sang Hit@1 là việc của người quyết PRD, chưa đổi ở đây.

Baseline phụ thuộc nền (ONNX lượng tử cho số khác nhau theo CPU), nên mỗi nền một thư mục; hạ baseline chỉ qua PR có người duyệt (PRD 11.6).

## Ghi chú

- Fixture công khai chỉ chứa văn bản sinh; không có nội dung vault thật hay câu hỏi riêng của user. Golden set riêng trên vault thật (V15) lưu ngoài repo.
- Đổi đầu ra của preset (kể cả một chữ trong note) là đổi golden set: tăng phiên bản minor của fixture, ghi CHANGELOG, đổi `FIXTURE_TAG` trong `run-eval.mjs`, chạy `--update-golden` rồi `--baseline` lại và duyệt số.
