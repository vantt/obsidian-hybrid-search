# Bộ eval tiếng Việt (V10)

Bộ câu hỏi vàng (golden set) và vault mẫu để đo chất lượng tìm tiếng Việt, theo PRD mục 11.3 và 11.5. Chạy bằng eval sẵn có của upstream (`eval/evaluate.ts`), không sửa file nào của upstream.

## Thành phần

| Đường dẫn | Nội dung |
|---|---|
| `golden-set.json` | 255 câu = 17 hạng mục × 15 câu, đúng định dạng upstream `{id, query, relevant_paths, partial_paths, category, notes}`. Mỗi câu có đúng một note đúng. `vi-unaccented` và `vi-dd` có thêm `query_accented` (cùng câu, có dấu). Hạng `vi-snippet` có thêm `snippet_contains` và `matched_terms` (upstream bỏ qua, cổng chất lượng sẽ dùng) |
| `smoke-golden-set.json`, `smoke-vault/` | 10 note viết tay (có alias, note không dấu, note CRLF, note NFD, `_ohs/lexicon.md`) và 16 câu phủ gần hết hạng mục; chạy nhanh để thử máy |
| `run-eval.mjs` | Dựng corpus trong thư mục tạm, chạy eval, ghi kết quả |
| `../baselines/linux-x64/0.17.2.vi-search.json` | Baseline: upstream `0.17.2`, không gói ngôn ngữ, corpus sinh |
| `../baselines/linux-x64/0.17.2.smoke.json` | Baseline của smoke-vault |

Corpus lớn không nằm trong repo này: nó do preset `vi-search` của [vantt/obsidian-test-fixture](https://github.com/vantt/obsidian-test-fixture) sinh ra (363 note + `_ohs/lexicon.md`, xác định theo `--seed`, chỉ có văn bản sinh). `run-eval.mjs` ghim thẻ `v0.10.0` của fixture và từ chối chạy nếu `golden-set.json` không khớp với bộ câu hỏi mà thẻ đó sinh ra. Lexicon mẫu theo định dạng PRD Q8 (ba mục `## Đồng nghĩa`, `## Viết tắt`, `## Từ ghép`; mục `## Chờ duyệt` không được dùng).

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

### Đo bản OHS khác và gói ngôn ngữ (V12, V13)

```bash
# Bản build của nhánh phát hành (worktree), có gói ngôn ngữ, ghi kết quả
node vantt/eval/vi/run-eval.mjs --ohs <thư mục OHS> --lang-pack <module hoặc đường dẫn> \
  [--lang-options '<json>'] --out /đường/dẫn/ngoài/tmp/a.json

# So hai lần chạy (b trừ a): bảng theo hạng mục, thêm file JSON nếu có --out
node vantt/eval/vi/run-eval.mjs --compare vantt/eval/baselines/linux-x64/0.17.2.vi-search.json a.json --out diff.json

# Kiểm tra với dấu đã phục hồi: câu của vi-unaccented và vi-dd viết lại có dấu (trường query_accented), mong Hit@5 = 1
node vantt/eval/vi/run-eval.mjs --accented-sanity
```

- `--ohs <thư mục>`: chạy `eval/evaluate.ts` của thư mục đó (cần `eval/evaluate.ts`, `node_modules` và nguồn đã nạp được bằng `tsx`) thay cho cây đang đứng. Mặc định là cây chứa script này. Dùng được với worktree của nhánh có bản vá P01.
- `--lang-pack <tên module hoặc đường dẫn>` đặt `OHS_LANGUAGE_PACK` (đường dẫn thì đổi thành tuyệt đối); `--lang-options <json>` đặt `OHS_LANGUAGE_PACK_OPTIONS` (JSON hỏng thì dừng ngay). Tên cấu hình đúng như bản vá `vantt/patches/0001-language-pack-api.spec.md` mục 2. Hai biến này luôn bị xoá khỏi môi trường nếu không truyền cờ, nên lần chạy "không gói" sạch. Gói phải nạp được từ cây `--ohs` (module theo tên thì phải cài ở đó; đường dẫn tuyệt đối thì không cần). Gói lỗi thì OHS chạy như không gói (xem `status.language_pack.error`), nên so với baseline để phát hiện.
- Kết quả JSON có thêm `meta.runner` (`ohs_tree`, `ohs_head`, `lang_pack`, `lang_options`, `corpus`, `accented_sanity`) để biết hai file so được với nhau không.
- `--compare a.json b.json`: không chạy gì, chỉ so (nDCG@5, MRR, Hit@1, Hit@3, Hit@5, Recall@k) và liệt kê các câu đổi Hit@5. Cùng corpus và cùng model mới so được.
- `--baseline` từ chối chạy cùng `--ohs` hoặc `--lang-pack`: baseline luôn là upstream không gói ở cây này. Kiểm đã làm: `--ohs` trỏ worktree P01 không gói cho kết quả giống từng câu với baseline; gói giả `lang-upper` đổi kết quả (chứng tỏ gói được nạp).
- Đừng đặt vault tạm, worktree hay log lớn dưới `/tmp`; đặt `TMPDIR` sang thư mục khác (script dựng vault ở `os.tmpdir()`).

Script làm hộ những việc sau, nên tự gõ lệnh tay thì phải làm đủ:

- Vault luôn là bản sao trong thư mục tạm, xoá khi xong: eval của upstream ghi DB vào thư mục vault và dựng lại toàn bộ.
- `OBSIDIAN_IGNORE_PATTERNS=.obsidian/**,templates/**,*.canvas,_ohs/**` để file lexicon không thành kết quả tìm.
- Bỏ `OPENAI_*` và `LOCAL_EMBEDDING_MODEL` khỏi môi trường, dùng model nhúng cục bộ mặc định.
- Gọi `node --import tsx eval/evaluate.ts ...` (đúng thứ `npm run eval` chạy) vì `npm run` từ chối npm khác `devEngines` (`12.2.0`) của upstream; `npm run eval -- --vault <thư mục> --golden-set vantt/eval/vi/golden-set.json` cũng được nếu máy có npm đúng bản.
- **Đường dẫn trong golden set ở dạng NFD.** Upstream lưu đường dẫn note ở dạng NFD (`src/content/text-normalization.ts`) và eval so chuỗi nguyên văn, nên đường dẫn NFC (tên file thật của fixture) cho điểm 0 dù xếp đúng. `run-eval.mjs` đổi NFC sang NFD khi đối chiếu. Câu hỏi (`query`) giữ NFC.

## Hạng mục

Mỗi hạng 15 câu (`vi-unaccented` và `vi-dd` mỗi hạng thêm 10 note mồi); bảng dưới là nội dung phép thử (PRD 11.5).

| `category` | Phép thử |
|---|---|
| `vi-accented`, `vi-partial-accent` | cùng 15 cụm từ: đủ dấu, hoặc chỉ giữ dấu ở từ đầu |
| `vi-unaccented` | 15 tên món ăn bỏ hết dấu. Vault có 25 note cùng một khuôn chữ, chỉ khác tên món; tiêu đề chỉ có số thứ tự. Mọi âm tiết của tên món có dấu mũ/móc/trăng cộng dấu thanh (`nước mắm`), loại dấu chồng mà FTS5 `unicode61` không gộp. Mục có `query_accented` |
| `vi-telex`, `vi-typo` | cùng 15 cụm từ: gõ Telex chưa bỏ dấu (`giuwx chaan khachs hangf`), hoặc không dấu và đảo hai chữ cuối của hai từ |
| `vi-snippet` | hai từ giữa của cụm, không dấu; đoạn trích phải là chữ gốc có dấu và chứa chỗ khớp |
| `vi-dd` | 15 tên phố có `đ`, gõ `d`; 25 note cùng khuôn chữ chỉ khác tên phố, tiêu đề chỉ có số; mục có `query_accented` |
| `vi-iy` | note viết `kỹ`, câu hỏi viết `kĩ` và ngược lại |
| `vi-tone-placement` | note viết `hòa`, câu hỏi viết `hoà` và ngược lại |
| `vi-tone-precision` | "bán hàng" không được để note "bạn hàng" đứng trên (15 cặp sai khác một dấu thanh) |
| `vi-compound` | "học sinh" không được để note "sinh học" đứng trên; tiêu đề note không chứa cụm, chỉ phần thân phân biệt |
| `vi-mixed-en` | note tiếng Việt xen từ tiếng Anh; câu hỏi hoặc giữ từ Anh, hoặc dịch qua lại |
| `vi-semantic` | diễn đạt lại ý, không trùng từ nội dung nào với note |
| `vi-names` | tên người hư cấu (mỗi tên có một tên gần giống làm mồi) và địa danh, có dấu hoặc không dấu |
| `vi-synonym`, `vi-abbr` | câu hỏi dùng dạng khác trong `_ohs/lexicon.md` so với dạng trong note |
| `vi-alias` | câu hỏi (không dấu) chỉ khớp alias ở front matter; tiêu đề và thân note là tiếng Anh |

Khi build corpus, preset tự kiểm: cụm của mỗi câu chỉ xuất hiện đúng ở note đúng; dạng chính tả phía câu hỏi (`kĩ`, `hoà`) và chữ viết tắt không xuất hiện ở đâu trong vault. Với `vi-unaccented` và `vi-dd` nó còn kiểm câu đã bỏ dấu chỉ nằm trong đúng note đích. Nên bộ câu hỏi không thể lệch khỏi corpus.

## Baseline (upstream 0.17.2, không gói, linux-x64, Node 24, e5-small, k=10)

363 note, 255 câu: nDCG@5 0,666; nDCG@10 0,686; MRR 0,643; Hit@1 0,557; Hit@3 0,702; Hit@5 0,761; Recall@10 0,824. Chạy hai lần cho `top_paths` giống hệt nhau.

| Hạng mục | nDCG@5 | MRR | Hit@1 | Hit@5 |
|---|---|---|---|---|
| `vi-accented` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-partial-accent` | 0,872 | 0,830 | 0,73 | 1,00 |
| `vi-telex` | 0,333 | 0,298 | 0,20 | 0,47 |
| `vi-typo` | 0,488 | 0,426 | 0,20 | 0,73 |
| `vi-snippet` | 0,463 | 0,437 | 0,33 | 0,60 |
| `vi-unaccented` | 0,133 | 0,089 | 0,00 | 0,27 |
| `vi-dd` | 0,263 | 0,240 | 0,13 | 0,40 |
| `vi-iy` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-tone-placement` | 1,000 | 1,000 | 1,00 | 1,00 |
| `vi-tone-precision` | 0,951 | 0,933 | 0,87 | 1,00 |
| `vi-compound` | 0,844 | 0,789 | 0,60 | 1,00 |
| `vi-mixed-en` | 0,975 | 0,967 | 0,93 | 1,00 |
| `vi-semantic` | 0,555 | 0,509 | 0,33 | 0,73 |
| `vi-names` | 0,909 | 0,911 | 0,87 | 0,93 |
| `vi-synonym` | 0,067 | 0,076 | 0,00 | 0,13 |
| `vi-abbr` | 0,933 | 0,940 | 0,93 | 0,93 |
| `vi-alias` | 0,535 | 0,478 | 0,33 | 0,73 |

Nhận xét cho các mục tiêu ở PRD 11.6:

- `vi-iy`, `vi-tone-placement`, `vi-accented` đã 1,000 ở upstream (gói chỉ được giữ nguyên, không có chỗ để hơn).
- `vi-compound` còn 0,156 nDCG@5 để hơn (mục tiêu G8: hơn baseline tối thiểu 0,1, tức đạt 0,944 trở lên).
- `vi-synonym` Hit@5 0,13 so với mục tiêu 0,8; `vi-telex` 0,47, `vi-typo` 0,73, `vi-alias` 0,73, `vi-abbr` 0,93 (mục tiêu G8 cho `vi-telex`, `vi-typo`, `vi-synonym`, `vi-alias`: Hit@5 ≥ 0,8; `vi-abbr` đã đạt).
- G3 (`vi-unaccented`, `vi-dd` Hit@5 ≥ 0,85 *và* gấp 2 lần baseline): baseline 0,27 và 0,40, nên cần ≥ 0,85 cho cả hai (0,40 × 2 = 0,80 < 0,85). Corpus bản đầu (0,93 và 0,87) làm điều này bất khả vì tiêu đề note chứa nguyên cụm tìm và nhánh vector đã đủ; từ fixture `v0.10.0` mỗi câu là một trong 25 note cùng khuôn chữ, chỉ khác một từ khoá, tiêu đề không lộ. Kiểm đạt được: với dấu phục hồi (`--accented-sanity`) cả hai hạng đạt Hit@5 = 1,00 (nDCG@5 0,832), nên 0,85 trở lên là đạt được bằng khớp chữ gộp dấu.
- Vì sao upstream trượt: FTS5 `unicode61` chỉ gộp dấu khi chữ có đúng một dấu (`ú`, `ê`); chữ có hai dấu (`ế`, `ữ`, `ợ`, `ặ`) và `đ` không bao giờ gộp (đo trực tiếp trên SQLite của upstream, chữ NFC như upstream lưu). Nên hạng 1 trở đi của hai hạng này chỉ do nhánh vector và đoán.

Baseline phụ thuộc nền (ONNX lượng tử cho số khác nhau theo CPU), nên mỗi nền một thư mục; hạ baseline chỉ qua PR có người duyệt (PRD 11.6).

## Ghi chú

- Fixture công khai chỉ chứa văn bản sinh; không có nội dung vault thật hay câu hỏi riêng của user. Golden set riêng trên vault thật (V15) lưu ngoài repo.
- Đổi đầu ra của preset (kể cả một chữ trong note) là đổi golden set: tăng phiên bản minor của fixture, ghi CHANGELOG, đổi `FIXTURE_TAG` trong `run-eval.mjs`, chạy `--update-golden` rồi `--baseline` lại và duyệt số.
