# Attribution for `compounds.txt`

`compounds.txt` is a list of two-syllable Vietnamese compounds selected by syllable-pair statistics computed over the
three datasets below (`scripts/build-compounds.mjs`, method in `README.md`). No text from them is shipped: only the
selected syllable pairs. All three are licensed under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0).
Changes: the text was split into syllables, counted, and reduced to a list of word pairs.

| Dataset | Creator | Revision used | License |
|---|---|---|---|
| [Asian Language Treebank (ALT)](https://huggingface.co/datasets/mutiyama/alt), Vietnamese side of `alt-parallel` (`train`) | Hammam Riza, Michael Purwoadi, Gunarso, Teduh Uliniansyah, Aw Ai Ti, Sharifah Mahani Aljunied, Luong Chi Mai, Vu Tat Thang, Nguyen Phuong Thai, Vichet Chea, Rapid Sun, Sethserey Sam, Sopheap Seng, Khin Mar Soe, Khin Thandar Nwet, Masao Utiyama, Chenchen Ding: "Introduction of the Asian Language Treebank", Oriental COCOSDA 2016. Sentences translated from English Wikinews | `afbd92e198bbcf17f660e03076fd2938f5a4bbb2` | CC BY 4.0 |
| [Nemotron-Personas-Vietnam](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Vietnam), shard `train-00000-of-00011` | NVIDIA (Hoang Thanh-Tung, Hoang Tuan-Anh, Le-Dinh Duy, Nguyen Thuy-Duong, Le Van, Tran Quan Minh, Tong Vu, Nguyen Que, Nirmal Kumar Juluru, Shyamala Prayaga, Ashton Sharabiani, Evan Acharya, Bardiya Sadeghi, Will Jennings, Kiran Praveen, Dane Corneil, Yev Meyer), 2026 | `950724d49b7b41eee7925ae035a2059286c890ff` | CC BY 4.0 |
| [Vietnamese Legal Documents](https://huggingface.co/datasets/th1nhng0/vietnamese-legal-documents), `data/content.parquet` | Thịnh Ngô, 2026; documents from [vbpl.vn](https://vbpl.vn) (Ministry of Justice of Vietnam). The documents themselves are not protected by copyright (Law on Intellectual Property, Article 15); the compiled dataset is CC BY 4.0 | `8977887f17be2defae4c5171d55562e1cde7d695` | CC BY 4.0 (compilation) |
