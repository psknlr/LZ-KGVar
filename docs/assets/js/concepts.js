/* concepts page: ontology / co-occurrence force graph + detail panel + table */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  let S, CONCEPTS, GRAPH, WIDX, byId = {};
  let view = LZ.hash.get("view") === "cooc" ? "cooc" : "onto";
  let sizeBy = "same";
  let threshold = 120;
  let selected = null;
  let sim = null, svgSel, gLinks, gNodes, zoomBehavior;

  LZ.loadAll(["summary", "concepts", "concept_graph", "witness_index"]).then(function (r) {
    S = r[0]; CONCEPTS = r[1]; GRAPH = r[2]; WIDX = r[3];
    LZ.setEras(S.era_order, S.era_span);
    CONCEPTS.forEach(function (c) { byId[c.id] = c; });
    buildControls();
    buildLegend();
    buildTable();
    buildGraph();
    const h = LZ.hash.get("c");
    if (h && byId[h]) select(h, true);
    window.addEventListener("lz:theme", function () { buildLegend(); restyle(); if (selected) renderPanel(byId[selected]); });
    window.addEventListener("hashchange", function () { const id = LZ.hash.get("c"); if (id && byId[id] && id !== selected) select(id, true); });
  }).catch(function (e) { console.error(e); $("panel").textContent = "数据加载失败：" + e.message; });

  /* ---------- controls ------------------------------------------------ */
  function buildControls() {
    $("view-seg").appendChild(LZ.seg([{ value: "onto", label: "本体关系 · 67 条" }, { value: "cooc", label: "共现网络" }], view, function (v) {
      view = v; $("threshold-field").style.display = v === "cooc" ? "" : "none"; LZ.hash.set({ view: v === "cooc" ? "cooc" : null }, true); buildGraph();
    }));
    $("threshold-field").style.display = view === "cooc" ? "" : "none";
    $("size-seg").appendChild(LZ.seg([{ value: "same", label: "节点等大" }, { value: "high", label: "大小 = 高特异性提及" }, { value: "raw", label: "原始提及" }], sizeBy, function (v) { sizeBy = v; restyle(true); }));
    const th = $("threshold");
    th.addEventListener("input", function () { threshold = +th.value; $("threshold-val").textContent = threshold; });
    th.addEventListener("change", function () { buildGraph(); });
    const search = $("concept-search");
    search.addEventListener("input", LZ.debounce(function () {
      const q = search.value.trim();
      if (!q) { highlightSearch(null); return; }
      const hits = CONCEPTS.filter(function (c) { return c.name.indexOf(q) >= 0 || c.id.indexOf(q) >= 0; });
      highlightSearch(hits.map(function (c) { return c.id; }));
      if (hits.length === 1) select(hits[0].id);
    }, 120));
  }

  function buildLegend() {
    const items = LZ.TYPE_ORDER.map(function (t) { const m = LZ.TYPE_META[t]; return { label: m.zh + " " + m.en, color: LZ.typeColor(t), shape: m.shape || null }; });
    if (view === "onto") {
      items.push({ label: "表达 EXPRESSES", color: LZ.cssVar("--line-2"), shape: "line" });
    }
    LZ.clear($("legend")).appendChild(LZ.legend(items));
  }

  /* ---------- sizing -------------------------------------------------- */
  function radius(n) {
    if (sizeBy === "same") return 7.5;
    const v = sizeBy === "high" ? n.high : n.raw;
    const max = sizeBy === "high" ? 220 : 40000;
    const s = d3.scaleSqrt().domain([0, max]).range([4, 19]);
    return s(Math.min(v, max));
  }
  function symbolFor(n) {
    const m = LZ.TYPE_META[n.node_type] || {};
    if (!m.shape) return d3.symbolCircle;
    return { square: d3.symbolSquare, diamond: d3.symbolDiamond, triangle: d3.symbolTriangle, ring: d3.symbolCircle }[m.shape];
  }
  function isRing(n) { return (LZ.TYPE_META[n.node_type] || {}).shape === "ring"; }

  /* ---------- graph --------------------------------------------------- */
  function buildGraph() {
    buildLegend();
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();
    const box = $("graph").getBoundingClientRect();
    const W = Math.max(600, box.width), H = Math.max(420, box.height);
    svg.attr("viewBox", [0, 0, W, H]);
    const root = svg.append("g");
    gLinks = root.append("g").attr("class", "links");
    gNodes = root.append("g").attr("class", "nodes");
    zoomBehavior = d3.zoom().scaleExtent([0.4, 4]).on("zoom", function (e) { root.attr("transform", e.transform); });
    svg.call(zoomBehavior).on("dblclick.zoom", null);
    svg.on("click", function (e) { if (e.target === svg.node()) clearSelection(); });

    let nodes = GRAPH.nodes.map(function (n) { return Object.assign({}, n); });
    let links;
    if (view === "onto") {
      links = GRAPH.ontology_edges.map(function (e) { return { source: e.a, target: e.b, type: e.type, category: e.category, w: 1 }; });
    } else {
      links = GRAPH.cooccurrence_edges.filter(function (e) { return e[2] >= threshold; }).map(function (e) { return { source: e[0], target: e[1], w: e[2], type: "COOC" }; });
    }
    const degree = {}; links.forEach(function (l) { degree[l.source] = (degree[l.source] || 0) + 1; degree[l.target] = (degree[l.target] || 0) + 1; });
    let hidden = 0;
    if (view === "cooc") { hidden = nodes.filter(function (n) { return !degree[n.id]; }).length; nodes = nodes.filter(function (n) { return degree[n.id]; }); }
    nodes.forEach(function (n) { n.deg = degree[n.id] || 0; n.r = radius(n); n.lw = n.name.length * 12.5; });
    const wmax = d3.max(links, function (l) { return l.w; }) || 1;
    const lw = d3.scaleSqrt().domain([threshold || 1, wmax]).range([1, 7]);

    const link = gLinks.selectAll("path").data(links).join("path")
      .attr("class", function (l) { return "link link--" + l.type; })
      .attr("stroke-width", function (l) { return view === "cooc" ? lw(l.w) : 1.2; });
    link.each(function (l) {
      if (view !== "cooc") return;
      LZ.tip.bind(this, function () { return LZ.tip.rows(nameOf(l.source) + " ↔ " + nameOf(l.target), [["同时出现的章节实例", LZ.fmt(l.w)]]); });
    }).style("pointer-events", view === "cooc" ? "stroke" : "none");

    const node = gNodes.selectAll("g").data(nodes, function (d) { return d.id; }).join("g")
      .attr("class", "node").attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", function (d) { return d.name + "，" + LZ.typeZh(d.node_type); });
    node.append("path").attr("class", "mark");
    node.append("circle").attr("class", "hit").attr("r", function (d) { return Math.max(d.r + 6, 14); });
    node.append("text");
    node.on("click", function (e, d) { e.stopPropagation(); select(d.id); })
      .on("keydown", function (e, d) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(d.id); } })
      .each(function (d) {
        LZ.tip.bind(this, function () {
          return LZ.tip.rows(d.name, [["层级", LZ.typeZh(d.node_type)], ["高特异性提及", LZ.fmt(d.high)], ["原始提及", LZ.fmt(d.raw)], [view === "cooc" ? "共现邻居" : "关系数", d.deg]], d.is_seed ? "手工种子概念" : "LLM 扩展概念");
        });
      })
      .call(d3.drag().on("start", function (e, d) { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", function (e, d) { d.fx = e.x; d.fy = e.y; })
        .on("end", function (e, d) { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    if (sim) sim.stop();
    sim = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(view === "cooc" ? -220 : -140))
      .force("collide", d3.forceCollide().radius(function (d) { return Math.max(d.r + 8, d.lw / 2 + 6); }).iterations(2))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("x", d3.forceX(W / 2).strength(0.04)).force("y", d3.forceY(H / 2).strength(0.05));
    if (view === "onto") {
      sim.force("link", d3.forceLink(links).id(function (d) { return d.id; }).distance(58).strength(0.9))
        .force("radial", d3.forceRadial(function (d) { return d.stratum === "atomic" ? Math.min(W, H) * 0.2 : Math.min(W, H) * 0.44; }, W / 2, H / 2).strength(function (d) { return d.deg ? 0.35 : 0.9; }));
    } else {
      sim.force("link", d3.forceLink(links).id(function (d) { return d.id; }).distance(function (l) { return 50 + 150 * (1 - l.w / wmax); }).strength(function (l) { return 0.15 + 0.6 * l.w / wmax; }));
    }
    sim.on("tick", function () {
      link.attr("d", function (l) { return "M" + l.source.x + "," + l.source.y + "L" + l.target.x + "," + l.target.y; });
      node.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
    });
    svgSel = svg;
    restyle();
    $("graph-stat").textContent = view === "onto"
      ? "111 个节点 · 67 条本体关系（32 条词形包含 · 25 条语义 · 5 条实现 · 5 条象征）"
      : nodes.length + " 个概念 · " + links.length + " 条共现边（阈值 ≥ " + threshold + " 个章节实例）· " + hidden + " 个概念在此阈值下无共现边，未显示（单字概念不参与共现统计）";
    if (selected) applySelection();
  }

  function restyle(resize) {
    if (!gNodes) return;
    gNodes.selectAll("g.node").each(function (d) {
      if (resize) d.r = radius(d);
      const g = d3.select(this);
      const color = LZ.typeColor(d.node_type);
      const ring = isRing(d);
      g.select("path.mark").attr("d", d3.symbol().type(symbolFor(d)).size(Math.PI * d.r * d.r * (LZ.TYPE_META[d.node_type].shape ? 1.15 : 1))())
        .attr("fill", ring ? LZ.cssVar("--paper-2") : color).attr("stroke", ring ? color : LZ.cssVar("--paper-2")).attr("stroke-width", ring ? 2.5 : 1.5)
        .attr("opacity", d.attested ? 1 : 0.55);
      g.select("circle.hit").attr("r", Math.max(d.r + 6, 14));
      g.select("text").attr("x", 0).attr("y", d.r + 13).attr("text-anchor", "middle").text(d.name).attr("font-weight", d.is_seed ? 700 : 400);
    });
    if (resize && sim) { sim.force("collide").radius(function (d) { return Math.max(d.r + 8, d.lw / 2 + 6); }); sim.alpha(0.3).restart(); }
  }
  function nameOf(x) { const id = typeof x === "object" ? x.id : x; return byId[id] ? byId[id].name : id; }

  function highlightSearch(ids) {
    if (!gNodes) return;
    if (!ids) { gNodes.selectAll("g.node").classed("is-dim", false); gLinks.selectAll("path").classed("is-dim", false); return; }
    const set = new Set(ids);
    gNodes.selectAll("g.node").classed("is-dim", function (d) { return !set.has(d.id); });
    gLinks.selectAll("path").classed("is-dim", true);
  }

  /* ---------- selection ---------------------------------------------- */
  function select(id, silent) {
    selected = id;
    if (!silent) LZ.hash.set({ c: id }, true);
    applySelection();
    renderPanel(byId[id]);
  }
  function clearSelection() {
    selected = null; LZ.hash.set({ c: null }, true);
    if (gNodes) { gNodes.selectAll("g.node").classed("is-dim", false).classed("is-sel", false); gLinks.selectAll("path").classed("is-dim", false); }
  }
  function applySelection() {
    if (!gNodes || !selected) return;
    if (gNodes.selectAll("g.node").filter(function (d) { return d.id === selected; }).empty()) { gNodes.selectAll("g.node").classed("is-dim", false).classed("is-sel", false); gLinks.selectAll("path").classed("is-dim", false); return; }
    const neigh = new Set([selected]);
    gLinks.selectAll("path").each(function (l) { const a = l.source.id || l.source, b = l.target.id || l.target; if (a === selected) neigh.add(b); if (b === selected) neigh.add(a); });
    gNodes.selectAll("g.node").classed("is-dim", function (d) { return !neigh.has(d.id); }).classed("is-sel", function (d) { return d.id === selected; });
    gLinks.selectAll("path").classed("is-dim", function (l) { const a = l.source.id || l.source, b = l.target.id || l.target; return a !== selected && b !== selected; });
  }

  /* ---------- panel --------------------------------------------------- */
  function renderPanel(c) {
    const p = LZ.clear($("panel"));
    const st = c.stats;
    p.appendChild(LZ.el("h2.panel__title", c.name, LZ.el("small", c.id)));
    const sub = LZ.el("div.panel__sub", LZ.typeBadge(c.node_type), LZ.badge(c.stratum === "atomic" ? "原子概念" : "复合条目"),
      c.is_seed ? LZ.badge("手工种子") : LZ.badge("LLM 扩展 · " + c.generated_by, "ai"), LZ.badge("node_type 未审核", "unreviewed"));
    if (!c.attested) sub.appendChild(LZ.badge("语料中无文本证据", "unreviewed"));
    p.appendChild(sub);
    p.appendChild(LZ.el("p.def", c.definition));
    if (c.attestation_note) p.appendChild(LZ.el("p.small.muted", c.attestation_note));
    if (c.category) p.appendChild(LZ.el("p.small.muted", "原始类目：" + c.category + (c.subcategory ? " / " + c.subcategory : "") + "（仅供追溯 v1.0.0，请使用 node_type）"));

    p.appendChild(LZ.el("div.cta-row", { style: { marginTop: "10px" } }, LZ.el("a.btn.btn--sm", { href: "graph.html#n=C:" + encodeURIComponent(c.id) }, "在图谱中浏览")));
    // canonical chapters
    const sec1 = LZ.el("div.panel__section", LZ.el("h4", "典型章次 · canonical loci"));
    if (c.canonical_chapters.length) sec1.appendChild(LZ.el("div.chips", c.canonical_chapters.map(function (n) { return LZ.chip("第 " + n + " 章", "chapters.html#ch=" + n, "chip--ch"); })));
    else sec1.appendChild(LZ.el("p.panel__empty", "未标注"));
    p.appendChild(sec1);

    // mention stats
    const sec2 = LZ.el("div.panel__section", LZ.el("h4", "文献文本中的词汇提及 · 默认分析集"));
    sec2.appendChild(LZ.el("dl.kv",
      LZ.el("dt", "原始提及"), LZ.el("dd", LZ.fmt(st.raw), LZ.el("span.muted.small", "（全量语料 " + LZ.fmt(st.raw_full_corpus) + "）")),
      LZ.el("dt", "高特异性"), LZ.el("dd", LZ.fmt(st.high)),
      LZ.el("dt", "每万字"), LZ.el("dd", st.per_10k.toFixed(2) + " 次"),
      LZ.el("dt", "覆盖"), LZ.el("dd", LZ.fmt(st.instances) + " 个章节实例 · " + LZ.fmt(st.witnesses) + " 种文献"),
      LZ.el("dt", "匹配特异性"), LZ.el("dd", { high: "高（≥3 字）", medium: "中（2 字）", low: "低（单字，同为常用词）" }[c.specificity])));
    sec2.appendChild(LZ.el("div.tiers",
      LZ.el("div.tier", LZ.el("b", LZ.fmt(st.tier_high)), LZ.el("span", "高 high")),
      LZ.el("div.tier", LZ.el("b", LZ.fmt(st.tier_medium)), LZ.el("span", "中 medium")),
      LZ.el("div.tier", LZ.el("b", LZ.fmt(st.tier_low)), LZ.el("span", "低 low"))));
    if (c.by_chapter.length) {
      const vals = new Array(81).fill(0);
      c.by_chapter.forEach(function (b) { if (b[0] >= 1 && b[0] <= 81) vals[b[0] - 1] = b[1]; });
      sec2.appendChild(LZ.el("h4", { style: { marginTop: "12px" } }, "各章提及次数（第 1 – 81 章）"));
      sec2.appendChild(LZ.spark(vals, { color: LZ.layerColor("mention"), label: "提及次数", onClick: function (n) { location.href = "chapters.html#ch=" + n; } }));
    }
    p.appendChild(sec2);

    // top witnesses
    if (c.top_witnesses.length) {
      const sec3 = LZ.el("div.panel__section", LZ.el("h4", "提及最多的文献"));
      sec3.appendChild(LZ.bars(c.top_witnesses.map(function (t) { const w = WIDX[t[0]] || {}; return { label: w.t || t[0], value: t[1], href: "witnesses.html#id=" + encodeURIComponent(t[0]) }; }), { labelWidth: "130px", color: LZ.layerColor("mention") }));
      p.appendChild(sec3);
    }

    // commentary
    const sec4 = LZ.el("div.panel__section", LZ.el("h4", "注疏 · " + LZ.fmt(c.commentary.total) + " 条，其中 " + LZ.fmt(c.commentary.citable) + " 条可作原文引用"));
    if (c.commentary.total) {
      sec4.appendChild(LZ.bars(c.commentary.by_era.map(function (e) { return { label: e[0], value: e[1] }; }), { labelWidth: "72px", color: LZ.layerColor("commentary") }));
      if (c.commentary.by_commentator.length) sec4.appendChild(LZ.el("p.small.muted", { style: { marginTop: "8px" } }, "主要注家：" + c.commentary.by_commentator.slice(0, 5).map(function (x) { return x[0] + "（" + x[1] + "）"; }).join("、")));
      sec4.appendChild(LZ.el("div.cta-row", { style: { marginTop: "10px" } }, LZ.el("button.btn.btn--sm", { type: "button", onClick: function () { LZ.detail.openCommentaryList({ title: "训释「" + c.name + "」的注疏条目", filter: function (r) { return r.concept_id === c.id; } }); } }, "查看全部 " + LZ.fmt(c.commentary.total) + " 条条目")));
    } else sec4.appendChild(LZ.el("p.panel__empty", "注疏层未覆盖此概念（注疏层只覆盖 33 个概念）。"));
    p.appendChild(sec4);

    // relations
    const sec5 = LZ.el("div.panel__section", LZ.el("h4", "本体关系"));
    const ul = LZ.el("ul.rel-list");
    c.relations_out.forEach(function (r) { ul.appendChild(relItem(c.name, r.type, byId[r.to], r)); });
    c.relations_in.forEach(function (r) { ul.appendChild(relItem(byId[r.from], r.type, c.name, r, true)); });
    if (!ul.children.length) ul.appendChild(LZ.el("li.panel__empty", "没有类型化关系（关系层刻意保持稀疏）。"));
    sec5.appendChild(ul);
    p.appendChild(sec5);
  }
  function relItem(a, type, b, r, inbound) {
    const left = typeof a === "string" ? LZ.el("span", a) : LZ.el("a", { href: "#c=" + a.id, onClick: function (e) { e.preventDefault(); select(a.id); } }, a.name);
    const right = typeof b === "string" ? LZ.el("span", b) : LZ.el("a", { href: "#c=" + b.id, onClick: function (e) { e.preventDefault(); select(b.id); } }, b.name);
    const li = LZ.el("li", left, LZ.el("span.rel", (LZ.REL_ZH[type] || type) + " " + type), right, LZ.badge(LZ.RELCAT_ZH[r.category] || r.category, r.source === "deterministic_name_containment" ? null : "ai"));
    return li;
  }

  /* ---------- table --------------------------------------------------- */
  function buildTable() {
    const cols = [
      { key: "name", label: "概念", sort: function (c) { return c.name; }, render: function (c) { return LZ.el("span", LZ.el("b", c.name), LZ.el("span.sub", c.definition)); } },
      { key: "node_type", label: "层级", sort: function (c) { return LZ.TYPE_ORDER.indexOf(c.node_type); }, render: function (c) { return LZ.typeBadge(c.node_type); } },
      { key: "is_seed", label: "来源", cls: "hide-sm", sort: function (c) { return c.is_seed ? 0 : 1; }, render: function (c) { return c.is_seed ? "种子" : LZ.badge("LLM", "ai"); } },
      { key: "specificity", label: "特异性", cls: "hide-sm", sort: function (c) { return { high: 0, medium: 1, low: 2 }[c.specificity]; }, render: function (c) { return { high: "高", medium: "中", low: "低" }[c.specificity]; } },
      { key: "raw", label: "原始提及", num: true, sort: function (c) { return c.stats.raw; }, render: function (c) { return LZ.fmt(c.stats.raw); } },
      { key: "high", label: "高特异性", num: true, sort: function (c) { return c.stats.high; }, render: function (c) { return LZ.fmt(c.stats.high); } },
      { key: "per10k", label: "每万字", num: true, cls: "hide-sm", sort: function (c) { return c.stats.per_10k; }, render: function (c) { return c.stats.per_10k.toFixed(2); } },
      { key: "witnesses", label: "文献数", num: true, cls: "hide-sm", sort: function (c) { return c.stats.witnesses; }, render: function (c) { return LZ.fmt(c.stats.witnesses); } },
      { key: "commentary", label: "注疏", num: true, sort: function (c) { return c.commentary.total; }, render: function (c) { return LZ.fmt(c.commentary.total); } },
      { key: "chapters", label: "典型章次", cls: "hide-sm", render: function (c) { return c.canonical_chapters.join("、") || "—"; } }
    ];
    $("concept-table").appendChild(LZ.table(CONCEPTS, cols, { sortKey: "raw", sortDir: "desc", compact: true, onRow: function (c) { select(c.id); $("panel").scrollIntoView({ block: "nearest" }); } }));
  }
})();
