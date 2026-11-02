# Dữ liệu của gói

## `compounds.txt`: từ điển từ ghép cho view `seg` (PRD 10.4, Q9)

Danh sách từ ghép hai âm tiết **học bằng thống kê cặp âm tiết** trên văn bản tiếng Việt có giấy phép rõ ràng (quyết định của user ngày 2026-11-02, V20b). Không chép mục nào từ một từ điển có sẵn.

| | |
|---|---|
| Kết quả | 20.523 từ, 242 KB (gzip 78 KB); sha256 `7b127e34968d61cc9d84a5aac6f4c2e8c8ac1d9c36b3c4002df9e7249327120c`; digest trong `signature()` (`seg=`) `1187edce5748` |
| Dựng lại | `npm run build` rồi `node scripts/build-compounds.mjs --work <thư mục làm việc>` (tải 1 GB về `<thư mục làm việc>/corpus`, đếm 5–25 phút tuỳ tải máy, cần vài GB RAM: chạy `node --max-old-space-size=12000`). Kết quả chỉ phụ thuộc corpus đã ghim (kiểm sha256) và các hằng số `THRESHOLDS` trong script; chạy lại cho đúng file này |
| Ghi công | [`ATTRIBUTION.md`](ATTRIBUTION.md) (CC BY 4.0 yêu cầu), đi kèm gói |

### Corpus (đều CC BY 4.0, đã đọc giấy phép trên trang dataset ở đúng revision)

| Nguồn | Revision, file, sha256 | Phần dùng | Cỡ |
|---|---|---|---|
| [mutiyama/alt](https://huggingface.co/datasets/mutiyama/alt) (Asian Language Treebank: câu Wikinews tiếng Anh dịch sang các thứ tiếng). Mục "Licensing Information": CC BY 4.0 | `afbd92e198bbcf17f660e03076fd2938f5a4bbb2`, `alt-parallel/train-00000-of-00001.parquet`, `e2d95c41…a3a44` | cột `translation.vi`, 18.088 câu | 0,53 triệu âm tiết |
| [nvidia/Nemotron-Personas-Vietnam](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Vietnam) (văn bản sinh bằng mô hình, tiếng Việt phổ thông). Mục "License/Terms of Use": CC BY 4.0 | `950724d49b7b41eee7925ae035a2059286c890ff`, `data/train-00000-of-00011.parquet` (1/11), `7ba73013…4ae4` | 10 cột mô tả (`professional_persona`, `sports_persona`, `arts_persona`, `travel_persona`, `culinary_persona`, `persona`, `cultural_background`, `skills_and_expertise`, `hobbies_and_interests`, `career_goals_and_ambitions`), 90.910 dòng | 74,7 triệu |
| [th1nhng0/vietnamese-legal-documents](https://huggingface.co/datasets/th1nhng0/vietnamese-legal-documents) (văn bản quy phạm pháp luật từ vbpl.vn của Bộ Tư pháp). Mục "License": văn bản pháp luật không được bảo hộ quyền tác giả (Luật Sở hữu trí tuệ, Điều 15), phần biên soạn của dataset CC BY 4.0 | `8977887f17be2defae4c5171d55562e1cde7d695`, `data/content.parquet`, `69c5b99c…aab` | cột `content_html` (bỏ thẻ HTML), 170.824 văn bản | 368,3 triệu |

Tổng 443,5 triệu âm tiết, 10.575 âm tiết khác nhau, 1,23 triệu cặp liền nhau. Đã xem và loại: Wikipedia, Wiktionary, FLORES (CC BY-SA); OSCAR, HPLT, CulturaX, mC4, CC-100 (gói dữ liệu CC0 hay ODC-BY nhưng văn bản web vẫn thuộc tác giả gốc, giấy phép không rõ); các từ điển GPL (`Viet74K`, `undertheseanlp/dictionary`).

### Cách chọn (`scripts/build-compounds.mjs`)

1. Văn bản tách thành các đoạn chữ chỉ cách nhau bằng khoảng trắng (dấu câu, số, xuống dòng cắt đoạn). Mỗi từ chuẩn hoá bằng `normalize` của gói (NFC, chữ thường, dấu thanh kiểu `modern`); từ không phải âm tiết tiếng Việt (`parseSyllable`) cắt đoạn. Đếm âm tiết và cặp liền nhau theo từng nguồn, bộ ba liền nhau (để tính tỉ lệ thắng), và số lần cả hai từ viết hoa chữ đầu.
2. Mỗi nguồn là một kiểu văn (tin tức, văn kể đời thường, văn pháp luật), nên độ gắn kết đo trong từng nguồn và lấy nguồn tốt nhất:
   - `npmi`: PMI chuẩn hoá của cặp trong nguồn (cặp có ít nhất 3 lần ở nguồn đó);
   - tỉ lệ thắng: trong các cửa sổ ba âm tiết `a b c` của một nguồn, cặp thắng khi `npmi` của nó cao hơn cặp chồng lên nó (`a b` so với `b c`, và phía trái tương tự); lấy phía kém hơn, rồi nguồn tốt nhất trong các nguồn có ít nhất `minCount / 2` lần. Cặp nối đuôi từ này với đầu từ kia ("về sân" trong "về sân bay") thua phần lớn cửa sổ.
3. Giữ cặp khi: xuất hiện ít nhất 10 lần; `npmi` ≥ 0,2; tỉ lệ thắng ≥ 0,75; mỗi âm tiết có ít nhất 5 lần trong hai nguồn sạch (ALT, personas; loại lỗi OCR, lỗi gõ của văn bản pháp luật như `quổc`); không quá 80% số lần cả hai từ viết hoa chữ đầu (tên người, tên đất: `Ngọc Anh`, `Hà Nội`; tên trong từ điển làm view `seg` coi "Ngọc Anh" và "Ngọc Ánh" như nhau); cặp toàn chữ ASCII không dấu (thường là tiếng Anh như `in the`, hay chữ gõ không dấu trong văn bản pháp luật) phải có ít nhất 10 lần trong hai nguồn sạch.

Chỉ giữ từ hai âm tiết (như V20: từ ba âm tiết trở lên hay nuốt âm tiết đầu của từ sau khi tách); từ ghép dài do user khai trong lexicon (`## Từ ghép`) vẫn dùng, độ dài bất kỳ.

Giới hạn đã biết: danh sách có cả cụm từ chức năng hay đi liền nhau (`không có`, `sau khi`, `trong các`) vì thống kê cặp không tách được chúng khỏi từ ghép; tỉ lệ thắng chỉ giữ những cụm ít khi nối đuôi một từ ghép khác. Từ của các lĩnh vực không có trong corpus (thể thao, khoa học) thiếu nhiều hơn (`cầu thủ`, `nhà văn` không có).

### Ranh giới với pyvi (chỉ dùng lúc phát triển)

Bản V20 dùng `pyvi/models/words.txt` của [trungtv/pyvi](https://github.com/trungtv/pyvi) (MIT, commit `e2ac2ec`). Giấy phép đạt nhưng nguồn gốc không rõ: 95% mục trùng `Viet74K.txt` (GPL-2.0). User chốt thay nó, và chỉ cho "học từ" pyvi theo đúng nghĩa sau:

- **Được:** dùng danh sách hai âm tiết của pyvi làm tham chiếu để đo danh sách thống kê (độ chính xác, độ phủ, F1 qua cờ `--reference` của script, chỉ in ra màn hình) và để chọn bằng tay vài hằng số chung (`THRESHOLDS`, cách tính điểm) áp cho mọi cặp như nhau.
- **Không được:** chép mục nào của pyvi vào file; lọc, thêm, bớt hay xếp hạng từng cặp theo việc nó có trong pyvi hay không; học một bộ trọng số nhiều tham số từ nhãn pyvi; đưa file pyvi vào repo. Script không đọc pyvi khi ghi `compounds.txt` (cờ `--reference` chỉ chạy sau khi đã ghi, trên điểm đã tính), nên chạy có hay không có `--reference` cho cùng một file.
- File pyvi để đo nằm ngoài repo (`/home/vantt/projects/ohs-wt/tmp/v20b/pyvi/`, không commit). Đã xoá `LICENSE-pyvi.txt` vì không còn gì của pyvi trong gói.

Đo với pyvi lúc chọn ngưỡng (22.574 từ hai âm tiết của pyvi, 16.293 cặp trong số đó có trong corpus): danh sách gửi đi 20.523 từ, 6.805 từ (33%) trùng pyvi, phủ 30% pyvi (42% số cặp pyvi có trong corpus), F1 0,316. Phần lớn mục không trùng là từ ghép thật mà pyvi không có (`phạt tiền`, `bộ phim`, `sân vườn`, `cú sút`, `đường đỏ`) hoặc cụm từ chức năng (giới hạn ở trên). Các bộ ngưỡng lân cận cho F1 0,29–0,32 với 17–33 nghìn mục; trong nhóm F1 cao nhất (chênh dưới 0,003) chọn bộ giữ đủ bảy từ ghép phổ biến mà test của gói đã kiểm từ V20 (`khách hàng`, `nhà hàng`, `sinh học`…) và trên 20.000 mục như test cũ yêu cầu. Các bước lọc tên riêng, âm tiết sạch, chữ ASCII được thêm sau khi xem các mục sai thường gặp nhất, không theo mục nào của pyvi.

Eval (corpus `vi-search@v0.11.0`, lõi `wt-p01b` `632209f`, e5-small, k = 10, tuỳ chọn mặc định, `segment` bật), nDCG@5 `vi-compound`: baseline upstream 0,632, gói không tách từ 0,822, gói với từ điển pyvi 0,971, gói với từ điển này **0,983** (15 câu khó: 0,421 / 0,645 / 0,942 / **0,967**). Không hạng mục nào kém bản pyvi; `vi-snippet` 0,777 → 0,843. Chi tiết: `vantt/plans/archive/261102-1321-v20b-licensed-compounds/plan.md`.
