# Eval nhánh nghĩa (V22): model nhúng, `restoreForEmbedding`, reranker

Ngày đo: 2026-11-02. Việc V22 của PRD (mục 2.1 G10, mục 15 Q3). Kết quả là đề xuất cho bộ cài dự án; lõi không đổi model mặc định của upstream.

## 1. Kết luận và đề xuất

| Quyết định                                     | Đề xuất                                                                                                  | Lý do ngắn                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q3, `restoreForEmbedding`                      | **Bật** (mặc định `true` trong cấu hình bộ cài; đổi mặc định của gói sau khi sửa lỗi ở mục 5.1)          | nDCG@5 tổng +0,005 đến +0,018 ở cả 5 cấu hình model; `vi-snippet`, `vi-dd` tăng nhiều nhất. Mất 1 câu (`Hội An`, mục 5.1) ở mọi model, nguyên nhân nằm ở gói, sửa được                                                                                                |
| Reranker đa ngữ                                | **Tắt mặc định**, để người dùng bật khi cần                                                              | Cộng 0,000 đến 0,006 nDCG@5 tổng (cả bộ), nhưng +148 ms mỗi câu (gấp 8 đến 16 lần), +616 MB tải, +150 đến 900 MB RAM (1,5 GB với halong fp32). Có ích cho câu hỏi theo nghĩa (`vi-semantic` +0,05 đến +0,10)                                                          |
| Model nhúng, hồ sơ mặc định                    | **Giữ `Xenova/multilingual-e5-small`** (mặc định của upstream)                                           | Trên bộ này với gói đầy đủ và `restoreForEmbedding` bật, 5 cấu hình model nằm trong khoảng 0,947 đến 0,952 nDCG@5 khi tắt rerank (chênh lệch vài câu, nhỏ hơn nhiễu của bộ 255 câu); e5-small rẻ nhất: 129 MB, index 2 phút cho 2.000 note (chặn trên), 10 ms mỗi câu |
| Model nhúng, hồ sơ "chất lượng cao" (tuỳ chọn) | **`Xenova/bge-m3`** (MIT, có ONNX chính thức) cho người dùng nhiều `zones` và `related`, máy từ 4 GB RAM | Tách cặp gần nghĩa tốt nhất trong các model có ONNX chính thức (AUC 0,968 so với 0,850 của e5-small); `vi-synonym` chỉ dùng nhánh nghĩa: Hit@5 0,73 so với 0,13. Chi phí: 560 MB tải, 1,2 GB RAM, index chậm gấp 8 lần                                                |
| Model chuyên tiếng Việt                        | `contextboxai/halong_embedding` (Apache-2.0) chạy được, **chưa đề xuất làm hồ sơ chính**                 | Tách cặp tốt (khoảng cách 0,27 đến 0,32), nhưng upstream không có ONNX; bản int8 tự xuất mất độ trung thực (cosine 0,91 đến 0,94 so với fp32), bản fp32 nặng 1,07 GB và 3,6 GB RAM khi kèm reranker. Không hơn bge-m3 đủ để bù chi phí tự lưu ONNX                    |

Điều kiện: số liệu đo trên **corpus sinh** (363 note, ngắn, 255 câu, chỉ 15 câu `vi-semantic` và 15 câu `vi-synonym`). Chưa nên đổi mặc định nào của người dùng thật trước khi chạy lại trên vault thật bằng `vantt/scripts/quality-gate.mjs --private` (PRD 11.5, nguồn 2), nhất là model nhúng và reranker.

## 2. Cách đo

- **Script:** `vantt/scripts/semantic-eval.mjs` (điều phối, không phụ thuộc gói ngoài), `vantt/scripts/lib/semantic-worker.mjs` (từng bước, chạy trong cây OHS bằng tsx), `vantt/scripts/lib/semantic-export-onnx.py` (xuất ONNX cho model chưa có). Lệnh tái hiện ở mục 8.
- **Phần mềm:** OHS cây `vantt/work/series` (`4c69fbf`, loạt bản vá hiện có; không sửa lõi), gói `ohs-lang-vi` 0.2.0 dựng từ `master` ở `e3e7eb0` với tuỳ chọn mặc định (có view `seg` và lexicon; chữ ký `0.2.0;tone=modern;iy=0;seg=ae1dbec912c2`). Node 24.21.
- **Corpus:** `vi-search@v0.10.0` của obsidian-test-fixture: 363 note (mỗi note một chunk), 255 câu, 17 hạng mục, đúng `vantt/eval/vi/golden-set.json`. Không dùng vault thật.
- **Máy:** Intel i7-13700F (24 luồng), Linux; **ép ONNX 4 luồng** (`inference-settings.json`) để mô phỏng máy 4 nhân. Máy dùng chung, tải trung bình lúc đo 3 đến 8, nên thời gian có sai số khoảng ±30%. Mọi thứ (cache model, DB, log) nằm dưới `/home/vantt/projects/ohs-wt/tmp/v22`, không đụng `~/.cache`.
- **Quy trình:** mỗi model index **một lần** (DB riêng qua `OBSIDIAN_DB_PATH`). Với mỗi giá trị `restoreForEmbedding` chạy một tiến trình tìm (tuỳ chọn gói cố định theo tiến trình), trong đó chạy rerank tắt rồi bật trên cùng index. Thứ hạng lấy từ lần chạy đầu; thời gian mỗi câu và RAM lấy giá trị lớn hơn của 2 lần chạy. Chỉ số nDCG@5, Hit@5 tính bằng `buildPerQueryResult` của eval upstream. Thời gian index và đo chunk 350 từ là một lần chạy.
- **Model (giấy phép):**

| Id          | Model                                           | Giấy phép                    | Ghi chú                                                                                                   |
| ----------- | ----------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| e5-small    | `Xenova/multilingual-e5-small`                  | MIT (gốc intfloat)           | mặc định upstream, 384 chiều, q8                                                                          |
| e5-base     | `Xenova/multilingual-e5-base`                   | MIT (gốc intfloat)           | 768 chiều, q8                                                                                             |
| bge-m3      | `Xenova/bge-m3`                                 | MIT                          | 1024 chiều, q8. OHS luôn gộp trung bình (mean pooling) dù bge-m3 huấn luyện với CLS; đo đúng như OHS chạy |
| halong      | `contextboxai/halong_embedding`                 | Apache-2.0                   | tinh chỉnh tiếng Việt từ multilingual-e5-base, 768 chiều. Upstream không có ONNX nên tự xuất, int8        |
| halong-fp32 | cùng model                                      | Apache-2.0                   | cùng model, đồ thị fp32 để thấy chất lượng gốc                                                            |
| Reranker    | `onnx-community/gte-multilingual-reranker-base` | Apache-2.0 (gốc Alibaba-NLP) | mặc định của OHS                                                                                          |

Ứng viên tiếng Việt đã xét: `AITeamVN/Vietnamese_Embedding` (Apache-2.0, tinh chỉnh từ bge-m3, có ONNX fp32 2,3 GB, nhưng cùng cỡ bge-m3 và dùng CLS), `dangvantuan/vietnamese-embedding` và `bkai-foundation-models/vietnamese-bi-encoder` (PhoBERT, cần tách từ trước bằng pyvi, không chạy được trong transformers.js), các bản ONNX của bên thứ ba cho halong (ít người dùng, không rõ nguồn). Chọn halong vì đúng cỡ e5-base, dùng gộp trung bình như OHS, không tiền tố, giấy phép rõ.

**Bản xuất halong:** `torch.onnx.export` (opset 17, attention `eager`), tiền xử lý rồi lượng tử hoá động int8. Cosine giữa embedding q8 và torch fp32 trên 4 câu mẫu: 0,91 đến 0,94; so sánh, q8 của Xenova cho e5-base so với fp32 của chính nó: 0,98 đến 0,99. Bản halong int8 vì thế bị thiệt một chút; `halong-fp32` cho chất lượng gốc. Đã thử đủ cách (uint8, per-channel, bỏ lớp FFN) nhưng không tìm ra công thức đạt 0,98 mà vẫn nhanh.

## 3. Kết quả chất lượng

### 3.1. Tổng thể (255 câu)

| Model         | `restoreForEmbedding` | rerank | nDCG@5    | Hit@5 | Hit@1 | MRR   |
| ------------- | --------------------- | ------ | --------- | ----- | ----- | ----- |
| e5-small      | tắt                   | tắt    | 0,932     | 0,976 | 0,882 | 0,920 |
| e5-small      | **bật**               | tắt    | **0,950** | 0,980 | 0,918 | 0,940 |
| e5-small      | tắt                   | bật    | 0,938     | 0,984 | 0,886 | 0,924 |
| e5-small      | bật                   | bật    | 0,950     | 0,984 | 0,914 | 0,941 |
| e5-base       | tắt                   | tắt    | 0,942     | 0,976 | 0,902 | 0,933 |
| e5-base       | bật                   | tắt    | 0,947     | 0,973 | 0,918 | 0,942 |
| e5-base       | tắt                   | bật    | 0,946     | 0,976 | 0,910 | 0,939 |
| e5-base       | bật                   | bật    | 0,953     | 0,973 | 0,929 | 0,950 |
| bge-m3        | tắt                   | tắt    | 0,942     | 0,980 | 0,894 | 0,930 |
| bge-m3        | bật                   | tắt    | 0,948     | 0,976 | 0,914 | 0,939 |
| bge-m3        | tắt                   | bật    | 0,944     | 0,988 | 0,890 | 0,931 |
| bge-m3        | bật                   | bật    | 0,951     | 0,984 | 0,914 | 0,942 |
| halong (int8) | tắt                   | tắt    | 0,940     | 0,984 | 0,882 | 0,926 |
| halong (int8) | bật                   | tắt    | 0,948     | 0,980 | 0,906 | 0,938 |
| halong (int8) | tắt                   | bật    | 0,942     | 0,984 | 0,882 | 0,929 |
| halong (int8) | bật                   | bật    | 0,953     | 0,980 | 0,914 | 0,945 |
| halong-fp32   | tắt                   | tắt    | 0,947     | 0,984 | 0,898 | 0,935 |
| halong-fp32   | bật                   | tắt    | 0,952     | 0,980 | 0,918 | 0,943 |
| halong-fp32   | tắt                   | bật    | 0,949     | 0,984 | 0,898 | 0,938 |
| halong-fp32   | bật                   | bật    | 0,956     | 0,980 | 0,922 | 0,949 |

Một câu = 0,004 Hit@5 và khoảng 0,004 nDCG@5 trung bình; mọi chênh lệch giữa các model dưới 0,01 nDCG@5 (khi bật `restoreForEmbedding`) chỉ là vài câu và không đủ để kết luận có model nào hơn.

### 3.2. Theo hạng mục: nDCG@5, rerank tắt (`restoreForEmbedding` tắt → bật; một số nếu không đổi)

| Hạng mục                                                                                                                                | e5-small      | e5-base       | bge-m3        | halong int8   | halong fp32   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------- | ------------- | ------------- |
| `vi-accented`, `vi-partial-accent`, `vi-telex`, `vi-iy`, `vi-tone-placement`, `vi-tone-precision`, `vi-compound`, `vi-abbr`, `vi-alias` | 1,000         | 1,000         | 1,000         | 1,000         | 1,000         |
| `vi-mixed-en`                                                                                                                           | 0,975         | 1,000         | 1,000         | 1,000         | 1,000         |
| `vi-typo`                                                                                                                               | 0,975 → 1,000 | 0,975 → 1,000 | 0,967 → 1,000 | 0,975 → 1,000 | 0,975 → 1,000 |
| `vi-snippet`                                                                                                                            | 0,777 → 0,975 | 0,884 → 0,937 | 0,885 → 0,942 | 0,855 → 0,913 | 0,893 → 0,904 |
| `vi-unaccented`                                                                                                                         | 0,951 → 1,000 | 0,962 → 1,000 | 1,000         | 0,975 → 1,000 | 0,967 → 1,000 |
| `vi-dd`                                                                                                                                 | 0,888 → 0,975 | 0,929 → 0,975 | 0,902 → 0,975 | 0,852 → 0,951 | 0,864 → 0,951 |
| `vi-names`                                                                                                                              | 1,000 → 0,933 | 0,975 → 0,909 | 1,000 → 0,933 | 0,975 → 0,909 | 0,975 → 0,909 |
| `vi-semantic`                                                                                                                           | 0,555         | 0,584         | 0,555         | 0,613         | 0,604         |
| `vi-synonym`                                                                                                                            | 0,729         | 0,701         | 0,707         | 0,732         | 0,819         |

Dòng đầu gộp các hạng mục không đổi theo mọi biến thể và mọi model. `vi-mixed-en` của e5-small là 0,975 ở cả hai giá trị `restoreForEmbedding`.

Hit@5 mọi hạng mục đạt 1,00 trừ: `vi-semantic` (0,73 đến 0,80), `vi-synonym` (0,87 đến 1,00), `vi-names` khi bật `restoreForEmbedding` (0,933), `vi-snippet` của e5-small khi tắt (0,93).

### 3.3. Tập chỉ nhánh nghĩa (30 câu `vi-semantic` + `vi-synonym`) và 225 câu còn lại, `restoreForEmbedding` bật

| Model       | 30 câu nghĩa: nDCG@5 (rerank tắt → bật) | 30 câu nghĩa: Hit@5 (tắt → bật) | 225 câu còn lại: nDCG@5 (tắt → bật) |
| ----------- | --------------------------------------- | ------------------------------- | ----------------------------------- |
| e5-small    | 0,642 → 0,673                           | 0,867 → 0,900                   | 0,991 → 0,987                       |
| e5-base     | 0,642 → 0,692                           | 0,800 → 0,800                   | 0,988 → 0,988                       |
| bge-m3      | 0,631 → 0,673                           | 0,833 → 0,900                   | 0,990 → 0,988                       |
| halong int8 | 0,672 → 0,712                           | 0,867 → 0,867                   | 0,985 → 0,985                       |
| halong fp32 | 0,711 → 0,743                           | 0,867 → 0,867                   | 0,984 → 0,984                       |

Trong hạng mục `vi-synonym`, gói đã mở rộng truy vấn theo lexicon (`_ohs/lexicon.md`), nên kết quả lai gần như không phụ thuộc model. Nhánh nghĩa một mình thì khác (mục 4).

### 3.4. Tác động của `restoreForEmbedding`

Chỉ ảnh hưởng embedding của câu hỏi (không vào index, không vào `signature()`), nên một index phục vụ cả hai giá trị. Chỉ thay đổi kết quả của câu viết không dấu hoặc dấu một phần.

| Model       | nDCG@5 tắt → bật       | Hit@5 tắt → bật | Câu đổi Hit@5                                  |
| ----------- | ---------------------- | --------------- | ---------------------------------------------- |
| e5-small    | 0,932 → 0,950 (+0,018) | 0,976 → 0,980   | +2 (`vi-snippet`), −1 (`vi-names-15` "Hội An") |
| e5-base     | 0,942 → 0,947 (+0,005) | 0,976 → 0,973   | −1 (`Hội An`)                                  |
| bge-m3      | 0,942 → 0,948 (+0,006) | 0,980 → 0,976   | −1 (`Hội An`)                                  |
| halong int8 | 0,940 → 0,948 (+0,008) | 0,984 → 0,980   | −1 (`Hội An`)                                  |
| halong fp32 | 0,947 → 0,952 (+0,005) | 0,984 → 0,980   | −1 (`Hội An`)                                  |

Model nhỏ hưởng nhiều nhất (e5-small +0,018); khi tắt, e5-small có `vi-snippet` thấp nhất (0,777). Với `vi-snippet`, `vi-dd`: tăng 0,02 đến 0,2 nDCG@5 hạng mục. Độ trễ không đổi (câu chỉ thêm một lần phục hồi dấu bằng bảng từ vựng).

## 4. Tách cặp gần nghĩa thật với cặp nhiễu

Hai phép đo trên vector (cosine), dùng cho `zones`, `related` (độ giống giữa vector):

- `lexicon_phrases`: 41 cặp thật (mọi cặp cùng nhóm trong mục `## Đồng nghĩa` của lexicon mẫu, vd "xe hơi" và "ô tô") và 862 cặp nhiễu (cặp khác nhóm).
- `query_note_*`: vector câu hỏi của 15 câu `vi-semantic` (diễn đạt lại ý) hoặc 15 câu `vi-synonym` so với vector note đúng (cặp thật) và mọi note khác (5.430 cặp nhiễu), lấy vector chunk đã lưu trong DB. Thêm "dense-only Hit": tìm chỉ bằng cosine, không BM25.

AUC = xác suất cặp thật có cosine cao hơn cặp nhiễu. Khoảng cách (gap) = trung bình thật trừ trung bình nhiễu; Cohen d = gap chia độ lệch chuẩn gộp.

| Model       | Cặp           | trung bình thật / nhiễu | gap   | Cohen d | AUC       | dense-only Hit@1 | dense-only Hit@5 |
| ----------- | ------------- | ----------------------- | ----- | ------- | --------- | ---------------- | ---------------- |
| e5-small    | lexicon       | 0,887 / 0,840           | 0,046 | 1,48    | 0,850     |                  |                  |
| e5-small    | `vi-semantic` | 0,859 / 0,809           | 0,050 | 2,61    | 0,975     | 0,60             | 0,80             |
| e5-small    | `vi-synonym`  | 0,809 / 0,786           | 0,024 | 1,03    | 0,762     | 0,00             | 0,13             |
| e5-base     | lexicon       | 0,877 / 0,828           | 0,049 | 1,28    | 0,810     |                  |                  |
| e5-base     | `vi-semantic` | 0,825 / 0,773           | 0,052 | 3,06    | 0,984     | 0,87             | 0,87             |
| e5-base     | `vi-synonym`  | 0,791 / 0,762           | 0,029 | 1,35    | 0,823     | 0,13             | 0,40             |
| bge-m3      | lexicon       | 0,801 / 0,606           | 0,196 | 2,74    | **0,968** |                  |                  |
| bge-m3      | `vi-semantic` | 0,780 / 0,650           | 0,130 | 3,56    | **0,997** | 0,80             | 0,87             |
| bge-m3      | `vi-synonym`  | 0,626 / 0,546           | 0,081 | 1,65    | 0,872     | 0,47             | 0,73             |
| halong int8 | lexicon       | 0,558 / 0,287           | 0,271 | 2,05    | 0,924     |                  |                  |
| halong int8 | `vi-semantic` | 0,417 / 0,173           | 0,244 | 3,38    | 0,981     | 0,93             | 0,93             |
| halong int8 | `vi-synonym`  | 0,271 / 0,134           | 0,137 | 2,04    | 0,911     | 0,27             | 0,53             |
| halong fp32 | lexicon       | 0,590 / 0,266           | 0,324 | 2,28    | 0,941     |                  |                  |
| halong fp32 | `vi-semantic` | 0,415 / 0,144           | 0,271 | 3,69    | 0,988     | 0,93             | 0,93             |
| halong fp32 | `vi-synonym`  | 0,270 / 0,114           | 0,156 | 2,23    | 0,926     | 0,33             | 0,67             |

Nhận xét:

- e5 dồn cosine vào khoảng hẹp 0,76 đến 0,89 (cặp nhiễu cũng cao 0,84): khoảng cách 0,05, nên mọi ngưỡng cosine cố định cho `related` và `zones` sẽ mong manh và phải hiệu chỉnh theo model. bge-m3 và halong dàn cosine rộng hơn (nhiễu 0,55 đến 0,65 và 0,13 đến 0,29), ngưỡng bền hơn.
- Xếp hạng theo AUC trên cặp lexicon: bge-m3 (0,968) > halong fp32 (0,941) > halong int8 (0,924) > e5-small (0,850) > e5-base (0,810). e5-base không hơn e5-small ở cặp từ.
- Với câu diễn đạt lại ý (`vi-semantic`) mọi model xếp tốt (AUC 0,975 đến 0,997): phần khó là xếp **đứng đầu**, nơi halong dẫn (dense-only Hit@5 0,93).
- Từ đồng nghĩa đơn lẻ (`vi-synonym`) là chỗ nhánh nghĩa yếu nhất: e5-small gần như không thấy (Hit@5 0,13); bge-m3 0,73. Lexicon trong gói là cách rẻ hơn cho nhóm đã khai báo.

## 5. Phát hiện cần xử lý

### 5.1. Lỗi trong gói: `restoreForEmbedding` làm hỏng câu một phần có dấu như "Hội An"

`vi-names-15` ("Hội An") đúng 1 → sai ở cả 5 model khi bật. Câu có hai âm tiết, một có dấu, nên tỉ lệ có dấu 0,5 không vượt ngưỡng `accentedRatio` (> 0,5) và đi theo nhánh "dấu một phần": phục hồi dấu cho "An". Suy luận (chưa kiểm bằng mã): "An" được đổi thành dạng có dấu phổ biến hơn trong vault ("ăn" hay "ẩn"), nên vector câu hỏi lệch khỏi note "Hội An". Hướng sửa cho V13 (không làm trong V22): không phục hồi âm tiết đã là từ hợp lệ không dấu trong từ vựng vault khi câu đã có chữ có dấu, hoặc chỉ phục hồi cho `embedQuery` khi câu hoàn toàn không dấu. Đo lại `vi-names` sau khi sửa; nếu Hit@5 của hạng mục về 1,00 thì nDCG@5 tổng tăng khoảng 0,004 so với số bật hiện tại (1 câu trên 255).

### 5.2. Quy trình: gói không nạp được thì OHS im lặng chạy như upstream

Một lần chạy đầu của chính đợt này đã hỏng vì thiếu `data/compounds.txt` cạnh thư mục dựng của gói: OHS chỉ in cảnh báo rồi chạy không gói (nDCG@5 tụt còn 0,67 và `restoreForEmbedding` không còn tác dụng). Worker nay từ chối đo nếu `languagePackStatus().loaded` là sai, và ghi chữ ký gói vào kết quả. Gói đọc `data/compounds.txt` ở thư mục cha của thư mục dựng, mà `files` trong `packages/ohs-lang-vi/package.json` hiện chỉ liệt kê `build`; cần thêm `data` trước khi đóng gói cho bộ cài (chưa sửa, ngoài phạm vi V22).

### 5.3. Ghi chú về cách OHS chạy model cục bộ

- Gộp trung bình cho mọi model (CLS của bge-m3 không dùng). bge-m3 vẫn cho AUC cao nhất, nên chưa cần đổi lõi; một tuỳ chọn pooling theo model có thể cải thiện thêm, chưa đo.
- Cache model cố định ở `~/.cache/huggingface` (mã cứng trong `src/inference/embedder.ts`); script đổi `HOME` để tránh đụng cache thật.
- Tiền tố `query:`/`passage:` chỉ áp khi tên chứa `e5`; halong không dùng tiền tố nên đúng.
- Model không có trong `KNOWN_CONTEXT_LENGTHS` (bge-m3, halong) dùng độ dài ngữ cảnh dự phòng; corpus này mỗi note một chunk nên không ảnh hưởng số đo, nhưng với note dài, cách chia chunk có thể khác giữa các model.

## 6. Chi phí

Máy giới hạn 4 luồng ONNX. RAM là đỉnh RSS của tiến trình Node (có cả tsx, SQLite, thư viện transformers: nền khoảng 640 MB đã tính ngay khi tải model nhỏ nhất).

| Model       | Chiều | Tải model (MB) | Dung lượng DB 363 note (MB) | Khởi động model (ms) | Index 363 note (s) | ms mỗi chunk lúc index | ms mỗi chunk 350 từ | RAM index (MB) | RAM tìm (MB) | RAM tìm + rerank (MB) |
| ----------- | ----- | -------------- | --------------------------- | -------------------- | ------------------ | ---------------------- | ------------------- | -------------- | ------------ | --------------------- |
| e5-small    | 384   | 129            | 4                           | 634                  | 4,4                | 12                     | 30                  | 830            | 711          | 861                   |
| e5-base     | 768   | 282            | 6                           | 827                  | 6,6                | 18                     | 69                  | 1.059          | 847          | 1.303                 |
| bge-m3      | 1024  | 560            | 7                           | 1.313                | 20,3               | 56                     | 237                 | 1.226          | 1.228        | 2.115                 |
| halong int8 | 768   | 282            | 6                           | 818                  | 7,4                | 20                     | 76                  | 1.066          | 867          | 1.299                 |
| halong fp32 | 768   | 1.075          | 6                           | 1.557                | 15,3               | 42                     | 155                 | 2.075          | 2.101        | 3.657                 |
| Reranker    |       | +616           |                             |                      |                    |                        |                     |                |              |                       |

Thời gian mỗi câu (trung bình, ms; p95 bằng 1,3 đến 1,7 lần trung bình khi tắt rerank): tắt rerank: e5-small 9,5, e5-base 11,7, bge-m3 19, halong int8 11, halong fp32 19. Bật rerank: 155 đến 169 ms ở mọi model, tức **cộng khoảng 145 đến 150 ms mỗi câu** (gần như không phụ thuộc model) cộng khoảng 2 s cho câu đầu tiên sau khi khởi động (tải reranker).

### Dự báo index 2.000 note

Giả định: 2 chunk mỗi note, mỗi chunk tốn như một đoạn 350 từ (chặn trên cho cỡ chunk OHS tạo ra; corpus mẫu chỉ có đoạn ngắn nên số thật thấp hơn).

| Model       | Phút, 4 luồng | Phút nếu máy 2 luồng (ước ×2)                   |
| ----------- | ------------- | ----------------------------------------------- |
| e5-small    | 2,0           | 4                                               |
| e5-base     | 4,6           | 9                                               |
| halong int8 | 5,1           | 10                                              |
| halong fp32 | 10,4          | 21                                              |
| bge-m3      | 15,8          | **32 (vượt 30 phút, cần ghi chú trong bộ cài)** |

Trên máy này (4 luồng), không model nào vượt 30 phút cho 2.000 note; bge-m3 sát nhất. Chỉ số ×2 là ước lượng, không đo.

## 7. Hạn chế

- Corpus sinh, mỗi note một chunk, văn bản ngắn và lặp: số đo chất lượng hạng mục lexicon (dấu, gõ sai) gần trần (≥ 0,97), nên không phân biệt được model. Chỉ `vi-semantic` (15 câu), `vi-synonym` (15 câu), `vi-snippet`, `vi-dd` còn chỗ để so. Chênh lệch dưới 0,01 nDCG@5 là vài câu.
- Chưa đo trên vault thật (PRD 11.5 nguồn 2, `quality-gate.mjs --private`), nơi note dài hơn nhiều chunk và nhánh nghĩa đóng góp nhiều hơn.
- Một lần chạy cho index và đo chunk 350 từ; thời gian mỗi câu lấy giá trị lớn hơn của 2 lần trên máy dùng chung.
- Bản halong int8 là bản tự xuất, kém trung thực hơn bản Xenova của e5 (xem mục 2); kết luận về halong nên đọc theo cả cột fp32.
- Reranker chỉ đo bản mặc định của OHS (gte-multilingual-reranker-base), một cấu hình công thức trộn điểm cố định của lõi; chưa thử reranker khác (bge-reranker-v2-m3) hay tăng số ứng viên.
- Không đo: tổng nDCG khi máy chỉ có 2 luồng, GPU, `OBSIDIAN_CHUNK_TOKENS`, model Ollama hoặc API.

## 8. Tái hiện

```bash
W=/home/vantt/projects/ohs-wt/tmp/v22          # thư mục làm việc ngoài /tmp (cache, DB, log)
# dựng gói vào $W/pack/out, kèm $W/pack/data (thư mục data/ của gói) và package.json
TMPDIR=$W/tmp node vantt/scripts/semantic-eval.mjs \
  --ohs /home/vantt/projects/ohs-wt/chk-series --pack $W/pack/out/index.js --work $W \
  --python $W/pyenv/bin/python --models e5-small,e5-base,bge-m3,halong,halong-fp32 \
  --runs 2 --serial --out $W/semantic-eval.json
```

`--python` cần torch, transformers, onnx, onnxruntime, chỉ dùng một lần để xuất halong. Tuỳ chọn: `--threads N` (mặc định 4), `--k`, `--vault` và `--golden` (corpus có sẵn), `--report-only` (dựng lại bảng từ `<work>/results`), `--force`. Kết quả JSON đầy đủ (từng câu, từng biến thể) nằm ở `$W/semantic-eval.json`, ngoài kho.

## 9. Việc tiếp theo

1. Sửa phục hồi dấu cho câu dấu một phần (mục 5.1), chạy lại `vi-names`, rồi chốt Q3 = bật làm mặc định của gói (hiện là `false`).
2. Chạy lại bảng 3.1 trên vault thật của người dùng (`quality-gate.mjs --private`) trước khi bộ cài chốt model nhúng và reranker.
3. Nếu bộ cài muốn hồ sơ tiếng Việt chuyên biệt: kiểm ONNX int8 của halong bằng phương pháp lượng tử hoá khác (static, QDQ) hoặc dùng `AITeamVN/Vietnamese_Embedding` đã có ONNX, rồi đo lại (hiện chưa có bằng chứng halong vượt bge-m3).
4. Thêm `data` vào `files` của `ohs-lang-vi` (mục 5.2).
