/* drill-down views shared by every page: chapter instance, commentary record, lists of records */
(function () {
  "use strict";
  const D = {};
  LZ.detail = D;
  const COMP_ZH = ["经注混合", "注文为主", "经文为主", "未知"];
  const STATUS_ZH = ["默认分析集", "自动恢复 · 待审核", "未对齐", "专家确认", "专家修正"];
  const PROV_ZH = ["连续原文", "模型拼接摘录", "未定位转述"];
  const PROV_CODE = ["verbatim_contiguous", "spliced_from_source", "not_located"];
  const QK_ZH = ["原文引文", "模型拼接摘录", "未定位转述"];
  const TYPE_ZH = ["词汇层", "字形层", "句法层"];
  const OP_ZH = ["增", "删", "改"];
  const OP_EN = ["insert", "delete", "replace"];
  const SENT_LIMIT = 400, LIST_LIMIT = 300;

  /* ---------- data ------------------------------------------------------ */
  const files = {};
  D.chapter = function (n) { const key = (n === "unaligned" || n < 1) ? "unaligned" : String(n); if (!files[key]) files[key] = LZ.load("chapters/" + key); return files[key]; };
  D.names = function () { return LZ.load("concept_names"); };
  D.witnesses = function () { return LZ.load("witness_index"); };
  let idxPromise = null;
  D.index = function () {
    if (!idxPromise) idxPromise = LZ.load("instances_index").then(function (ix) {
      const byInst = {}, byVC = {};
      Object.keys(ix).forEach(function (v) { ix[v].forEach(function (e) { byInst[e[0]] = { v: v, ch: e[1], st: e[2] }; byVC[v + "|" + e[1]] = e[0]; }); });
      return { raw: ix, byInst: byInst, byVC: byVC };
    });
    return idxPromise;
  };
  let kgPromise = null;
  D.kg = function () {
    if (!kgPromise) kgPromise = LZ.load("kg/commentary").then(function (d) {
      const evByComm = {};
      Object.keys(d.evidence).forEach(function (eid) { const e = d.evidence[eid]; (evByComm[e[0]] = evByComm[e[0]] || []).push([eid, e[1], e[2], e[3], e[4], e[5]]); });
      return { commentary: d.commentary, evByComm: evByComm };
    });
    return kgPromise;
  };
  function commRec(id, row, names, widx, evidence) {
    const c = names[row[3]] || [row[3]];
    return { id: id, version_id: row[0], instance_id: row[1], chapter: row[2], concept_id: row[3], concept_name: c[0], commentator: row[4], person_id: row[5],
      commentator_era: row[6] || "不详", witness_era: row[7] || "不详", prov: row[8], citable: row[9], reliability: row[10], method: row[11], quote: row[12] || "",
      llm_chars: row[13], quote_chars: row[14], llm: row[15] || "", evidence: evidence || [], witness: (widx[row[0]] || {}).t || row[0] };
  }

  /* ---------- drawer stack ---------------------------------------------- */
  const stack = [];
  function show(renderFn, push) {
    if (!push) stack.length = 0;
    stack.push(renderFn);
    const body = [];
    if (stack.length > 1) body.push(LZ.el("button.btn.btn--sm.btn--ghost", { type: "button", style: { marginBottom: "6px" }, onClick: D.back }, "← 返回"));
    const content = renderFn();
    (Array.isArray(content) ? content : [content]).forEach(function (c) { if (c) body.push(c); });
    LZ.drawer.open(body);
    const dr = document.querySelector(".drawer"); if (dr) dr.classList.add("drawer--wide");
  }
  D.back = function () { if (stack.length < 2) { LZ.drawer.close(); return; } stack.pop(); const fn = stack.pop(); show(fn, true); };
  /** a page that opens its own drawer registers the render function so drill-downs can come back to it */
  D.enter = function (renderFn) { stack.length = 0; stack.push(renderFn); };
  function kv(rows) { const dl = LZ.el("dl.kv"); rows.forEach(function (r) { if (r[1] === null || r[1] === undefined || r[1] === "") return; dl.appendChild(LZ.el("dt", r[0])); dl.appendChild(LZ.el("dd", r[1])); }); return dl; }
  function statBox(v, l) { return LZ.el("div.chap-stat", LZ.el("b", String(v)), LZ.el("span", l)); }
  function provBadge(p) { return LZ.badge(PROV_ZH[p] + " · " + PROV_CODE[p], p === 0 ? "ok" : "ai"); }
  function chapterKey(ch) { return ch > 0 ? ch : "unaligned"; }

  /* ---------- instance view ------------------------------------------------ */
  D.openInstance = function (iid, opts) {
    opts = opts || {};
    const chP = opts.chapter !== undefined ? Promise.resolve(opts.chapter) : D.index().then(function (ix) { const e = ix.byInst[iid]; if (!e) throw new Error("未知实例 " + iid); return e.ch; });
    return chP.then(function (ch) { return Promise.all([D.chapter(chapterKey(ch)), D.names(), D.witnesses()]); }).then(function (r) {
      const file = r[0], names = r[1], widx = r[2];
      const inst = file.instances.find(function (i) { return i.id === iid; });
      if (!inst) throw new Error("未知实例 " + iid);
      show(function () { return renderInstance(file, inst, names, widx); }, opts.push);
    }).catch(function (e) { console.error(e); show(function () { return [LZ.el("h2", "无法打开"), LZ.el("p", e.message)]; }, opts.push); });
  };
  D.openInstanceByWitness = function (ch, vid, opts) {
    return D.chapter(chapterKey(ch)).then(function (file) {
      const inst = file.instances.find(function (i) { return i.v === vid; });
      if (!inst) { show(function () { return [LZ.el("h2", "没有对应的实例"), LZ.el("p", "该文献在这一章没有对齐的实例。")]; }); return; }
      return D.openInstance(inst.id, Object.assign({ chapter: ch }, opts || {}));
    });
  };
  function renderInstance(file, inst, names, widx) {
    const w = widx[inst.v] || {}, ch = file.chapter;
    const out = [];
    out.push(LZ.el("div.eyebrow.eyebrow--plain", inst.id));
    out.push(LZ.el("h2", (w.t || inst.v), LZ.el("span.muted", { style: { fontWeight: 400 } }, " · " + (ch > 0 ? "第 " + ch + " 章" : "未对齐单元"))));
    out.push(LZ.el("div.chips", { style: { marginBottom: "10px" } },
      LZ.badge(STATUS_ZH[inst.st], inst.st === 1 ? "unreviewed" : null), LZ.badge(COMP_ZH[inst.comp]), LZ.badge("切分：" + inst.method),
      LZ.badge(inst.text ? (file.profile === "full" ? "含转录文本 · 内部版" : "全文发布") : "文本撤除 · 仅结构与标注", inst.text ? "ok" : null), w.e ? LZ.badge(w.e) : null));
    const mentEdges = {}; let mentTotal = 0; inst.ment.forEach(function (m) { mentEdges[m[1]] = 1; mentTotal += m[2]; });
    out.push(LZ.el("div.chap-stats", { style: { gridTemplateColumns: "repeat(3, 1fr)" } },
      statBox(LZ.fmt(inst.chars), inst.sent.length + " 句"), statBox(LZ.fmt(mentTotal), Object.keys(mentEdges).length + " 个概念的提及"),
      statBox(LZ.fmt(inst.var.length), inst.run ? "候选异文事件" : "未运行异文检测"), statBox(LZ.fmt(inst.comm.length), "注疏条目"),
      statBox(inst.share === null ? "—" : LZ.pct(inst.share, 0), "经文占比上限"), statBox(String(inst.order), "文中顺序")));
    out.push(LZ.el("div.cta-row", { style: { marginTop: "0" } },
      LZ.el("a.btn.btn--sm.btn--primary", { href: "graph.html#n=I:" + encodeURIComponent(inst.id) }, "在图谱中浏览"),
      LZ.el("a.btn.btn--sm", { href: "witnesses.html#id=" + encodeURIComponent(inst.v) }, "文献页"),
      ch > 0 ? LZ.el("a.btn.btn--sm", { href: "chapters.html#ch=" + ch }, "本章") : null));

    /* sentences */
    fileCidx.current = file.cidx;
    const sec1 = LZ.el("div.dsec", LZ.el("h4", "逐句结构 · " + inst.sent.length + " 句" + (inst.text ? "（原文）" : "（字数与标注；文本撤除）")));
    const bySeq = {}; inst.ment.forEach(function (m) { (bySeq[m[0]] = bySeq[m[0]] || []).push(m); });
    let onlyMarked = false, showAll = false;
    const list = LZ.el("div.slist");
    const maxChars = Math.max.apply(null, inst.sent.map(function (s) { return s[1]; }).concat([1]));
    function drawSentences() {
      LZ.clear(list);
      let rows = inst.sent;
      if (onlyMarked) rows = rows.filter(function (s) { return bySeq[s[0]]; });
      const limit = showAll ? rows.length : SENT_LIMIT;
      rows.slice(0, limit).forEach(function (s) {
        const ms = bySeq[s[0]] || [];
        const row = LZ.el("div.srow");
        row.appendChild(LZ.el("span.sno", String(s[0] + 1)));
        const body = LZ.el("div.sbody");
        if (inst.text && s[2]) body.appendChild(LZ.el("p.stext", highlight(s[2], ms, names)));
        else body.appendChild(LZ.el("div.sbar", LZ.el("i", { style: { width: (100 * s[1] / maxChars).toFixed(1) + "%" } }), LZ.el("span.schars", s[1] + " 字")));
        if (ms.length) body.appendChild(LZ.el("div.schips", ms.map(function (m) { const cid = file.cidx[m[1]]; const nm = (names[cid] || [cid])[0]; return LZ.chip([nm, m[2] > 1 ? LZ.el("span.n", "×" + m[2]) : null], "concepts.html#c=" + encodeURIComponent(cid)); })));
        row.appendChild(body);
        list.appendChild(row);
      });
      if (rows.length > limit) list.appendChild(LZ.el("button.btn.btn--sm", { type: "button", style: { marginTop: "8px" }, onClick: function () { showAll = true; drawSentences(); } }, "显示全部 " + rows.length + " 句"));
      if (!rows.length) list.appendChild(LZ.el("p.muted.small", "没有带概念标注的句子。"));
    }
    const tgl = LZ.el("label.field.field--check", { style: { minHeight: "auto", marginBottom: "8px" } }, LZ.el("input", { type: "checkbox", onChange: function (e) { onlyMarked = e.target.checked; drawSentences(); } }), "仅显示有概念标注的句子");
    sec1.appendChild(tgl); sec1.appendChild(list); drawSentences();
    out.push(sec1);

    /* variants */
    const sec2 = LZ.el("div.dsec", LZ.el("h4", "候选异文 · 相对王弼本 · " + inst.var.length + " 个事件"));
    if (!inst.run) sec2.appendChild(LZ.el("p.muted.small", "此实例未运行异文检测（v1.1.2 恢复的实例与未对齐单元不在检测范围内）。"));
    else if (!inst.var.length) sec2.appendChild(LZ.el("p.muted.small", "与王弼本比对未检出候选事件。"));
    else {
      const ref = refString(file);
      if (ref) sec2.appendChild(refView(ref, inst.var, file));
      sec2.appendChild(variantTable(file, inst.var, ref, null, widx));
      sec2.appendChild(LZ.el("p.small.muted", { style: { marginTop: "8px" } }, "位置为相对王弼本章文（作者整理本，去标点）的字符偏移；「王弼本原字」取自该整理本。" + (file.profile === "full" ? "" : "此文献一侧的字串在公开版中撤除，仅保留字数。") + "事件皆为候选（difflib 自动检出），分数是启发式值。"));
    }
    out.push(sec2);

    /* commentary */
    const sec3 = LZ.el("div.dsec", LZ.el("h4", "注疏条目 · " + inst.comm.length + " 条"));
    if (!inst.comm.length) sec3.appendChild(LZ.el("p.muted.small", "注疏层没有落在此实例上的条目。"));
    else sec3.appendChild(commList(inst.comm.map(function (id) { return commRec(id, file.commentary[id].slice(0, 16), names, widx, file.commentary[id][16]); }), { chapter: ch }));
    out.push(sec3);
    return out;
  }
  function highlight(text, ms, names) {
    // wrap every occurrence of each mentioned concept name; longest names first so 有无相生 wins over 有 / 无
    const spans = [];
    const terms = ms.map(function (m) { return names[fileCidx.current[m[1]]] ? names[fileCidx.current[m[1]]][0] : null; }).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    const taken = new Array(text.length).fill(false);
    terms.forEach(function (t) { let i = text.indexOf(t); while (i >= 0) { let free = true; for (let k = i; k < i + t.length; k++) if (taken[k]) free = false; if (free) { spans.push([i, i + t.length, t]); for (let k = i; k < i + t.length; k++) taken[k] = true; } i = text.indexOf(t, i + 1); } });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    const out = []; let pos = 0;
    spans.forEach(function (s) { if (s[0] > pos) out.push(text.slice(pos, s[0])); out.push(LZ.el("mark.cm", { title: "概念：" + s[2] }, text.slice(s[0], s[1]))); pos = s[1]; });
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }
  const fileCidx = { current: null };
  function refString(file) { fileCidx.current = file.cidx; return (file.ref || []).map(function (s) { return s[2]; }).join(""); }
  function refView(ref, vars, file) {
    const ins = {}, del = {}, rep = {};
    vars.forEach(function (v) { if (v[2] === 0) ins[v[0]] = (ins[v[0]] || 0) + 1; else for (let k = v[0]; k < v[0] + v[3] && k < ref.length; k++) { if (v[2] === 1) del[k] = (del[k] || 0) + 1; else rep[k] = (rep[k] || 0) + 1; } });
    const box = LZ.el("div.reftext", { lang: "zh-Hans" });
    for (let i = 0; i <= ref.length; i++) {
      if (ins[i]) box.appendChild(LZ.el("i.vins", { title: "此处有 " + ins[i] + " 个增字事件" }, "‸"));
      if (i < ref.length) {
        const cls = rep[i] ? ".vrep" : (del[i] ? ".vdel" : "");
        const sp = LZ.el("span" + cls, { title: rep[i] ? "改字事件 ×" + rep[i] : (del[i] ? "删字事件 ×" + del[i] : "") }, ref[i]);
        box.appendChild(sp);
      }
    }
    return LZ.el("div", box, LZ.legend([{ label: "改 replace", color: "var(--c-variant)", shape: "square" }, { label: "删 delete", color: "var(--gold)", shape: "square" }, { label: "‸ 增 insert", color: "var(--ink-3)", shape: "line" }]));
  }
  function variantTable(file, vars, ref, witnessOf, widx) {
    const t = LZ.el("table.table.table--compact");
    const head = LZ.el("tr"); if (witnessOf) head.appendChild(LZ.el("th", "文献"));
    const hasText = vars.some(function (v) { return v.length > 9; });
    ["位置", "王弼本原字", "层次", "操作", hasText ? "该本文字" : "该本字数", "分数", "说明"].forEach(function (h) { head.appendChild(LZ.el("th" + (/位置|字数|分数/.test(h) ? ".num" : ""), h)); });
    t.appendChild(LZ.el("thead", head));
    const tb = LZ.el("tbody");
    vars.forEach(function (v) {
      const old = v[2] === 0 ? "（插入）" : (ref ? ref.slice(v[0], v[0] + v[3]) : v[3] + " 字");
      const ex = v[6] >= 0 ? file.expl[v[6]] : null;
      const tr = LZ.el("tr");
      if (witnessOf) tr.appendChild(LZ.el("td", witnessOf(v)));
      tr.appendChild(LZ.el("td.num", String(v[0])));
      tr.appendChild(LZ.el("td", LZ.el("span.refold", old)));
      tr.appendChild(LZ.el("td", TYPE_ZH[v[1]]));
      tr.appendChild(LZ.el("td", OP_ZH[v[2]] + " " + OP_EN[v[2]]));
      tr.appendChild(hasText ? LZ.el("td", LZ.el("span.refold", v[2] === 1 ? "（删除）" : (v[9] || "—"))) : LZ.el("td.num", String(v[4])));
      tr.appendChild(LZ.el("td.num", v[5].toFixed(2)));
      const exCell = LZ.el("td");
      if (ex) { const b = LZ.el("button.chip.chip--link", { type: "button", title: "模型说明（未审核）" }, ex.pair.join(" / ")); LZ.tip.bind(b, function () { return [LZ.el("div.tip__title", ex.pair.join(" / ") + " · LLM 说明，未审核"), LZ.el("div", ex.text)]; }); exCell.appendChild(b); } else exCell.appendChild(LZ.el("span.muted", "—"));
      tr.appendChild(exCell);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return LZ.el("div.table-wrap", { style: { marginTop: "10px" } }, t);
  }

  /* ---------- commentary --------------------------------------------------- */
  function commList(recs, ctx) {
    const ul = LZ.el("div.clist");
    recs.forEach(function (r) {
      const row = LZ.el("button.crow", { type: "button", onClick: function () { D.openCommentary(r.id, { chapter: r.chapter, push: true, rec: r }); } },
        LZ.el("span.crow__main", LZ.el("b", r.commentator), " 训释「", LZ.el("span", r.concept_name), "」", ctx && ctx.chapter === r.chapter ? null : LZ.el("span.muted", " · 第 " + r.chapter + " 章")),
        LZ.el("span.crow__sub", (ctx && ctx.hideWitness ? "" : r.witness + " · ") + "注家时代 " + r.commentator_era + " · " + PROV_ZH[r.prov] + (r.citable ? " · 可引用" : "") + (r.quote ? " · 有原文" : "")));
      ul.appendChild(row);
    });
    return ul;
  }
  D.openCommentary = function (id, opts) {
    opts = opts || {};
    const p = opts.rec ? Promise.resolve(opts.rec) : Promise.all([D.names(), D.witnesses()]).then(function (r) {
      const names = r[0], widx = r[1];
      if (opts.chapter !== undefined) return D.chapter(chapterKey(opts.chapter)).then(function (file) { const row = file.commentary[id]; if (!row) throw new Error("未知条目"); return commRec(id, row.slice(0, 16), names, widx, row[16]); });
      return D.kg().then(function (kg) { const row = kg.commentary[id]; if (!row) throw new Error("未知条目 " + id); return commRec(id, row, names, widx, kg.evByComm[id] || []); });
    });
    return p.then(function (rec) { show(function () { return renderCommentary(rec); }, opts.push); })
      .catch(function (e) { console.error(e); show(function () { return [LZ.el("h2", "无法打开"), LZ.el("p", e.message)]; }, opts.push); });
  };
  function renderCommentary(r) {
    const out = [];
    out.push(LZ.el("div.eyebrow.eyebrow--plain", r.id));
    out.push(LZ.el("h2", r.commentator + " 训释「" + r.concept_name + "」"));
    out.push(LZ.el("p", { style: { color: "var(--ink-2)", margin: "0 0 8px" } }, "第 " + r.chapter + " 章 · " + r.witness));
    out.push(LZ.el("div.chips", { style: { marginBottom: "10px" } }, provBadge(r.prov), LZ.badge(r.citable ? "可作原文引用" : "不可作原文引用", r.citable ? "ok" : "unreviewed"),
      LZ.badge("可靠性 " + r.reliability), LZ.badge(r.method + " · 未审核", "ai")));
    if (r.quote) out.push(LZ.el("div.quote", LZ.el("p.q", r.quote), LZ.el("div.m", LZ.badge("verbatim_contiguous", "ok"), LZ.el("span", "来源：" + r.witness))));
    if (r.llm) out.push(LZ.el("div.quote", { style: { borderLeftColor: "var(--gold)" } }, LZ.el("p.q", r.llm), LZ.el("div.m", LZ.badge((r.prov === 1 ? "模型拼接摘录" : "模型转述") + " · LLM 生成 · 未审核", "ai"), LZ.el("span", "不可作为注家原话引用"))));
    if (!r.quote && !r.llm) out.push(LZ.el("div.callout", LZ.el("b", "文本未随公开版发布。"), " " + (r.prov === 0 ? "原文 " + r.quote_chars + " 字（第三方转录，按版权处置撤除）。" : (r.llm_chars ? "模型" + (r.prov === 1 ? "拼接摘录" : "转述") + " " + r.llm_chars + " 字（由源文拼接而成，随源文一并撤除）。" : "没有可显示的文本。"))));
    out.push(kv([["注家（原记）", r.commentator], ["注家时代", r.commentator_era], ["版本时代", r.witness_era], ["训释概念", r.concept_name], ["引文来源", PROV_ZH[r.prov] + " · " + PROV_CODE[r.prov]], ["抽取方法", r.method]]));
    const ev = LZ.el("div.dsec", LZ.el("h4", "证据记录 · " + r.evidence.length + " 条"));
    if (r.evidence.length) r.evidence.forEach(function (e) { ev.appendChild(kv([["证据 ID", LZ.el("span.mono", e[0])], ["引文类型", QK_ZH[e[1]]], ["可靠性", e[2]], ["与源文重合度", e[3] === null ? "—" : String(e[3])], ["逐字引用", e[4] ? "是" : "否"], ["引文字数", String(e[5]) + (r.quote ? "" : "（文本撤除）")]])); });
    else ev.appendChild(LZ.el("p.muted.small", "无。"));
    out.push(ev);
    out.push(LZ.el("div.dsec", LZ.el("h4", "关联"), LZ.el("div.cta-row", { style: { marginTop: 0 } },
      LZ.el("button.btn.btn--sm", { type: "button", onClick: function () { D.openInstance(r.instance_id, { chapter: r.chapter, push: true }); } }, "所属章节实例"),
      LZ.el("a.btn.btn--sm", { href: "concepts.html#c=" + encodeURIComponent(r.concept_id) }, "概念「" + r.concept_name + "」"),
      r.person_id && r.person_id !== "ANONYMOUS" && r.person_id !== "UNKNOWN" ? LZ.el("a.btn.btn--sm", { href: "persons.html#id=" + encodeURIComponent(r.person_id) }, "注家") : null,
      LZ.el("a.btn.btn--sm", { href: "witnesses.html#id=" + encodeURIComponent(r.version_id) }, "文献"),
      LZ.el("a.btn.btn--sm", { href: "chapters.html#ch=" + r.chapter }, "第 " + r.chapter + " 章"),
      LZ.el("a.btn.btn--sm.btn--primary", { href: "graph.html#n=M:" + encodeURIComponent(r.id) }, "在图谱中浏览"))));
    out.push(LZ.el("p.kg-note", { style: { marginTop: "12px" } }, "注疏条目由 LLM 辅助抽取（gloss_reviewed = FALSE）；只有 text_provenance = verbatim_contiguous 的条目可作为注家原话引用。"));
    return out;
  }

  /* ---------- lists ----------------------------------------------------- */
  /** opts: {title, note, chapter (use chapter file) | filter over kg, filter(rec)->bool, hideWitness} */
  D.openCommentaryList = function (opts) {
    const src = opts.chapter !== undefined ? D.chapter(chapterKey(opts.chapter)) : D.kg();
    return Promise.all([src, D.names(), D.witnesses()]).then(function (r) {
      const names = r[1], widx = r[2];
      let recs;
      if (opts.chapter !== undefined) recs = Object.keys(r[0].commentary).map(function (id) { const row = r[0].commentary[id]; return commRec(id, row.slice(0, 16), names, widx, row[16]); });
      else recs = Object.keys(r[0].commentary).map(function (id) { return commRec(id, r[0].commentary[id], names, widx, r[0].evByComm[id] || []); });
      if (opts.filter) recs = recs.filter(opts.filter);
      recs.sort(function (a, b) { return a.chapter - b.chapter || a.commentator.localeCompare(b.commentator, "zh"); });
      show(function () { return renderCommList(recs, opts); }, opts.push);
    });
  };
  function renderCommList(recs, opts) {
    const out = [LZ.el("h2", opts.title || "注疏条目"), opts.note ? LZ.el("p.small.muted", opts.note) : null];
    const concepts = {}, eras = {};
    recs.forEach(function (r) { concepts[r.concept_id] = r.concept_name; eras[r.commentator_era] = 1; });
    const fq = LZ.el("input", { type: "search", placeholder: "注家、文献…", "aria-label": "筛选" });
    const fc = LZ.el("select", LZ.el("option", { value: "" }, "全部概念"), Object.keys(concepts).sort(function (a, b) { return concepts[a].localeCompare(concepts[b], "zh"); }).map(function (k) { return LZ.el("option", { value: k }, concepts[k]); }));
    const fe = LZ.el("select", LZ.el("option", { value: "" }, "全部注家时代"), Object.keys(eras).sort(function (a, b) { return LZ.eraIndex(a) - LZ.eraIndex(b); }).map(function (k) { return LZ.el("option", { value: k }, k); }));
    const fp = LZ.el("select", LZ.el("option", { value: "" }, "全部来源"), LZ.el("option", { value: "0" }, "仅连续原文（可引用）"), LZ.el("option", { value: "q" }, "仅有原文可显示"));
    const count = LZ.el("span.count");
    const host = LZ.el("div");
    let limit = LIST_LIMIT;
    function draw() {
      const q = fq.value.trim().toLowerCase();
      let rows = recs.filter(function (r) { return (!fc.value || r.concept_id === fc.value) && (!fe.value || r.commentator_era === fe.value) && (fp.value !== "0" || r.prov === 0) && (fp.value !== "q" || r.quote) && (!q || (r.commentator + " " + r.witness).toLowerCase().indexOf(q) >= 0); });
      count.textContent = rows.length + " / " + recs.length + " 条";
      LZ.clear(host);
      host.appendChild(commList(rows.slice(0, limit), opts));
      if (rows.length > limit) host.appendChild(LZ.el("button.btn.btn--sm", { type: "button", style: { marginTop: "8px" }, onClick: function () { limit += LIST_LIMIT; draw(); } }, "显示更多"));
      if (!rows.length) host.appendChild(LZ.el("div.empty", "没有符合条件的条目"));
    }
    [fq, fc, fe, fp].forEach(function (el) { el.addEventListener(el === fq ? "input" : "change", LZ.debounce(draw, 100)); });
    out.push(LZ.el("div.filters.dl-filters", LZ.el("div.field.field--grow", fq), LZ.el("div.field", fc), LZ.el("div.field", fe), LZ.el("div.field", fp), count));
    out.push(host); draw();
    return out;
  }
  /** opts: {chapter, title, note, filter(v, inst)->bool, push} */
  D.openVariantList = function (opts) {
    return Promise.all([D.chapter(chapterKey(opts.chapter)), D.witnesses()]).then(function (r) {
      const file = r[0], widx = r[1];
      show(function () { return renderVariantList(file, widx, opts); }, opts.push);
    });
  };
  function renderVariantList(file, widx, opts) {
    const rows = [];
    file.instances.forEach(function (inst) { inst.var.forEach(function (v) { if (!opts.filter || opts.filter(v, inst)) rows.push({ v: v, inst: inst }); }); });
    const out = [LZ.el("h2", opts.title || ("第 " + file.chapter + " 章 · 候选异文事件")), LZ.el("p.small.muted", opts.note || "每一行是一个自动检出的候选差异事件（相对王弼本）；无一经校勘确认。点击文献名可打开该实例。")];
    const fq = LZ.el("input", { type: "search", placeholder: "文献…", "aria-label": "筛选文献" });
    const ft = LZ.el("select", LZ.el("option", { value: "" }, "全部层次"), TYPE_ZH.map(function (t, i) { return LZ.el("option", { value: String(i) }, t); }));
    const fo = LZ.el("select", LZ.el("option", { value: "" }, "全部操作"), OP_ZH.map(function (t, i) { return LZ.el("option", { value: String(i) }, t + " " + OP_EN[i]); }));
    const fs = LZ.el("select", LZ.el("option", { value: "0" }, "全部分数"), LZ.el("option", { value: "0.45" }, "分数 ≥ 0.45"), LZ.el("option", { value: "0.65" }, "分数 ≥ 0.65"), LZ.el("option", { value: "0.85" }, "分数 ≥ 0.85"));
    const fx = LZ.el("label.field.field--check", { style: { minHeight: "auto" } }, LZ.el("input", { type: "checkbox" }), "仅有模型说明");
    const count = LZ.el("span.count"), host = LZ.el("div");
    const ref = refString(file);
    let limit = LIST_LIMIT;
    function draw() {
      const q = fq.value.trim().toLowerCase(), minScore = +fs.value;
      const sel = rows.filter(function (r) { const t = (widx[r.inst.v] || {}).t || r.inst.v; return (!ft.value || r.v[1] === +ft.value) && (!fo.value || r.v[2] === +fo.value) && r.v[5] >= minScore && (!fx.firstChild.checked || r.v[6] >= 0) && (!q || t.toLowerCase().indexOf(q) >= 0); });
      count.textContent = sel.length + " / " + rows.length + " 个";
      LZ.clear(host);
      const page = sel.slice(0, limit);
      host.appendChild(variantTable(file, page.map(function (r) { return r.v; }), ref, function (v) {
        const r = page[page.map(function (x) { return x.v; }).indexOf(v)];
        const t = (widx[r.inst.v] || {}).t || r.inst.v;
        return LZ.el("button.chip.chip--link", { type: "button", onClick: function () { D.openInstance(r.inst.id, { chapter: file.chapter, push: true }); } }, t.length > 14 ? t.slice(0, 13) + "…" : t);
      }, widx));
      if (sel.length > limit) host.appendChild(LZ.el("button.btn.btn--sm", { type: "button", style: { marginTop: "8px" }, onClick: function () { limit += LIST_LIMIT; draw(); } }, "显示更多"));
      if (!sel.length) host.appendChild(LZ.el("div.empty", "没有符合条件的事件"));
    }
    [fq, ft, fo, fs].forEach(function (el) { el.addEventListener(el === fq ? "input" : "change", LZ.debounce(draw, 100)); });
    fx.firstChild.addEventListener("change", draw);
    out.push(LZ.el("div.filters.dl-filters", LZ.el("div.field.field--grow", fq), LZ.el("div.field", ft), LZ.el("div.field", fo), LZ.el("div.field", fs), fx, count));
    out.push(host); draw();
    return out;
  }
  /** reference-text density strip for a whole chapter: counts events per character */
  D.refDensity = function (file) {
    const ref = refString(file);
    if (!ref) return null;
    const counts = new Array(ref.length + 1).fill(0), ins = new Array(ref.length + 1).fill(0);
    file.instances.forEach(function (inst) { inst.var.forEach(function (v) { if (v[2] === 0) ins[v[0]]++; else for (let k = v[0]; k < v[0] + v[3] && k < ref.length; k++) counts[k]++; }); });
    const max = Math.max.apply(null, counts.concat([1]));
    const ramp = LZ.ramp("variant");
    const box = LZ.el("div.reftext.reftext--density", { lang: "zh-Hans" });
    for (let i = 0; i <= ref.length; i++) {
      if (ins[i]) { const c = LZ.el("i.vins", { title: "此处 " + ins[i] + " 个增字事件" }, "‸"); c.style.opacity = String(0.35 + 0.65 * Math.min(1, ins[i] / max)); box.appendChild(c); }
      if (i < ref.length) {
        const sp = LZ.el("span", ref[i]);
        if (counts[i]) { const col = ramp(0.15 + 0.85 * counts[i] / max); sp.style.background = col; if (LZ.isDark(col)) sp.style.color = "#fff"; }
        LZ.tip.bind(sp, function () { return LZ.tip.rows("第 " + (i + 1) + " 字「" + ref[i] + "」", [["删/改事件", counts[i]], ["此前增字事件", ins[i]]]); });
        box.appendChild(sp);
      }
    }
    return LZ.el("div", box, LZ.el("p.small.muted", { style: { margin: "6px 0 0" } }, "王弼本章文（去标点）上每个字被删改的候选事件数；‸ 为增字位置。文本取自作者整理本。"));
  };
})();
