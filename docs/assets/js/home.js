/* home page */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };

  LZ.load("summary").then(function (S) {
    const c = S.counts;
    LZ.setEras(S.era_order, S.era_span);
    $("hero-version").textContent = "v" + S.version;

    /* ---- stats ------------------------------------------------------- */
    const stats = [
      { v: c.resources, l: "文献资源", n: c.source_witnesses + " 种历史文献 + " + c.derived_resources + " 种现代整理本" },
      { v: c.default_include_instances, l: "章节实例（默认分析集）", n: "另有 " + c.recovered_unreviewed_instances + " 例自动恢复待审核、" + c.unaligned_instances + " 个未对齐单元", accent: true },
      { v: c.sentences, l: "句子", n: "公开版保留句级结构与字数，第三方转录文本撤除" },
      { v: c.concepts, l: "概念", n: c.seed_concepts + " 个手工种子 + " + c.llm_expanded_concepts + " 个 LLM 扩展；" + c.concepts_with_mentions + " 个有文本提及" },
      { v: c.variants, l: "候选异文事件", n: "与王弼本比对自动检出，无一经校勘确认" },
      { v: c.commentary, l: "注疏条目", n: c.citable_quotes + " 条可作原文引用（verbatim）" }
    ];
    const box = LZ.clear($("stats"));
    stats.forEach(function (s) {
      box.appendChild(LZ.el("div.stat" + (s.accent ? ".stat--accent" : ""),
        LZ.el("div.stat__value", LZ.fmt(s.v)), LZ.el("div.stat__label", s.l), LZ.el("div.stat__note", s.n)));
    });

    /* ---- gates ------------------------------------------------------- */
    const st = S.status;
    const gates = [
      { t: "公开发布", en: "Public distribution", code: st.public_distribution, pill: ["warn", "待作者与机构签署"],
        p: "公开结构版不含任何第三方转录的字符流，因而不受逐来源版权审查的限制；本站展示的正是这一版本。是否发布仍由作者及其机构决定。" },
      { t: "全量内部包", en: "Full internal package", code: st.full_distribution, pill: ["block", "版权审查未完成"],
        p: "全量包携带 175 种文献的转录文本；" + c.rights_rows + " 个来源中仅 " + c.rights_cleared + " 个（作者自有的整理本）完成审查。在审查完成之前不得再分发。" },
      { t: "科学验证", en: "Scientific validation", code: st.scientific_validation, pill: ["muted", "尚未进行"],
        p: "专家验证框架（TV1–TV6）已经就绪并可运行：本发行档 " + LZ.fmt(c.validation_frames_items) + " 项待判定，已判定 " + c.validation_adjudicated + " 项。这一门决定的是论文投稿，不是数据分发。" }
    ];
    const gc = LZ.clear($("gate-cards"));
    gates.forEach(function (g) {
      gc.appendChild(LZ.el("div.card.gate",
        LZ.el("div.gate__head", LZ.el("h3", g.t, " ", LZ.el("span.muted.small", { style: { fontFamily: "var(--sans)", fontWeight: 400, letterSpacing: "0.06em" } }, g.en)), LZ.el("span.pill.pill--" + g.pill[0], g.pill[1])),
        LZ.el("div.gate__code", g.code),
        LZ.el("p.card__body", g.p)));
    });
    $("gate-overall").textContent = "三者取合取，整体状态为 " + st.overall + "：这是一个发布候选（release candidate），而不是正式发布；正式发布日期在 Zenodo 存缴时确定。";

    /* ---- layers ------------------------------------------------------ */
    const g = S.graph.node_counts, r = S.graph.rel_counts;
    const layers = [
      { t: "来源层", en: "Source · 书目记录", color: "var(--c-structure)", boxes: [
        ["Version", g.Version, "witness_era_raw / normalized · work_type · resource_class"],
        ["Person", g.Person, "person_historical_era · " + g.PersonAlias + " 个别名"]] },
      { t: "文本层", en: "Text · 由来源确定性推导", color: "var(--teal)", boxes: [
        ["ChapterInstance", g.ChapterInstance, c.default_include_instances + " 默认 · " + c.recovered_unreviewed_instances + " 门控 · " + c.unaligned_instances + " 未对齐"],
        ["Sentence", g.Sentence, "偏移 · 字数（公开版撤除第三方文本）"]] },
      { t: "派生层", en: "Derived · 机器检出，未审核", color: "var(--c-commentary)", boxes: [
        ["Variant", g.Variant, "候选检出 · variant_detection_score"],
        ["Mention", c.mention_edges_default, "MENTIONS_CONCEPT · match_specificity 分层"],
        ["Commentary", g.Commentary, "text_provenance · citable_as_quote"]] },
      { t: "解释层", en: "Interpretive · LLM 生成，未审核", color: "var(--c-variant)", boxes: [
        ["Concept", g.Concept, "node_type · is_seed"],
        ["Relation", r.RELATED_CONCEPT, "relation_category（词形包含 / 语义 / 实现 / 象征）"],
        ["候选学术主张", g.CandidateScholarlyClaim, "derived_unverified/ · 不可作为学术观点引用"]] }
    ];
    const lb = LZ.clear($("layers"));
    layers.forEach(function (L) {
      lb.appendChild(LZ.el("div.layer", { style: { "--lc": L.color } },
        LZ.el("div.layer__head", LZ.el("h3", L.t), LZ.el("p", L.en)),
        LZ.el("div.layer__boxes", L.boxes.map(function (b) { return LZ.el("div.lbox", LZ.el("b", b[0], LZ.el("small", LZ.fmt(b[1]))), LZ.el("span", b[2])); }))));
    });

    /* ---- explore cards ---------------------------------------------- */
    const cards = [
      { href: "graph.html", t: "图谱浏览", en: "Graph explorer", p: "从任意文献、人物或概念出发，沿关系逐个展开邻居节点：文献含哪些章节实例，实例提及哪些概念，哪些注疏训释了它、出自谁手。", art: artExplorer },
      { href: "concepts.html", t: "概念图谱", en: "Concepts", p: "111 个概念、10 个层级、67 条类型化关系；按共现网络或本体关系两种方式浏览，并逐一查看提及统计与注疏分布。", art: artNetwork },
      { href: "witnesses.html", t: "文献", en: "Witnesses", p: "176 种资源的书目、时代、传承系统、对齐状态与版权处置；用「文献 × 章节」覆盖矩阵一眼看清每一种文献保存了哪些章。", art: artMatrix },
      { href: "chapters.html", t: "八十一章", en: "Chapters", p: "以九九之数排布的八十一章：每章的文献覆盖、候选异文密度、概念提及与注疏条目，并附王弼本经文与可引用的王弼注。", art: artGrid },
      { href: "persons.html", t: "人物", en: "Persons", p: "77 位注家与作者：自身的历史时代（与版本时代分开）、别名、所涉文献，以及时代争议的标记。", art: artTimeline },
      { href: "data.html", t: "数据与方法", en: "Data", p: "图谱模式、数据字典、文件清单与校验值、质量与验证状态、许可与引用；下载公开结构版。", art: artSchema }
    ];
    const ec = LZ.clear($("explore-cards"));
    cards.forEach(function (k) {
      const art = LZ.el("div.card__art", { "aria-hidden": "true" });
      art.appendChild(k.art());
      ec.appendChild(LZ.el("a.card.card--link", { href: k.href }, art,
        LZ.el("h3.card__title", k.t, LZ.el("span.en", k.en)), LZ.el("p.card__body", k.p)));
    });

    /* ---- era chart --------------------------------------------------- */
    drawEraChart(S.witness_era);
    const lin = S.lineage.map(function (x) { return { label: x[0], value: x[1], sub: LZ.LINEAGE_EN[x[0]] }; });
    $("lineage-chart").appendChild(LZ.bars(lin, { labelWidth: "150px", color: "var(--c-structure)", format: function (v) { return v + " 种"; } }));
    window.addEventListener("lz:theme", function () { drawEraChart(S.witness_era); });

    /* ---- notes numbers ---------------------------------------------- */
    $("n-era-pct").textContent = c.era_differ_pct + "%";
    $("n-single-pct").textContent = c.single_char_share_pct + "%";
    $("n-spearman").textContent = String(S.spearman_raw_vs_high_specificity).replace("-", "−");
    $("n-commentary").textContent = LZ.fmt(c.commentary);
    $("n-citable").textContent = LZ.fmt(c.citable_quotes);
    $("n-variants").textContent = LZ.fmt(c.variants);

    /* ---- figures ------------------------------------------------------ */
    const figZh = {
      fig1_corpus_composition: ["图 1 · 语料构成", "176 种资源按版本时代与体裁的构成、各传承系统中每种文献对齐的章数，以及资源的馆藏或转录来源。"],
      fig2_concept_cooccurrence: ["图 2 · 概念共现", "跨章节实例的概念共现网络：高/中特异性匹配、默认分析集；节点面积为出现次数，边宽为共现实例数。"],
      fig3_commentator_vs_witness_era: ["图 3 · 注家时代 × 版本时代", "注疏条目按注家自身时代与所读版本时代的交叉计数；朱红框为两者一致的对角线。"],
      fig4_concept_share_by_era: ["图 4 · 概念的时代演变", "六个最常被训释的概念在各时代注疏中的占比（按注家自身时代），附 95% Wilson 区间。"],
      fig5_architecture: ["图 5 · 四层架构", "每一层如何产生、各节点类型的记录数，以及哪些层被排除在默认分析集与发布之外。"],
      fig6_lineage_alignment: ["图 6 · 传承系统与对齐状态", "各系统的章节实例数与对齐状态，以及系统间的同书异本断言。"]
    };
    LZ.load("figures").then(function (F) {
      const fb = LZ.clear($("figs"));
      F.forEach(function (f) {
        const base = "assets/img/figures/" + f.file;
        const zh = figZh[f.id] || ["图 " + f.number + " · " + f.title, ""];
        fb.appendChild(LZ.el("figure.fig",
          LZ.el("a", { href: base + ".png", target: "_blank", rel: "noopener" },
            LZ.el("img", { src: base + ".png", alt: "Fig. " + f.number + " | " + f.title, loading: "lazy" })),
          LZ.el("figcaption", LZ.el("b", zh[0]), zh[1],
            LZ.el("div.fig__links",
              LZ.el("a", { href: base + ".pdf" }, "PDF（矢量）"), " · ",
              LZ.el("a", { href: base + "_" + f.print_dpi + "dpi.png" }, "PNG " + f.print_dpi + " dpi"), " · ",
              LZ.el("span.muted", f.width_mm + " × " + f.height_mm + " mm")),
            LZ.el("details.fig__legend", LZ.el("summary", "Fig. " + f.number + " legend (English)"),
              LZ.el("p", LZ.el("b", "Fig. " + f.number + " | " + f.title), " " + f.legend)))));
      });
    });

    /* ---- citation ----------------------------------------------------- */
    const names = S.authors.map(function (a) { return a.display; });
    $("cite-text").appendChild(LZ.el("span", names.join(", ") + " (" + (S.build_date || "2026").slice(0, 4) + "). "));
    $("cite-text").appendChild(LZ.el("b", S.title));
    $("cite-text").appendChild(LZ.el("span", ", version " + S.version + " (public structural release). Zenodo (DOI pending)."));
    const au = LZ.clear($("authors"));
    S.authors.forEach(function (a) {
      au.appendChild(LZ.el("div.author", LZ.el("b", a.display), LZ.el("span", a.affiliation), LZ.el("span.muted", a.role)));
    });
  });

  /* ---- charts ------------------------------------------------------- */
  function drawEraChart(data) {
    const host = LZ.clear(document.getElementById("era-chart"));
    const rows = data.filter(function (d) { return d[0] !== "不详"; });
    const unknown = data.find(function (d) { return d[0] === "不详"; });
    const W = 560, H = 250, m = { t: 12, r: 12, b: 42, l: 30 };
    const x = d3.scaleBand().domain(rows.map(function (d) { return d[0]; })).range([m.l, W - m.r]).paddingInner(0.25).paddingOuter(0.1);
    const y = d3.scaleLinear().domain([0, d3.max(rows, function (d) { return d[1]; })]).nice().range([H - m.b, m.t]);
    const svg = d3.select(host).append("svg").attr("viewBox", "0 0 " + W + " " + H).attr("role", "img").attr("aria-label", "各时代文献数量柱状图");
    svg.append("g").attr("class", "grid").selectAll("line").data(y.ticks(4)).join("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
    const color = LZ.layerColor("structure");
    const bw = Math.min(x.bandwidth(), 22);
    const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
      .attr("x", function (d) { return x(d[0]) + (x.bandwidth() - bw) / 2; }).attr("width", bw)
      .attr("y", function (d) { return y(d[1]); }).attr("height", function (d) { return y(0) - y(d[1]); })
      .attr("fill", color).attr("rx", 3).attr("tabindex", 0);
    bars.each(function (d) { LZ.tip.bind(this, function () { return LZ.tip.rows(d[0], [["文献数", d[1] + " 种"]]); }); });
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (H - m.b) + ")").call(d3.axisBottom(x).tickSize(0)).call(function (g) { g.select(".domain").remove(); })
      .selectAll("text").attr("transform", "rotate(-40)").attr("text-anchor", "end").attr("dx", "-0.4em").attr("dy", "0.3em");
    svg.append("g").attr("class", "axis").attr("transform", "translate(" + m.l + ",0)").call(d3.axisLeft(y).ticks(4).tickSize(0)).call(function (g) { g.select(".domain").remove(); });
    // direct labels on the three largest
    const top = rows.slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
    svg.append("g").selectAll("text").data(top).join("text").attr("x", function (d) { return x(d[0]) + x.bandwidth() / 2; }).attr("y", function (d) { return y(d[1]) - 5; })
      .attr("text-anchor", "middle").attr("font-size", 11).attr("fill", LZ.cssVar("--ink-2")).text(function (d) { return d[1]; });
    if (unknown) host.appendChild(LZ.el("p.small.muted", { style: { margin: "4px 8px 0" } }, "另有 " + unknown[1] + " 种时代不详，未计入图中。"));
  }

  /* ---- card art (decorative, generated) ------------------------------ */
  function artNetwork() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    const pts = [[150, 46], [70, 30], [95, 70], [210, 26], [235, 66], [120, 18], [190, 78], [40, 60], [265, 40]];
    const links = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [3, 5], [4, 6], [1, 7], [3, 8], [2, 6]];
    const cols = ["--t-ontological", "--t-cosmological", "--t-epistemic", "--t-cultivation", "--t-ethical", "--t-political", "--t-composite", "--t-cosmological", "--t-ethical"];
    links.forEach(function (l) { svg.appendChild(LZ.svg("line", { x1: pts[l[0]][0], y1: pts[l[0]][1], x2: pts[l[1]][0], y2: pts[l[1]][1], stroke: "var(--line-2)", "stroke-width": 1 })); });
    pts.forEach(function (p, i) { svg.appendChild(LZ.svg("circle", { cx: p[0], cy: p[1], r: i === 0 ? 9 : 5, fill: "var(" + cols[i] + ")" })); });
    return svg;
  }
  function artExplorer() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    const V = [150, 46], P = [70, 30], I1 = [210, 22], I2 = [225, 70], C1 = [275, 40], C2 = [265, 80], M = [110, 74], A = [30, 60];
    [[V, P], [V, I1], [V, I2], [I1, C1], [I2, C1], [I2, C2], [M, V], [M, C2], [P, A]].forEach(function (l) { svg.appendChild(LZ.svg("line", { x1: l[0][0], y1: l[0][1], x2: l[1][0], y2: l[1][1], stroke: "var(--line-2)", "stroke-width": 1 })); });
    svg.appendChild(LZ.svg("rect", { x: V[0] - 10, y: V[1] - 10, width: 20, height: 20, rx: 3, fill: "var(--k-version)" }));
    svg.appendChild(LZ.svg("circle", { cx: P[0], cy: P[1], r: 8, fill: "var(--k-person)" }));
    svg.appendChild(LZ.svg("circle", { cx: A[0], cy: A[1], r: 4, fill: "none", stroke: "var(--k-person)", "stroke-width": 2 }));
    [I1, I2].forEach(function (p) { svg.appendChild(LZ.svg("rect", { x: p[0] - 9, y: p[1] - 6, width: 18, height: 12, rx: 2, fill: "var(--k-instance)" })); });
    [C1, C2].forEach(function (p) { svg.appendChild(LZ.svg("path", { d: "M" + p[0] + "," + (p[1] - 9) + "L" + (p[0] + 9) + "," + p[1] + "L" + p[0] + "," + (p[1] + 9) + "L" + (p[0] - 9) + "," + p[1] + "z", fill: "var(--k-concept)" })); });
    svg.appendChild(LZ.svg("path", { d: "M" + M[0] + "," + (M[1] - 8) + "L" + (M[0] + 8) + "," + (M[1] + 6) + "L" + (M[0] - 8) + "," + (M[1] + 6) + "z", fill: "var(--k-commentary)" }));
    return svg;
  }
  function artMatrix() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    let seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (let r = 0; r < 7; r++) for (let c = 0; c < 30; c++) {
      const on = rnd() > 0.45 - r * 0.03;
      svg.appendChild(LZ.svg("rect", { x: 8 + c * 9.6, y: 6 + r * 12, width: 7.5, height: 9.5, rx: 1.5, fill: on ? "var(--c-structure)" : "var(--paper-4)", opacity: on ? 0.55 + rnd() * 0.45 : 0.6 }));
    }
    return svg;
  }
  function artGrid() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const v = 0.15 + ((r * 9 + c) * 37 % 23) / 23 * 0.85;
      svg.appendChild(LZ.svg("rect", { x: 22 + c * 29, y: 6 + r * 28, width: 24, height: 24, rx: 3, fill: "var(--c-variant)", opacity: v }));
    }
    return svg;
  }
  function artTimeline() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    svg.appendChild(LZ.svg("line", { x1: 12, x2: 288, y1: 46, y2: 46, stroke: "var(--line-2)" }));
    [20, 48, 60, 95, 120, 150, 170, 182, 205, 230, 250, 272].forEach(function (x, i) {
      const y = 46 + (i % 3 - 1) * 16;
      svg.appendChild(LZ.svg("circle", { cx: x, cy: y, r: 4 + (i * 7 % 4), fill: "var(--c-structure)", opacity: 0.85 }));
    });
    return svg;
  }
  function artSchema() {
    const svg = LZ.svg("svg", { viewBox: "0 0 300 92", "aria-hidden": "true" });
    const boxes = [[20, 12], [120, 12], [220, 12], [70, 54], [170, 54]];
    boxes.forEach(function (b, i) { svg.appendChild(LZ.svg("rect", { x: b[0], y: b[1], width: 60, height: 26, rx: 4, fill: "none", stroke: "var(--c-structure)", "stroke-width": 1.2 })); });
    [[50, 38, 100, 54], [150, 38, 100, 54], [150, 38, 200, 54], [250, 38, 200, 54]].forEach(function (l) { svg.appendChild(LZ.svg("line", { x1: l[0], y1: l[1], x2: l[2], y2: l[3], stroke: "var(--line-2)" })); });
    return svg;
  }
})();
