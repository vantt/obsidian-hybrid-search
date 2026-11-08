# Canonical license texts

`vantt/scripts/bundle.mjs` writes these texts into `LICENSES/deps/<package>/LICENSE-FROM-PACKAGE.txt` of the bundle
for every bundled npm package that declares a license in its `package.json` but ships no license file. A package
whose declared license has no text here fails the bundle build: add the text below, do not skip the package.

Source: [spdx/license-list-data](https://github.com/spdx/license-list-data) at tag **`v3.29.0`**, files
`https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text/<SPDX id>.txt`, downloaded 2026-11-04 and
committed unchanged.

| File               | SPDX file used          | Covers the ids                                        | sha256                                                             |
| ------------------ | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `0BSD.txt`         | `0BSD.txt`              | `0BSD`                                                | `e3f18c71e10d673590eb9856c1d79dd3b4b0d65404efb5e8584dbede7edd608b` |
| `Apache-2.0.txt`   | `Apache-2.0.txt`        | `Apache-2.0`, bare `Apache`                           | `074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff` |
| `BSD-2-Clause.txt` | `BSD-2-Clause.txt`      | `BSD-2-Clause`                                        | `f32fb3b417a194167cfad068223fc975ba96c5960513a10f66a3c28720aec1df` |
| `BSD-3-Clause.txt` | `BSD-3-Clause.txt`      | `BSD-3-Clause`                                        | `5a93d5831e1297ab10fe643e1a631e83be392896da14ee2951285a79012df69d` |
| `GPL-3.0.txt`      | `GPL-3.0-or-later.txt`  | `GPL-3.0`, `GPL-3.0-only`, `GPL-3.0-or-later`, `+`    | `fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0` |
| `ISC.txt`          | `ISC.txt`               | `ISC`                                                 | `521c6f0ed8e64736684f89843d16a4df6b4b7449acbcfc6ca6630a3037ca8c53` |
| `LGPL-3.0.txt`     | `LGPL-3.0-or-later.txt` | `LGPL-3.0`, `LGPL-3.0-only`, `LGPL-3.0-or-later`, `+` | `996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1` |
| `MIT.txt`          | `MIT.txt`               | `MIT`                                                 | `b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5` |

The `-only` and `-or-later` variants of the GNU licenses share one license text. LGPL-3.0 is written as additional
permissions on top of GPL-3.0, so every LGPL notice in the bundle also carries `GPL-3.0.txt` as its own section (the
SPDX LGPL file already appends the GPL text; the separate section keeps the notice explicit). For MIT, ISC, 0BSD and
the BSD texts the bundle replaces the template copyright line with the package author.
