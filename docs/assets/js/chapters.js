/* chapters page: 9×9 grid with metric toggle + chapter detail */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  let S, CH, WIDX, CONC, VAR, byNum = {};
  let metric = "coverage";
  let current = null;
  const METRICS = {
    coverage: { label: "文献覆盖", layer: "structure", value: function (c) { return c.witnesses.length; }, fmt: function (v) { return v + " 种文献"; }, note: "有多少种文献保存了这一章（默认分析集，不含自动恢复待审核的实例）。" },
    variants: { label: "候选异文密度", layer: "variant", value: function (c) { return c.variants.run_instances ? c.variants.total / c.variants.run_instances : 0; }, fmt: function (v) { return v.toFixed(1) + " 事件 / 实例"; }, note: "每个运行了异文检测的章节实例平均检出的候选事件数；检测以王弼本为参照，事件皆为候选。" },
    mentions: { label: "概念提及密度", layer: "mention", value: function (c) { return c.chars ? mentionSum(c) / c.chars * 10000 : 0; }, fmt: function (v) { return v.toFixed(0) + " 次 / 万字"; }, note: "高、中特异性概念提及（名称 ≥ 2 字）每万字的次数；单字匹配已排除。" },
    commentary: { label: "注疏条目", layer: "commentary", value: function (c) { return c.commentary.total; }, fmt: function (v) { return v + " 条"; }, note: "注疏层为这一章记录的训释条目数（含不可作原文引用的条目）。" }
  };
  function mentionSum(c) { return c.top_concepts.reduce(function (s, t) { const k = CONC[t[0]]; return s + (k && k.specificity !== "low" ? t[1] : 0); }, 0); }

  LZ.loadAll(["summary", "chapters", "witness_index", "concepts", "variants"]).then(function (r) {
    S = r[0]; CH = r[1]; WIDX = r[2]; VAR = r[4];
    CONC = {}; r[3].forEach(function (c) { CONC[c.id] = c; });
    LZ.setEras(S.era_order, S.era_span);
    CH.chapters.forEach(function (c) { byNum[c.num] = c; });
    $("metric-seg").appendChild(LZ.seg(Object.keys(METRICS).map(function (k) { return { value: k, label: METRICS[k].label }; }), metric, function (v) { metric = v; paintGrid(); }));
    buildGrid();
    paintGrid();
    variantOverview();
    const h = parseInt(LZ.hash.get("ch"), 10);
    show(h >= 1 && h <= 81 ? h : 1, true);
    window.addEventListener("hashchange", function () { const n = parseInt(LZ.hash.get("ch"), 10); if (n >= 1 && n <= 81 && n !== current) show(n, true); });
    window.addEventListener("lz:theme", function () { paintGrid(); if (current) show(current, true); });
  }).catch(function (e) { console.error(e); $("detail").textContent = "数据加载失败：" + e.message; });

  function buildGrid() {
    const g = LZ.clear($("chgrid"));
    CH.chapters.forEach(function (c) {
      const cell = LZ.el("button.chcell", { type: "button", role: "gridcell", "data-num": c.num, "aria-label": "第 " + c.num + " 章" }, LZ.el("span.chcell__n", String(c.num)));
      cell.addEventListener("click", function () { show(c.num); });
      LZ.tip.bind(cell, function () {
        const m = METRICS[metric];
        return LZ.tip.rows("第 " + c.num + " 章", [[m.label, m.fmt(m.value(c))], ["文献覆盖", c.witnesses.length + " 种"], ["候选异文", LZ.fmt(c.variants.total)], ["注疏", c.commentary.total + " 条"]]);
      });
      g.appendChild(cell);
    });
  }
  function paintGrid() {
    const m = METRICS[metric];
    const vals = CH.chapters.map(m.value);
    const max = d3.max(vals) || 1, min = d3.min(vals) || 0;
    const ramp = LZ.ramp(m.layer);
    const color = LZ.layerColor(m.layer);
    document.querySelectorAll(".chcell").forEach(function (cell, i) {
      const t = max === min ? 0.5 : (vals[i] - min) / (max - min);
      const col = ramp(0.08 + 0.92 * t);
      cell.style.background = col;
      cell.dataset.dark = LZ.isDark(col) ? "1" : "0";
      cell.classList.toggle("is-on", CH.chapters[i].num === current);
    });
    const lg = LZ.clear($("ramp-legend"));
    lg.appendChild(LZ.el("span", m.fmt(min)));
    lg.appendChild(LZ.el("i", { style: { background: "linear-gradient(90deg," + ramp(0.08) + "," + ramp(1) + ")" } }));
    lg.appendChild(LZ.el("span", m.fmt(max)));
    $("metric-note").textContent = m.note;
  }

  function show(n, silent) {
    current = n;
    if (!silent) LZ.hash.set({ ch: n }, true);
    document.querySelectorAll(".chcell").forEach(function (cell) { cell.classList.toggle("is-on", +cell.dataset.num === n); });
    const c = byNum[n];
    const d = LZ.clear($("detail"));

    // title + nav
    const nav = LZ.el("div.chap-nav",
      LZ.el("button.btn.btn--sm", { type: "button", disabled: n <= 1, onClick: function () { show(n - 1); } }, "← 上一章"),
      LZ.el("button.btn.btn--sm", { type: "button", disabled: n >= 81, onClick: function () { show(n + 1); } }, "下一章 →"));
    d.appendChild(LZ.el("div.chap-title", LZ.el("h2", "第" + toCn(n) + "章"), LZ.el("span.muted", "Chapter " + n + (n <= 37 ? " · 道经" : " · 德经")), nav));

    // base text
    if (c.base_text.length) {
      d.appendChild(LZ.el("p.base-text", { lang: "zh-Hans" }, c.base_text.map(function (s) { return LZ.el("span", s); })));
      d.appendChild(LZ.el("p.base-src", "经文底本：" + CH.base_text_source.title + "（" + CH.base_text_source.version_id + "，数据集作者整理，release_disposition = " + CH.base_text_source.disposition + "）。这是公开版中唯一携带文本的资源。"));
    }

    // stats
    const dens = c.variants.run_instances ? c.variants.total / c.variants.run_instances : 0;
    d.appendChild(LZ.el("div.chap-stats",
      stat(c.witnesses.length, "种文献保存此章" + (c.witnesses_recovered.length ? "，另 " + c.witnesses_recovered.length + " 种待审核" : "")),
      stat(LZ.fmt(c.sentences), "句 · " + LZ.fmt(c.chars) + " 字（各文献合计）"),
      stat(LZ.fmt(c.variants.total), "候选异文事件 · " + dens.toFixed(1) + " / 实例"),
      stat(LZ.fmt(c.commentary.total), "注疏条目 · " + c.commentary.citable + " 条可引用")));

    // concepts
    const b1 = LZ.el("div.block", { style: { "--bc": "var(--c-mention)" } }, LZ.el("h3", "概念提及", LZ.el("span.en", "lexical mentions · default set")));
    const top = c.top_concepts.slice(0, 14);
    b1.appendChild(LZ.bars(top.map(function (t) {
      const k = CONC[t[0]] || { name: t[0], specificity: "low" };
      return { label: k.name + (k.specificity === "low" ? "（单字）" : ""), value: t[1], href: "concepts.html#c=" + t[0],
        color: k.specificity === "low" ? "var(--paper-4)" : null, tip: LZ.tip.rows(k.name, [["提及次数", LZ.fmt(t[1])], ["出现于", t[2] + " 个实例"], ["匹配特异性", { high: "高", medium: "中", low: "低（单字）" }[k.specificity]]]) };
    }), { labelWidth: "120px", color: LZ.layerColor("mention"), format: function (v, r) { return LZ.fmt(v); } }));
    b1.appendChild(LZ.el("p.small.muted", { style: { marginTop: "8px" } }, "灰色条为单字概念（低特异性），其计数不应读作哲学用法的频率。"));
    d.appendChild(b1);

    // variants
    const b2 = LZ.el("div.block", { style: { "--bc": "var(--c-variant)" } }, LZ.el("h3", "候选异文", LZ.el("span.en", "candidate variant events vs. Wang Bi")));
    if (c.variants.total) {
      const two = LZ.el("div.two");
      two.appendChild(LZ.el("div", LZ.el("h4.small.muted", "按层次 change_type"), stackBar(c.variants.by_type, ["词汇层", "字形层", "句法层"], "variant"),
        LZ.el("h4.small.muted", { style: { marginTop: "12px" } }, "按操作 edit_op"), stackBar(c.variants.by_op, ["insert", "replace", "delete"], "variant", LZ.OP_ZH)));
      const scores = CH.score_bins.map(function (s) { return { label: "分数 " + s, value: c.variants.by_score[String(s)] || 0 }; });
      two.appendChild(LZ.el("div", LZ.el("h4.small.muted", "按检测分数 variant_detection_score（启发式）"), LZ.bars(scores, { labelWidth: "80px", color: LZ.layerColor("variant") })));
      b2.appendChild(two);
    } else b2.appendChild(LZ.el("p.muted", "这一章没有候选异文事件。"));
    d.appendChild(b2);

    // commentary
    const b3 = LZ.el("div.block", { style: { "--bc": "var(--c-commentary)" } }, LZ.el("h3", "注疏", LZ.el("span.en", "commentary glosses")));
    if (c.commentary.total) {
      const two = LZ.el("div.two");
      two.appendChild(LZ.el("div", LZ.el("h4.small.muted", "按概念"), LZ.bars(c.commentary.by_concept.slice(0, 10).map(function (x) { return { label: CH.concept_names[x[0]] || x[0], value: x[1], href: "concepts.html#c=" + x[0] }; }), { labelWidth: "90px", color: LZ.layerColor("commentary") })));
      two.appendChild(LZ.el("div", LZ.el("h4.small.muted", "按注家自身时代 commentator_historical_era"), LZ.bars(c.commentary.by_era.map(function (x) { return { label: x[0], value: x[1] }; }), { labelWidth: "90px", color: LZ.layerColor("commentary") })));
      b3.appendChild(two);
    }
    if (c.wangbi_glosses.length) {
      b3.appendChild(LZ.el("h4", { style: { margin: "16px 0 8px" } }, "王弼注 · 可引用原文（citable_as_quote = TRUE）"));
      b3.appendChild(LZ.el("div.quote-list", c.wangbi_glosses.map(function (q) {
        return LZ.el("div.quote", LZ.el("p.q", q.quote), LZ.el("div.m", LZ.el("a", { href: "concepts.html#c=" + q.concept_id }, "概念：" + q.concept_name), LZ.badge("verbatim_contiguous", "ok"), LZ.el("span", "来源：" + CH.base_text_source.title)));
      })));
      b3.appendChild(LZ.el("p.small.muted", { style: { marginTop: "8px" } }, "仅显示 text_provenance = verbatim_contiguous 的条目；模型拼接或未定位的条目不作为原文呈现。其他注家的引文属第三方转录，公开版中已撤除，此处只保留计数。"));
    }
    d.appendChild(b3);

    // witnesses
    const b4 = LZ.el("div.block", { style: { "--bc": "var(--c-structure)" } }, LZ.el("h3", "保存此章的文献", LZ.el("span.en", c.witnesses.length + " witnesses")));
    const groups = {};
    c.witnesses.forEach(function (id) { const w = WIDX[id] || {}; (groups[w.e || "不详"] = groups[w.e || "不详"] || []).push(id); });
    Object.keys(groups).sort(function (a, b) { return LZ.eraIndex(a) - LZ.eraIndex(b); }).forEach(function (era) {
      const chips = LZ.el("div.chips", groups[era].map(function (id) { const w = WIDX[id] || {}; return LZ.chip(w.t || id, "witnesses.html#id=" + encodeURIComponent(id)); }));
      b4.appendChild(LZ.el("div", { style: { margin: "0 0 10px" } }, LZ.el("div.small.muted", { style: { marginBottom: "4px" } }, era + " · " + groups[era].length + " 种"), chips));
    });
    if (c.witnesses_recovered.length) {
      b4.appendChild(LZ.el("div.small.muted", { style: { margin: "12px 0 4px" } }, "自动恢复、待专家审核（不在默认分析集）："));
      b4.appendChild(LZ.el("div.chips", c.witnesses_recovered.map(function (id) { const w = WIDX[id] || {}; return LZ.chip(w.t || id, "witnesses.html#id=" + encodeURIComponent(id), "chip--rec"); })));
    }
    d.appendChild(b4);
    if (!silent && window.innerWidth < 900) d.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stat(v, l) { return LZ.el("div.chap-stat", LZ.el("b", String(v)), LZ.el("span", l)); }
  function stackBar(obj, order, layer, zh) {
    const total = order.reduce(function (s, k) { return s + (obj[k] || 0); }, 0) || 1;
    const base = LZ.layerColor(layer);
    const shades = [1, 0.62, 0.32];
    const wrap = LZ.el("div");
    const bar = LZ.el("div.stack");
    const leg = LZ.el("div.legend");
    order.forEach(function (k, i) {
      const v = obj[k] || 0;
      const col = d3.interpolateLab(LZ.cssVar("--paper-3"), base)(shades[i]);
      const seg = LZ.el("i", { style: { width: (100 * v / total) + "%", background: col }, tabindex: -1 });
      LZ.tip.bind(seg, function () { return LZ.tip.rows((zh ? zh[k] : k), [["事件数", LZ.fmt(v)], ["占比", LZ.pct(v / total)]]); });
      bar.appendChild(seg);
      leg.appendChild(LZ.el("span.legend__item", LZ.el("span.sw.sw--square", { style: { "--sw": col } }), (zh ? zh[k] + " " : "") + k + " " + LZ.fmt(v)));
    });
    wrap.appendChild(bar); wrap.appendChild(leg);
    return wrap;
  }
  function toCn(n) {
    const d = "零一二三四五六七八九";
    if (n < 10) return d[n];
    if (n < 20) return "十" + (n % 10 ? d[n % 10] : "");
    return d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : "");
  }

  /* ---- variant layer overview (left column) --------------------------- */
  function variantOverview() {
    const host = LZ.clear($("variant-overview"));
    host.appendChild(LZ.el("div.viz-title", LZ.el("h3", "异文层一览"), LZ.el("span", LZ.fmt(VAR.total) + " 个候选事件")));
    const rows = VAR.by_lineage.map(function (x) { return { label: x[0], value: x[2] ? x[1] / x[2] : 0, tip: LZ.tip.rows(x[0], [["候选事件", LZ.fmt(x[1])], ["检测实例", LZ.fmt(x[2])], ["每实例", (x[2] ? x[1] / x[2] : 0).toFixed(1)]]) }; });
    host.appendChild(LZ.el("p.small.muted", { style: { margin: "0 0 6px" } }, "各传承系统每章节实例的候选事件数"));
    host.appendChild(LZ.bars(rows, { labelWidth: "120px", color: LZ.layerColor("variant"), format: function (v) { return v.toFixed(1); } }));
    const ex = VAR.explanations;
    if (ex.length) {
      const det = LZ.el("details.acc", { style: { marginTop: "14px" } }, LZ.el("summary", LZ.el("span", "七组字对的模型说明 ", LZ.badge("LLM 生成 · 未审核", "ai")), LZ.el("span.sub", ex.reduce(function (s, e) { return s + e.rows; }, 0) + " 行")));
      const body = LZ.el("div.acc__body");
      ex.forEach(function (e) {
        body.appendChild(LZ.el("details", { style: { margin: "6px 0" } }, LZ.el("summary", { style: { cursor: "pointer" } }, LZ.el("b", e.pair.join(" / ")), LZ.el("span.muted.small", " · " + e.rows + " 个事件")), LZ.el("p.small", { style: { color: "var(--ink-2)", margin: "6px 0 0" } }, e.text)));
      });
      body.appendChild(LZ.el("p.small.muted", "semantic_explanation 由 MiniMax-M3 按字对生成，仅覆盖 " + VAR.explanations.length + " 组字对（" + LZ.fmt(ex.reduce(function (s, e) { return s + e.rows; }, 0)) + " 行），explanation_source 已在数据中标注；其余事件无说明。"));
      det.appendChild(body);
      host.appendChild(det);
    }
  }
})();
