/* data page */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };

  LZ.loadAll(["summary", "schema", "dictionary", "files"]).then(function (r) {
    const S = r[0], SCH = r[1], DICT = r[2], F = r[3];
    const c = S.counts;
    $("dl-version").textContent = "v" + S.version;
    $("dl-desc").textContent = "版本 " + S.version + " · 构建于 " + S.build_date + " · " + F.total_files + " 个文件，解压后约 " + LZ.bytes(F.total_bytes) + " · 27 张数据表、文档、QA 套件、验证框架与六幅图。";
    if (F.zip_name) $("dl-link").href = LZ.REPO + "/raw/main/" + F.zip_name;

    /* profiles */
    const fc = S.full_corpus;
    const rows = [
      ["转录字符流", "撤除（仅作者自有资源保留）", "全部 " + LZ.fmt(fc.sentences) + " 句"],
      ["章节实例", LZ.fmt(c.chapter_instances) + "（默认集 " + LZ.fmt(c.default_include_instances) + "）", LZ.fmt(fc.chapter_instances) + "（默认集 " + LZ.fmt(fc.default_include_instances) + "）"],
      ["句子", LZ.fmt(c.sentences), LZ.fmt(fc.sentences)],
      ["概念提及（默认集）", LZ.fmt(c.mention_edges_default) + " 边 · " + LZ.fmt(c.mention_occurrences_default) + " 次", LZ.fmt(fc.mention_edges_default) + " 边 · " + LZ.fmt(fc.mention_occurrences_default) + " 次"],
      ["注疏条目", LZ.fmt(c.commentary) + "（引文撤除）", LZ.fmt(fc.commentary)],
      ["候选异文事件", LZ.fmt(c.variants) + "（字串撤除，保留位置与操作）", LZ.fmt(fc.variants)],
      ["验证框架条目", LZ.fmt(c.validation_frames_items), LZ.fmt(fc.validation_frames_items)],
      ["图谱、统计、文档、QA、验证框架", "有", "有"],
      ["可否公开分发", "可以 · 待作者与机构签署", "不可 · 版权审查未完成（" + c.rights_cleared + " / " + c.rights_rows + " 已清）"]
    ];
    const pt = $("profile-table");
    pt.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", ""), LZ.el("th", "公开结构版（本站）"), LZ.el("th", "全量内部包"))));
    pt.appendChild(LZ.el("tbody", rows.map(function (r) { return LZ.el("tr", LZ.el("td", LZ.el("b", r[0])), LZ.el("td", r[1]), LZ.el("td", r[2])); })));

    /* schema */
    drawSchema(SCH);
    window.addEventListener("lz:theme", function () { drawSchema(SCH); });
    const nt = $("node-table");
    nt.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", "节点"), LZ.el("th.num", "行数"), LZ.el("th", "主键 · 说明"))));
    nt.appendChild(LZ.el("tbody", SCH.nodes.map(function (n) { return LZ.el("tr", LZ.el("td", LZ.el("b", n.name), LZ.el("span.sub", n.zh)), LZ.el("td.num", LZ.fmt(n.rows)), LZ.el("td", LZ.el("code", n.key), LZ.el("span.sub", n.note))); })));
    const rt = $("rel-table");
    rt.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", "关系"), LZ.el("th", "从 → 到"), LZ.el("th.num", "行数"))));
    rt.appendChild(LZ.el("tbody", SCH.rels.map(function (e) { return LZ.el("tr", LZ.el("td", LZ.el("code", e.name)), LZ.el("td", e.from + " → " + e.to), LZ.el("td.num", LZ.fmt(e.rows))); })));

    /* dictionary */
    $("dict-desc").textContent = DICT.length + " 张表 · " + DICT.reduce(function (s, t) { return s + t.columns.length; }, 0) + " 列。每列的类型、空值率、取值数、样例与说明；搜索会同时匹配列名与说明。";
    renderDict(DICT, "");
    $("dict-q").addEventListener("input", LZ.debounce(function () { renderDict(DICT, $("dict-q").value.trim().toLowerCase()); }, 150));

    /* files */
    $("files-desc").textContent = F.total_files + " 个文件 · 共 " + LZ.bytes(F.total_bytes) + "，按目录汇总如下；完整清单含每个文件的 SHA-256。";
    $("files-by-dir").appendChild(LZ.bars(F.by_dir.map(function (d) { return { label: d[0] + "/", value: d[2], tip: LZ.tip.rows(d[0], [["文件数", d[1]], ["大小", LZ.bytes(d[2])]]) }; }), { labelWidth: "160px", color: LZ.layerColor("structure"), format: function (v, r) { return LZ.bytes(v); } }));
    $("files-n").textContent = F.total_files + " 个";
    $("files-table").appendChild(LZ.table(F.files, [
      { key: "path", label: "路径", sort: function (f) { return f.path; }, render: function (f) { return LZ.el("code", f.path); } },
      { key: "size", label: "大小", num: true, render: function (f) { return LZ.bytes(f.size); } },
      { key: "sha256", label: "SHA-256", render: function (f) { return LZ.el("code", { title: f.sha256 }, f.sha256.slice(0, 16) + "…"); } }
    ], { sortKey: "path", sortDir: "asc", compact: true }));

    /* quality */
    $("qa-score").textContent = S.qa.checks_total ? S.qa.checks_passed + " / " + S.qa.checks_total + " 项通过" : "内部构建：见 qa/validation_report.json";
    $("qa-list").appendChild(LZ.el("span", S.qa.checks.map(function (q) { return LZ.el("li", LZ.el("div", q.check, " ", LZ.el("span", q.detail))); })));
    const vt = $("valid-table");
    vt.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", "框架"), LZ.el("th.num", "条目"), LZ.el("th.num", "已判定"), LZ.el("th.num", "阈值"))));
    const frames = Object.keys(S.validation.frames);
    vt.appendChild(LZ.el("tbody", frames.map(function (k) { const f = S.validation.frames[k]; return LZ.el("tr", LZ.el("td", LZ.el("code", k)), LZ.el("td.num", LZ.fmt(f.items)), LZ.el("td.num", String(f.adjudicated)), LZ.el("td.num", f.threshold_pct + "%")); })));
    $("valid-note").textContent = "状态 " + S.validation.status + "：本发行档共 " + LZ.fmt(S.validation.items_total) + " 项（全量内部包 " + LZ.fmt(S.validation.items_full_corpus) + " 项，后者才是判定的正式语料）。本站不展示 derived_unverified/ 中的 " + c.candidate_claims + " 条 AI 生成的候选学术主张：它们不可作为学术观点引用。";

    /* rights */
    const rtab = $("rights-table");
    rtab.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", "数字来源（按目录号推断）"), LZ.el("th.num", "资源数"))));
    const buckets = S.rights.provider_buckets || {};
    rtab.appendChild(LZ.el("tbody", Object.keys(buckets).sort(function (a, b) { return buckets[b] - buckets[a]; }).map(function (k) { return LZ.el("tr", LZ.el("td", k), LZ.el("td.num", String(buckets[k]))); })));
    const disp = S.rights.dispositions.map(function (d) { return (S.rights.disposition_zh[d[0]] || d[0]) + " " + d[1]; }).join(" · ");
    $("rights-note").textContent = "再分发状态：" + S.rights.cleared + " / " + c.rights_rows + " 已清，" + S.rights.not_reviewed + " 未审查；" + S.rights.provider_low_confidence + " 个来源仅有低置信度的推断。拟议处置：" + disp + "。";

    /* citation */
    const names = S.authors.map(function (a) { return a.display; });
    const year = (S.build_date || "2026").slice(0, 4);
    $("cite-text").appendChild(LZ.el("span", names.join(", ") + " (" + year + "). "));
    $("cite-text").appendChild(LZ.el("b", S.title));
    $("cite-text").appendChild(LZ.el("span", ", version " + S.version + " (public structural release). Zenodo. DOI pending."));
    $("bibtex").textContent = "@dataset{laozikg_" + year + ",\n  title   = {" + S.title + "},\n  author  = {" + S.authors.map(function (a) { return a.family + ", " + a.given; }).join(" and ") + "},\n  year    = {" + year + "},\n  version = {" + S.version + "},\n  note    = {Public structural release; release candidate. DOI pending.},\n  url     = {" + LZ.REPO + "}\n}";
    const au = $("authors");
    S.authors.forEach(function (a) { au.appendChild(LZ.el("div.author", LZ.el("b", a.display), LZ.el("span", a.affiliation), LZ.el("span.muted", a.role))); });
  }).catch(function (e) { console.error(e); });

  function renderDict(DICT, q) {
    const host = LZ.clear($("dict"));
    let shown = 0, cols = 0;
    DICT.forEach(function (t) {
      const columns = q ? t.columns.filter(function (col) { return (col.column + " " + col.description).toLowerCase().indexOf(q) >= 0; }) : t.columns;
      if (!columns.length) return;
      shown++; cols += columns.length;
      const det = LZ.el("details.acc", { open: q ? true : null }, LZ.el("summary", LZ.el("span", LZ.el("code", t.table), " ", LZ.el("span.sub", t.purpose || "")), LZ.el("span.sub", LZ.fmt(t.rows) + " 行 · " + columns.length + " 列")));
      const body = LZ.el("div.acc__body");
      const table = LZ.el("table.table.table--compact.dict-cols");
      table.appendChild(LZ.el("thead", LZ.el("tr", LZ.el("th", "列"), LZ.el("th", "类型"), LZ.el("th.num", "空值"), LZ.el("th.num", "取值数"), LZ.el("th", "说明 · 样例"))));
      table.appendChild(LZ.el("tbody", columns.map(function (col) {
        return LZ.el("tr", LZ.el("td", LZ.el("code", col.column)), LZ.el("td", col.dtype), LZ.el("td.num", col.null_pct.toFixed(1) + "%"), LZ.el("td.num", LZ.fmt(col.distinct)),
          LZ.el("td", col.description, col.sample ? LZ.el("span.sub", "样例：" + col.sample) : null));
      })));
      body.appendChild(LZ.el("div.table-wrap", table));
      det.appendChild(body);
      host.appendChild(det);
    });
    $("dict-count").textContent = q ? "匹配 " + cols + " 列 · " + shown + " 张表" : DICT.length + " 张表";
    if (!shown) host.appendChild(LZ.el("div.empty", "没有匹配的列。"));
  }

  function drawSchema(SCH) {
    const host = LZ.clear($("schema-diagram"));
    const layers = [
      { name: "来源层", color: "--c-structure", nodes: ["Version", "Person", "PersonAlias", "ProvenanceAssertion"] },
      { name: "文本层", color: "--teal", nodes: ["ChapterInstance", "Sentence"] },
      { name: "派生层", color: "--c-commentary", nodes: ["Variant", "Commentary", "Evidence"] },
      { name: "解释层", color: "--c-variant", nodes: ["Concept", "CandidateScholarlyClaim", "CandidateScholarlyClaimEvidence"] }
    ];
    const W = 1000, rowH = 92, H = layers.length * rowH + 20, boxW = 176, boxH = 40;
    const pos = {};
    const svg = d3.select(host).append("svg").attr("viewBox", [0, 0, W, H]).attr("class", "schema-svg").attr("role", "img").attr("aria-label", "图谱模式示意图");
    const rowsByName = {}; SCH.nodes.forEach(function (n) { rowsByName[n.name] = n; });
    layers.forEach(function (L, i) {
      const y = 10 + i * rowH;
      const col = LZ.cssVar(L.color);
      svg.append("rect").attr("x", 0).attr("y", y).attr("width", W).attr("height", rowH - 8).attr("rx", 8).attr("fill", col).attr("opacity", 0.06);
      svg.append("text").attr("x", 14).attr("y", y + 22).attr("font-size", 12).attr("fill", col).attr("font-weight", 700).text(L.name);
      const n = L.nodes.length, gapX = (W - 130 - n * boxW) / (n + 1);
      L.nodes.forEach(function (name, j) {
        const x = 130 + gapX + j * (boxW + gapX), yy = y + (rowH - 8 - boxH) / 2;
        pos[name] = { x: x + boxW / 2, y: yy + boxH / 2, top: yy, bottom: yy + boxH };
        svg.append("rect").attr("x", x).attr("y", yy).attr("width", boxW).attr("height", boxH).attr("rx", 6).attr("fill", LZ.cssVar("--paper")).attr("stroke", col).attr("stroke-width", 1.4);
        svg.append("text").attr("x", x + boxW / 2).attr("y", yy + 17).attr("text-anchor", "middle").attr("font-size", name.length > 20 ? 10 : 12.5).attr("fill", LZ.cssVar("--ink")).attr("font-weight", 700).text(name);
        svg.append("text").attr("x", x + boxW / 2).attr("y", yy + 32).attr("text-anchor", "middle").attr("font-size", 10.5).attr("fill", LZ.cssVar("--ink-3")).text((rowsByName[name] ? rowsByName[name].zh + " · " + LZ.fmt(rowsByName[name].rows) : ""));
      });
    });
    const defs = svg.append("defs");
    defs.append("marker").attr("id", "arr").attr("viewBox", "0 0 10 10").attr("refX", 9).attr("refY", 5).attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto-start-reverse").append("path").attr("d", "M0,0L10,5L0,10z").attr("fill", LZ.cssVar("--ink-3"));
    const g = svg.append("g").attr("fill", "none").attr("stroke", LZ.cssVar("--ink-3")).attr("stroke-width", 1).attr("opacity", 0.75);
    SCH.rels.forEach(function (e) {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      if (e.from === e.to) { g.append("path").attr("d", "M" + (a.x + 70) + "," + a.top + " C" + (a.x + 120) + "," + (a.top - 30) + " " + (a.x + 20) + "," + (a.top - 30) + " " + (a.x + 40) + "," + a.top).attr("marker-end", "url(#arr)"); return; }
      const down = b.y > a.y, sameRow = Math.abs(b.y - a.y) < 2;
      let d;
      if (sameRow) d = "M" + (a.x + (b.x > a.x ? 88 : -88)) + "," + a.y + " L" + (b.x + (b.x > a.x ? -88 : 88)) + "," + b.y;
      else d = "M" + a.x + "," + (down ? a.bottom : a.top) + " C" + a.x + "," + (a.y + b.y) / 2 + " " + b.x + "," + (a.y + b.y) / 2 + " " + b.x + "," + (down ? b.top : b.bottom);
      const p = g.append("path").attr("d", d).attr("marker-end", "url(#arr)");
      p.append("title").text(e.name + " · " + e.from + " → " + e.to + " · " + LZ.fmt(e.rows) + " 行");
      p.style("pointer-events", "stroke");
    });
  }
})();
