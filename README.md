# LZ-KGVar · 老子语料知识图谱网站

**LaoziKG**（*A Provenance-Aware Multi-Version Textual Knowledge Graph of the Laozi*）的公开结构版数据，以及展示它的 GitHub Pages 网站。

- 网站：<https://psknlr.github.io/LZ-KGVar/>（部署后可访问，见下文）
- 数据：`LaoziKG-v1.1.2-rc11-public-structural.zip`（公开结构版，v1.1.2-rc11）

网站只使用**公开结构版**：它不含任何第三方转录的字符流，所以不受逐来源版权审查的限制。唯一带文本的资源是数据集作者自有的《老子》王弼注整理本（`WANGBI_TONGSHI_2026`，`release_disposition = full_text`），八十一章经文与可引用的王弼注即取自此处。全量内部包（含转录文本）在版权审查完成前不得再分发，也从未进入本仓库。

## 网站结构

| 页面 | 内容 |
|---|---|
| `index.html` 首页 | 数据规模、三道发布之门、四层架构、语料时代分布、阅读须知、发布图集、引用 |
| `graph.html` 图谱浏览 | 在网页上直接浏览知识图谱：搜索或选择起点，按关系逐步展开邻居节点（文献 → 章节实例 → 概念 ← 注疏 ← 注家…），查看每个节点的属性与来源标记；支持固定、折叠、撤销、导出 SVG |
| `concepts.html` 概念 | 111 个概念的本体关系 / 共现网络力导向图，逐概念的定义、典型章次、提及统计、注疏分布、关系；全表 |
| `witnesses.html` 文献 | 176 种资源的筛选、「文献 × 章节」覆盖矩阵、书目与权利详情、同书异本断言 |
| `chapters.html` 章节 | 九九方格（文献覆盖 / 异文密度 / 提及密度 / 注疏条目），每章经文（概念高亮）、概念提及、候选异文（含王弼本章文上的事件密度）、注疏与王弼注引文、保存此章的文献；点击任一文献打开该章实例 |
| `persons.html` 人物 | 77 位作者与注家的年表、别名、所涉文献、时代争议标记 |
| `data.html` 数据 | 下载、两个发行档的对照、图谱模式、数据字典、文件清单与 SHA-256、质量与验证、权利与许可、复现路径、引用 |

**逐级钻取**：章节页的文献、文献页的章节格、图谱中的章节实例与注疏节点、人物与概念页的注疏计数，都可点开抽屉查看具体内容——章节实例的逐句结构与概念标注、相对王弼本的候选异文事件（位置、王弼本原字、层次、操作、分数、模型说明）、落在该实例上的注疏条目；注疏条目的引文来源、证据记录与关联节点；本章 / 某文献 / 某注家 / 某概念的条目列表与筛选。数据按章按需加载（`docs/data/chapters/<n>.json`）。

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

### 内部全量版（不可公开部署）

全量内部包携带 175 种第三方文献的转录文本，数据集自身的 `PROFILE_NOTICE.md` 与 `LICENSE_DATA.md` 规定在逐来源版权审查完成前不得再分发。若需在内部查阅带全部原文的网站（逐句原文、注疏引文与模型转述、异文两侧字串、王弼注与通释），用同一套脚本从全量包构建到仓库之外的目录：

```bash
mkdir -p /path/to/internal-site && cp -r docs/*.html docs/assets /path/to/internal-site/
python scripts/build_site_data.py --profile full \
    --release /path/to/LaoziKG-v1.1.2-rc11 \
    --out /path/to/internal-site/data \
    --figures /path/to/internal-site/assets/img/figures
python -m http.server --directory /path/to/internal-site 8000   # 本机或内网访问
```

`--profile full` 构建的站点会在页眉显示「全量内部版」提示条。默认的 `--profile public` 即使对全量包运行，也只会输出 `full_text` 资源的文本，因此仓库中的 `docs/data/` 始终是可公开的。图谱浏览器的数据（`docs/data/kg/`）同样由它生成：句子与候选异文在公开版中不带文本，因而聚合为章节实例的属性；AI 生成的候选学术主张不纳入。

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
  data/kg/*.json          图谱浏览器的紧凑邻接数据（core / instances / commentary，按需加载）
  data/chapters/<n>.json  每章的钻取数据：各实例的逐句结构、句级概念提及、候选异文事件、注疏条目
scripts/build_site_data.py
scripts/build_fonts.py
.github/workflows/pages.yml
LaoziKG-v1.1.2-rc11-public-structural.zip
```

## 许可

- 数据集的结构注释与派生层：CC BY 4.0；代码：MIT（以 zip 内 `LICENSE_DATA.md` / `LICENSE_CODE` 为准）。底本转录的再分发权利未定，已从公开版撤除。
- 网站源码（`docs/`、`scripts/`）：MIT。
- 字体：SIL Open Font License 1.1。
