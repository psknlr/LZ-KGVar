/* witnesses page: filters + coverage matrix + table + detail drawer */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  let S, W, byId = {}, table, filtered = [];

  LZ.loadAll(["summary", "witnesses"]).then(function (r) {
    S = r[0]; W = r[1];
    LZ.setEras(S.era_order, S.era_span);
    W.forEach(function (w) { byId[w.id] = w; });
    buildFilters();
    buildTable();
    apply();
    const id = LZ.hash.get("id");
    if (id && byId[id]) openDetail(byId[id]);
    window.addEventListener("hashchange", function () { const id = LZ.hash.get("id"); if (id && byId[id]) openDetail(byId[id]); });
    window.addEventListener("lz:theme", drawMatrix);
    LZ.drawer.onClose = function () { LZ.hash.set({ id: null }, true); };
  }).catch(function (e) { console.error(e); $("wtable").textContent = "数据加载失败：" + e.message; });

  /* ---------- filters -------------------------------------------------- */
  function fill(sel, values, labeler) {
    values.forEach(function (v) { sel.appendChild(LZ.el("option", { value: v }, labeler ? labeler(v) : v)); });
  }
  function buildFilters() {
    const eras = Array.from(new Set(W.map(function (w) { return w.era; }))).sort(function (a, b) { return LZ.eraIndex(a) - LZ.eraIndex(b); });
    fill($("f-era"), eras);
    fill($("f-lineage"), S.lineage.map(function (x) { return x[0]; }));
    fill($("f-type"), S.work_type.map(function (x) { return x[0]; }), function (v) { return (LZ.WORK_TYPE_ZH[v] || v) + " · " + v; });
    fill($("f-disp"), ["full_text", "metadata_and_offsets", "reference_only"], function (v) { return LZ.DISP_ZH[v] + " · " + v; });
    ["f-era", "f-lineage", "f-type", "f-disp", "f-aligned"].forEach(function (id) { $(id).addEventListener("change", apply); });
    $("q").addEventListener("input", LZ.debounce(apply, 120));
    const p = LZ.hash;
    if (p.get("era")) $("f-era").value = p.get("era");
    if (p.get("lineage")) $("f-lineage").value = p.get("lineage");
  }
  function apply() {
    const q = $("q").value.trim().toLowerCase();
    const era = $("f-era").value, lin = $("f-lineage").value, typ = $("f-type").value, disp = $("f-disp").value, aligned = $("f-aligned").checked;
    filtered = W.filter(function (w) {
      if (era && w.era !== era) return false;
      if (lin && w.lineage !== lin) return false;
      if (typ && w.work_type !== typ) return false;
      if (disp && w.disposition !== disp) return false;
      if (aligned && !w.chapters.length) return false;
      if (q) {
        const hay = (w.title + " " + w.author_raw + " " + w.id + " " + w.edition + " " + w.persons.map(function (p) { return p.name; }).join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    $("count").textContent = "显示 " + filtered.length + " / " + W.length + " 种";
    table.update(filtered);
    drawMatrix();
  }

  /* ---------- matrix --------------------------------------------------- */
  function drawMatrix() {
    const rows = filtered.filter(function (w) { return w.chapters.length || w.chapters_recovered.length; });
    const svg = d3.select("#matrix");
    svg.selectAll("*").remove();
    const labelW = 250, cell = 12, gap = 2, top = 46, eraW = 54;
    const W_ = labelW + eraW + 81 * (cell + gap) + 16, H_ = top + rows.length * (cell + gap) + 10;
    svg.attr("width", W_).attr("height", H_).attr("viewBox", [0, 0, W_, H_]);
    $("matrix-note").textContent = rows.length + " 种文献有对齐章节 · 列：第 1 – 81 章 · 实心：默认分析集 · 虚框：自动恢复待审核";
    if (!rows.length) { svg.append("text").attr("x", 12).attr("y", 30).attr("fill", LZ.cssVar("--ink-3")).attr("font-size", 13).text("没有符合条件、且有对齐章节的文献。"); return; }
    const x0 = labelW + eraW;
    const col = LZ.layerColor("structure"), gold = LZ.cssVar("--gold"), empty = LZ.cssVar("--paper-4");
    // column labels every chapter (small), emphasised every 9
    const cl = svg.append("g").attr("class", "collab");
    for (let ch = 1; ch <= 81; ch++) {
      cl.append("text").attr("x", x0 + (ch - 1) * (cell + gap) + cell / 2).attr("y", top - 8).attr("text-anchor", "middle").attr("font-weight", ch % 9 === 0 || ch === 1 ? 700 : 400).attr("opacity", ch % 9 === 0 || ch === 1 ? 1 : 0.55).text(ch);
    }
    svg.append("text").attr("x", x0).attr("y", 16).attr("font-size", 11).attr("fill", LZ.cssVar("--ink-3")).text("章 →");
    // era bands
    const eg = svg.append("g").attr("class", "erabar");
    let lastEra = null;
    rows.forEach(function (w, i) {
      const y = top + i * (cell + gap);
      if (w.era !== lastEra) {
        eg.append("line").attr("x1", 0).attr("x2", W_).attr("y1", y - 1).attr("y2", y - 1).attr("stroke", LZ.cssVar("--line")).attr("stroke-width", 1);
        eg.append("text").attr("x", labelW + 4).attr("y", y + cell - 2).text(w.era);
        lastEra = w.era;
      }
    });
    const g = svg.append("g");
    rows.forEach(function (w, i) {
      const y = top + i * (cell + gap);
      const lab = g.append("text").attr("class", "rowlab").attr("x", labelW - 8).attr("y", y + cell - 2).attr("text-anchor", "end").text(shorten(w.title, 18));
      lab.on("click", function () { openDetail(w); });
      lab.append("title").text(w.title + " · " + w.author_raw);
      const set = new Set(w.chapters), rec = new Set(w.chapters_recovered);
      for (let ch = 1; ch <= 81; ch++) {
        const on = set.has(ch), r = rec.has(ch);
        const rect = g.append("rect").attr("class", "cell").attr("x", x0 + (ch - 1) * (cell + gap)).attr("y", y).attr("width", cell).attr("height", cell).attr("rx", 2)
          .attr("fill", on ? col : (r ? "transparent" : empty)).attr("opacity", on ? 0.92 : 1)
          .attr("stroke", r ? gold : "none").attr("stroke-width", r ? 1.2 : 0).attr("stroke-dasharray", r ? "2 1.5" : null);
        if (on || r) {
          rect.on("click", function () { location.href = "chapters.html#ch=" + ch; });
          LZ.tip.bind(rect.node(), function () { return LZ.tip.rows(w.title, [["章", "第 " + ch + " 章"], ["状态", on ? "默认分析集" : "自动恢复 · 待审核"], ["时代", w.era]], "点击前往该章"); });
        }
      }
    });
  }
  function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  /* ---------- table ---------------------------------------------------- */
  function buildTable() {
    const cols = [
      { key: "title", label: "文献", sort: function (w) { return w.title; }, render: function (w) { return LZ.el("span", LZ.el("span.wtitle", w.title), LZ.el("span.wsub", w.author_raw + (w.edition ? " · " + w.edition : ""))); } },
      { key: "era", label: "时代", sort: function (w) { return LZ.eraIndex(w.era); }, render: function (w) { return w.era + (w.era_ambiguous ? " ?" : ""); } },
      { key: "lineage", label: "传承系统", cls: "hide-sm", sort: function (w) { return w.lineage; } },
      { key: "work_type", label: "体裁", cls: "hide-sm", sort: function (w) { return w.work_type; }, render: function (w) { return LZ.WORK_TYPE_ZH[w.work_type] || w.work_type; } },
      { key: "chapters", label: "对齐章", num: true, sort: function (w) { return w.chapters.length; }, render: function (w) { return w.chapters.length ? String(w.chapters.length) + (w.chapters_recovered.length ? " +" + w.chapters_recovered.length : "") : (w.disposition === "reference_only" ? "—" : "0"); } },
      { key: "variants", label: "候选异文", num: true, cls: "hide-sm", sort: function (w) { return w.variants; }, render: function (w) { return w.variants ? LZ.fmt(w.variants) : "—"; } },
      { key: "commentary", label: "注疏", num: true, cls: "hide-sm", sort: function (w) { return w.commentary; }, render: function (w) { return w.commentary ? LZ.fmt(w.commentary) : "—"; } },
      { key: "disposition", label: "公开处置", sort: function (w) { return w.disposition; }, render: function (w) { return LZ.badge(LZ.DISP_ZH[w.disposition] || w.disposition, w.disposition === "full_text" ? "ok" : (w.disposition === "reference_only" ? "unreviewed" : null)); } }
    ];
    table = LZ.table([], cols, { sortKey: "era", sortDir: "asc", compact: true, onRow: openDetail, empty: "没有符合条件的文献" });
    $("wtable").appendChild(table);
  }

  /* ---------- detail --------------------------------------------------- */
  function openDetail(w) {
    LZ.hash.set({ id: w.id }, true);
    const render = function () { return buildDetail(w); };
    LZ.detail.enter(render);
    LZ.drawer.open(render());
  }
  function buildDetail(w) {
    const content = [];
    content.push(LZ.el("div.eyebrow.eyebrow--plain", w.id));
    content.push(LZ.el("h2", w.title));
    content.push(LZ.el("p", { style: { color: "var(--ink-2)", margin: "0 0 10px" } }, w.author_raw + (w.edition ? " · " + w.edition : "")));
    const badges = LZ.el("div.chips", { style: { marginBottom: "6px" } },
      LZ.badge(LZ.DISP_ZH[w.disposition] || w.disposition, w.disposition === "full_text" ? "ok" : (w.disposition === "reference_only" ? "unreviewed" : null)),
      LZ.badge((LZ.WORK_TYPE_ZH[w.work_type] || w.work_type) + " · work_type 未审核", "ai"),
      LZ.badge(LZ.SCOPE_ZH[w.textual_scope] || w.textual_scope),
      LZ.badge(LZ.ALIGN_ZH[w.alignment_status] || w.alignment_status),
      w.is_fragment ? LZ.badge("残片 / 残写本") : null,
      w.resource_class === "modern_derived_resource" ? LZ.badge("现代整理本", "ok") : null);
    content.push(badges);
    if (w.disposition === "reference_only") content.push(LZ.el("div.callout", LZ.el("b", "仅书目记录。"), " 此资源的数字来源无法以足够置信度确定，公开结构版只保留书目行；其章节、句子、异文与提及数据均未随公开版发布（书目记录的对齐章数为 " + w.record_aligned_chapters + "）。"));
    if (w.disposition === "full_text") content.push(LZ.el("div.callout.callout--indigo", LZ.el("b", "作者自有资源。"), " 数据集作者的现代整理本，权利已清（redistribution_status = " + w.rights_status + "），是公开版中唯一携带文本的资源；八十一章的经文见「章节」页。"));

    content.push(LZ.el("div.dl-grid",
      LZ.el("div.chap-stat", LZ.el("b", String(w.chapters.length)), LZ.el("span", "对齐章（默认集）" + (w.chapters_recovered.length ? " +" + w.chapters_recovered.length + " 待审核" : ""))),
      LZ.el("div.chap-stat", LZ.el("b", LZ.fmt(w.sentences)), LZ.el("span", LZ.fmt(w.chars) + " 字 · " + w.instances + " 个单元")),
      LZ.el("div.chap-stat", LZ.el("b", LZ.fmt(w.variants)), LZ.el("span", "候选异文 · " + w.variant_run_instances + " 个实例运行检测")),
      LZ.el("div.chap-stat", LZ.el("b", LZ.fmt(w.mention_edges)), LZ.el("span", "概念提及边")),
      LZ.el("div.chap-stat", LZ.el("b", LZ.fmt(w.commentary)), LZ.el("span", "注疏条目")),
      LZ.el("div.chap-stat", LZ.el("b", String(w.unaligned_units)), LZ.el("span", "未对齐单元"))));

    // chapter strip
    if (w.chapters.length || w.chapters_recovered.length) {
      const set = new Set(w.chapters), rec = new Set(w.chapters_recovered);
      const strip = LZ.el("div.ch-strip");
      for (let ch = 1; ch <= 81; ch++) {
        const i = LZ.el("i" + (set.has(ch) ? ".on" : (rec.has(ch) ? ".rec" : "")), { title: "第 " + ch + " 章" + (set.has(ch) || rec.has(ch) ? " · 点击查看实例" : "") });
        if (set.has(ch) || rec.has(ch)) { i.style.cursor = "pointer"; i.addEventListener("click", function () { LZ.detail.openInstanceByWitness(ch, w.id, { push: true }); }); }
        strip.appendChild(i);
      }
      const sec = LZ.el("div.dsec", LZ.el("h4", "章节覆盖 · 第 1 – 81 章 · 点击格子查看该章实例"), strip);
      const comp = w.composition || {};
      const ck = Object.keys(comp).filter(function (k) { return k !== "unknown"; });
      if (ck.length) sec.appendChild(LZ.el("p.small.muted", { style: { marginTop: "6px" } }, "文本构成：" + ck.map(function (k) { return LZ.COMP_ZH[k] + " " + comp[k]; }).join(" · ") + (w.base_text_share_median !== null ? " · 经文占比中位数上限 " + LZ.pct(w.base_text_share_median, 0) : "")));
      content.push(sec);
    }

    // metadata
    const kv = LZ.el("dl.kv",
      LZ.el("dt", "时代"), LZ.el("dd", w.era + (w.era_raw && w.era_raw !== w.era ? "（原记 " + w.era_raw + "）" : "") + (w.era_ambiguous ? " · 双朝代标签，存疑" : "")),
      LZ.el("dt", "传承系统"), LZ.el("dd", w.lineage + (LZ.LINEAGE_EN[w.lineage] ? " · " + LZ.LINEAGE_EN[w.lineage] : "")),
      LZ.el("dt", "来源结构单元"), LZ.el("dd", String(w.structural_units) + "（文献自身的卷/节/章标题数）"),
      LZ.el("dt", "对齐状态"), LZ.el("dd", (LZ.ALIGN_ZH[w.alignment_status] || w.alignment_status) + (w.unresolved_reason && w.unresolved_reason !== "not_applicable" ? " · " + w.unresolved_reason : "")),
      LZ.el("dt", "标签"), LZ.el("dd", w.tags || "—"),
      LZ.el("dt", "数字来源"), LZ.el("dd", w.provider + (w.provider_confidence ? "（推断置信度 " + w.provider_confidence + "）" : "")),
      LZ.el("dt", "权利状态"), LZ.el("dd", w.rights_status + " · 原著" + (w.public_domain_by_age === "yes_by_age" ? "因年代久远属公有领域" : "：" + w.public_domain_by_age) + "；转录层权利" + (w.disposition === "full_text" ? "已清" : "未定")));
    content.push(LZ.el("div.dsec", LZ.el("h4", "书目与权利"), kv));

    // persons
    if (w.persons.length) {
      content.push(LZ.el("div.dsec", LZ.el("h4", "作者与注家"), LZ.el("div.chips", w.persons.map(function (p) {
        return LZ.chip([p.name + "（" + (p.role_raw || p.edge_type) + "）", p.status !== "named" ? LZ.el("span.n", p.status) : null], "persons.html#id=" + encodeURIComponent(p.id));
      }))));
    }
    // same work
    if (w.same_work.length) {
      content.push(LZ.el("div.dsec", LZ.el("h4", "同书异本断言 · SAME_WORK_EDITION"), LZ.el("ul", { style: { margin: 0, paddingLeft: "1.2em", fontSize: "14px" } }, w.same_work.map(function (s) {
        return LZ.el("li", LZ.el("a", { href: "#id=" + encodeURIComponent(s.other), onClick: function (e) { e.preventDefault(); if (byId[s.other]) openDetail(byId[s.other]); } }, s.other_title), LZ.el("span.muted.small", " · " + s.basis + "（置信 " + s.confidence + " · 可靠性 " + s.reliability + "）"));
      }))));
    }
    if (w.unaligned_units) content.push(LZ.el("div.dsec", LZ.el("h4", "未对齐单元"), LZ.el("button.btn.btn--sm", { type: "button", onClick: function () { LZ.detail.openInstanceByWitness("unaligned", w.id, { push: true }); } }, "查看未对齐单元的结构")));
    content.push(LZ.el("div.cta-row", { style: { marginTop: "18px" } },
      LZ.el("a.btn.btn--sm.btn--primary", { href: "graph.html#n=V:" + encodeURIComponent(w.id) }, "在图谱中浏览此文献"),
      w.commentary ? LZ.el("button.btn.btn--sm", { type: "button", onClick: function () { LZ.detail.openCommentaryList({ title: w.title + " · 注疏条目", hideWitness: true, push: true, filter: function (r) { return r.version_id === w.id; } }); } }, "查看 " + LZ.fmt(w.commentary) + " 条注疏条目") : null));
    content.push(LZ.el("p.small.muted", { style: { marginTop: "18px" } }, "work_type 与 textual_scope 由 MiniMax-M3 标注，均未经审核；witness_era 为书目记录自身的说法。"));
    return content;
  }
})();
