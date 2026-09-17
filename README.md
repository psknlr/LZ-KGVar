# LZ-KGVar · 老子语料知识图谱网站

**LaoziKG**（*A Provenance-Aware Multi-Version Textual Knowledge Graph of the Laozi*）的公开结构版数据，以及展示它的 GitHub Pages 网站。

- 网站：<https://psknlr.github.io/LZ-KGVar/>（部署后可访问，见下文）
- 数据：`LaoziKG-v1.1.2-rc11-public-structural.zip`（公开结构版，v1.1.2-rc11）

网站只使用**公开结构版**：它不含任何第三方转录的字符流，所以不受逐来源版权审查的限制。唯一带文本的资源是数据集作者自有的《老子》王弼注整理本（`WANGBI_TONGSHI_2026`，`release_disposition = full_text`），八十一章经文与可引用的王弼注即取自此处。全量内部包（含转录文本）在版权审查完成前不得再分发，也从未进入本仓库。

## 网站结构

| 页面 | 内容 |
|---|---|
| `index.html` 首页 | 数据规模、三道发布之门、四层架构、语料时代分布、阅读须知、发布图集、引用 |
| `concepts.html` 概念 | 111 个概念的本体关系 / 共现网络力导向图，逐概念的定义、典型章次、提及统计、注疏分布、关系；全表 |
| `witnesses.html` 文献 | 176 种资源的筛选、「文献 × 章节」覆盖矩阵、书目与权利详情、同书异本断言 |
| `chapters.html` 章节 | 九九方格（文献覆盖 / 异文密度 / 提及密度 / 注疏条目），每章经文、概念提及、候选异文、注疏与王弼注引文、保存此章的文献 |
| `persons.html` 人物 | 77 位作者与注家的年表、别名、所涉文献、时代争议标记 |
| `data.html` 数据 | 下载、两个发行档的对照、图谱模式、数据字典、文件清单与 SHA-256、质量与验证、权利与许可、复现路径、引用 |

纯静态实现：HTML + CSS + 原生 JavaScript，图形用 [D3 v7](https://d3js.org)（已内置于 `docs/assets/vendor/`），无需构建工具。所有数字与文本都由 `docs/data/*.json` 驱动，这些文件由脚本从公开结构版 zip 自动生成，不手工维护。

## 部署到 GitHub Pages

仓库已包含工作流 `.github/workflows/pages.yml`，它把 `docs/` 发布为站点。只需一次设置：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（工作流首次运行时也会尝试自动开启）。
2. 把本分支合并到 `main`。此后每次推送到 `main` 且改动了 `docs/` 都会自动重新部署；也可在 Actions 页手动 **Run workflow**。

若更愿意用「Deploy from a branch」的方式，选择 `main` 分支的 `/docs` 目录即可，效果相同。

## 重新生成网站数据

数据集更新后（例如新的 rc 版本），把新的公开结构版 zip 放到仓库根目录，然后：

```bash
pip install -r scripts/requirements.txt
python scripts/build_site_data.py            # 读取根目录的 LaoziKG-*-public-structural.zip
                                             # → docs/data/*.json，并复制六幅发布图
```

脚本只读公开结构版的表格；文本列只对 `full_text` 资源使用。

## 字体

网站自带 `LZ Serif SC`——Noto Serif SC（SIL OFL 1.1，见 `docs/assets/fonts/OFL.txt`）按站内实际出现的字符做的子集，共四个文件、约 630 KB，按需加载，因此在无法访问 Google Fonts 的网络环境下也能正常显示。重建方法：

```bash
# 1. 取得 Google Fonts 提供的 Noto Serif SC 切片（variable font，按 unicode-range 分片）
#    slices.json 记录每个切片的 unicode-range，切片文件命名为 400-<idx>.woff2
# 2. 在网站文本定稿后运行：
python scripts/build_fonts.py --slices <切片目录>
```

## 目录

```
docs/                     GitHub Pages 站点根目录
  *.html                  六个页面 + 404
  assets/css/site.css     设计系统（纸墨朱青配色，明暗两套主题）
  assets/js/site.js       共享运行时；各页面脚本 home.js / concepts.js / …
  assets/fonts/           自托管字体子集 + OFL 许可
  assets/vendor/d3.v7.min.js
  assets/img/figures/     数据集发布的六幅图
  data/*.json             由 scripts/build_site_data.py 生成
scripts/build_site_data.py
scripts/build_fonts.py
.github/workflows/pages.yml
LaoziKG-v1.1.2-rc11-public-structural.zip
```

## 许可

- 数据集的结构注释与派生层：CC BY 4.0；代码：MIT（以 zip 内 `LICENSE_DATA.md` / `LICENSE_CODE` 为准）。底本转录的再分发权利未定，已从公开版撤除。
- 网站源码（`docs/`、`scripts/`）：MIT。
- 字体：SIL Open Font License 1.1。
