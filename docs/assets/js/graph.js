/* graph explorer: incremental neighbourhood browsing over the LaoziKG graph */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const LIMIT = 20;

  /* ---------- type & relation metadata --------------------------------- */
  const TYPES = {
    V: { zh: "文献版本", en: "Version", v: "--k-version", shape: "square", r: 13 },
    P: { zh: "人物", en: "Person", v: "--k-person", shape: "circle", r: 11 },
    A: { zh: "人物别名", en: "PersonAlias", v: "--k-person", shape: "ring", r: 5 },
    I: { zh: "章节实例", en: "ChapterInstance", v: "--k-instance", shape: "rect", r: 8 },
    C: { zh: "概念", en: "Concept", v: "--k-concept", shape: "diamond", r: 12 },
    M: { zh: "注疏条目", en: "Commentary", v: "--k-commentary", shape: "triangle", r: 8 },
    E: { zh: "证据", en: "Evidence", v: "--k-commentary", shape: "ring", r: 5 },
    R: { zh: "版本关系断言", en: "ProvenanceAssertion", v: "--k-pa", shape: "hexagon", r: 8 }
  };
  const RELS = {
    HAS_INSTANCE: { zh: "含章节实例", from: "V", to: "I" },
    AUTHORED_BY: { zh: "撰", from: "V", to: "P" },
    ANNOTATED_BY: { zh: "注", from: "V", to: "P", dash: "6 3" },
    HAS_ALIAS: { zh: "别名", from: "P", to: "A", dash: "2 3" },
    MENTIONS_CONCEPT: { zh: "提及概念", from: "I", to: "C" },
    GLOSSES: { zh: "训释概念", from: "M", to: "C" },
    INTERPRETS: { zh: "诠释实例", from: "M", to: "I" },
    COMMENTARY_OF: { zh: "出自文献", from: "M", to: "V" },
    HAS_EVIDENCE: { zh: "证据", from: "M", to: "E", dash: "2 3" },
    CONCEPT_LOCUS: { zh: "典型章次的实例", from: "C", to: "I", dash: "5 3" },
    RELATED_CONCEPT: { zh: "概念关系", from: "C", to: "C" },
    PA_ASSERTS_A: { zh: "断言涉及 · A", from: "R", to: "V" },
    PA_ASSERTS_B: { zh: "断言涉及 · B", from: "R", to: "V" },
    COMMENTATOR: { zh: "注家", from: "M", to: "P", derived: true, dash: "1.5 3" }
  };
  const COMP_ZH = ["经注混合", "注文为主", "经文为主", "未知"];
  const STATUS_ZH = ["原始确定性对齐（默认分析集）", "自动恢复 · 待专家审核", "未对齐", "专家确认", "专家修正"];
  const PROV_ZH = ["连续原文 verbatim_contiguous", "模型拼接摘录 spliced_from_source", "未定位 not_located"];
  const QK_ZH = ["原文引文 attested_source_quote", "模型拼接摘录 llm_spliced_excerpt", "未定位转述 llm_paraphrase_unlocated"];

  /* ---------- data layer ------------------------------------------------- */
  const KG = { core: null, inst: null, comm: null, idx: {} };
  const loading = {};
  function loadPart(part) {
    if (KG[part]) return Promise.resolve(KG[part]);
    if (!loading[part]) {
      showLoading(true);
      loading[part] = LZ.load("kg/" + { core: "core", inst: "instances", comm: "commentary" }[part]).then(function (d) {
        KG[part] = d; indexPart(part); showLoading(false); reconcileEdges(); return d;
      }).catch(function (e) { showLoading(false); console.error(e); throw e; });
    }
    return loading[part];
  }
  function needs(type) { return { V: ["inst", "comm"], P: ["comm"], A: [], I: ["inst", "comm"], C: ["inst", "comm"], M: ["comm", "inst"], E: ["comm"], R: [] }[type] || []; }
  function ensure(type) { return Promise.all(needs(type).map(loadPart)); }
  function showLoading(on) { $("kg-loading").classList.toggle("is-on", !!on); }

  function indexPart(part) {
    const ix = KG.idx;
    if (part === "core") {
      const c = KG.core;
      ix.personsByVersion = {}; ix.versionsByPerson = {};
      ["AUTHORED_BY", "ANNOTATED_BY"].forEach(function (rel) {
        c.edges[rel].forEach(function (e) {
          (ix.personsByVersion[e[0]] = ix.personsByVersion[e[0]] || []).push({ rel: rel, id: e[1], role: e[2], attributed: e[3], status: e[4] });
          (ix.versionsByPerson[e[1]] = ix.versionsByPerson[e[1]] || []).push({ rel: rel, id: e[0], role: e[2], attributed: e[3], status: e[4] });
        });
      });
      ix.aliasesByPerson = {};
      c.edges.HAS_ALIAS.forEach(function (e) { (ix.aliasesByPerson[e[0]] = ix.aliasesByPerson[e[0]] || []).push(e[1]); });
      ix.relOut = {}; ix.relIn = {};
      c.edges.RELATED_CONCEPT.forEach(function (e) {
        (ix.relOut[e[0]] = ix.relOut[e[0]] || []).push({ id: e[1], type: e[2], category: e[3], source: e[4] });
        (ix.relIn[e[1]] = ix.relIn[e[1]] || []).push({ id: e[0], type: e[2], category: e[3], source: e[4] });
      });
      ix.pasByVersion = {};
      c.edges.PA_ASSERTS_A.forEach(function (e) { (ix.pasByVersion[e[1]] = ix.pasByVersion[e[1]] || []).push({ id: e[0], rel: "PA_ASSERTS_A" }); });
      c.edges.PA_ASSERTS_B.forEach(function (e) { (ix.pasByVersion[e[1]] = ix.pasByVersion[e[1]] || []).push({ id: e[0], rel: "PA_ASSERTS_B" }); });
      ix.conceptByName = {}; Object.keys(c.concepts).forEach(function (id) { ix.conceptByName[c.concepts[id].n] = id; });
    }
    if (part === "inst") {
      const d = KG.inst;
      ix.instancesByVersion = {}; ix.instancesByChapter = {}; ix.instancesByConcept = {};
      Object.keys(d.instances).forEach(function (id) {
        const r = d.instances[id];
        (ix.instancesByVersion[r[0]] = ix.instancesByVersion[r[0]] || []).push(id);
        if (r[1] > 0) (ix.instancesByChapter[r[1]] = ix.instancesByChapter[r[1]] || []).push(id);
      });
      Object.keys(ix.instancesByVersion).forEach(function (v) { ix.instancesByVersion[v].sort(function (a, b) { return d.instances[a][10] - d.instances[b][10]; }); });
      Object.keys(d.mentions).forEach(function (iid) {
        d.mentions[iid].forEach(function (m) {
          const cid = d.concept_index[m[0]];
          (ix.instancesByConcept[cid] = ix.instancesByConcept[cid] || []).push({ id: iid, n: m[1], recovered: !!m[2] });
        });
      });
      Object.keys(ix.instancesByConcept).forEach(function (cid) { ix.instancesByConcept[cid].sort(function (a, b) { return b.n - a.n; }); });
    }
    if (part === "comm") {
      const d = KG.comm;
      ix.commByVersion = {}; ix.commByInstance = {}; ix.commByConcept = {}; ix.commByPerson = {}; ix.evidenceByComm = {};
      Object.keys(d.commentary).forEach(function (id) {
        const r = d.commentary[id];
        (ix.commByVersion[r[0]] = ix.commByVersion[r[0]] || []).push(id);
        (ix.commByInstance[r[1]] = ix.commByInstance[r[1]] || []).push(id);
        (ix.commByConcept[r[3]] = ix.commByConcept[r[3]] || []).push(id);
        if (r[5]) (ix.commByPerson[r[5]] = ix.commByPerson[r[5]] || []).push(id);
      });
      Object.keys(d.evidence).forEach(function (id) { const r = d.evidence[id]; (ix.evidenceByComm[r[0]] = ix.evidenceByComm[r[0]] || []).push(id); });
      const byCh = function (a, b) { return d.commentary[a][2] - d.commentary[b][2]; };
      [ix.commByVersion, ix.commByConcept, ix.commByPerson].forEach(function (m) { Object.keys(m).forEach(function (k) { m[k].sort(byCh); }); });
    }
  }

  /* node descriptor ------------------------------------------------------ */
  function nid(type, key) { return type + ":" + key; }
  function split(id) { const i = id.indexOf(":"); return [id.slice(0, i), id.slice(i + 1)]; }
  function shorten(s, n) { s = s || ""; return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function versionShort(vid) { const v = KG.core.versions[vid]; return v ? shorten(v.t.replace(/^(P\.Ch\.|Or\.8210\/S\.|S\.|LM20[^老]*)/, ""), 7) : vid; }
  function describe(id) {
    const p = split(id), type = p[0], key = p[1];
    const c = KG.core;
    if (type === "V") { const v = c.versions[key]; if (!v) return null; return { id: id, type: type, key: key, label: shorten(v.t, 12), full: v.t, sub: v.a + " · " + v.e, data: v }; }
    if (type === "P") { const v = c.persons[key]; if (!v) return null; return { id: id, type: type, key: key, label: v.n, full: v.n, sub: (v.e || "时代不详") + (v.dt ? " · " + v.dt : ""), data: v }; }
    if (type === "A") { const v = c.aliases[key]; if (!v) return null; return { id: id, type: type, key: key, label: v.a, full: v.a, sub: "别名 · " + v.t, data: v }; }
    if (type === "C") { const v = c.concepts[key]; if (!v) return null; return { id: id, type: type, key: key, label: v.n, full: v.n, sub: LZ.typeLabel(v.nt), data: v }; }
    if (type === "R") { const v = c.pas[key]; if (!v) return null; return { id: id, type: type, key: key, label: "同书异本", full: key + " · " + v.rel, sub: v.bs, data: v }; }
    if (type === "I") { const v = KG.inst && KG.inst.instances[key]; if (!v) return null; const ch = v[1] > 0 ? "第 " + v[1] + " 章" : "未对齐单元";
      return { id: id, type: type, key: key, label: versionShort(v[0]) + " · " + ch, full: (c.versions[v[0]] ? c.versions[v[0]].t : v[0]) + " · " + ch, sub: STATUS_ZH[v[6]] + " · " + LZ.fmt(v[2]) + " 字", data: v }; }
    if (type === "M") { const v = KG.comm && KG.comm.commentary[key]; if (!v) return null; const cn = c.concepts[v[3]] ? c.concepts[v[3]].n : v[3];
      return { id: id, type: type, key: key, label: shorten(v[4].replace(/[（(].*$/, ""), 6) + " · " + cn, full: v[4] + " 训释「" + cn + "」 · 第 " + v[2] + " 章", sub: PROV_ZH[v[8]], data: v }; }
    if (type === "E") { const v = KG.comm && KG.comm.evidence[key]; if (!v) return null; return { id: id, type: type, key: key, label: "证据", full: "证据记录 · " + QK_ZH[v[1]], sub: "可靠性 " + v[2], data: v }; }
    return null;
  }

  /** neighbour groups for a node (only over loaded payloads); each: {rel, dir, zh, total, items:[{id, ...}], agg} */
  function neighbors(id) {
    const p = split(id), type = p[0], key = p[1], ix = KG.idx, c = KG.core, out = [];
    function group(rel, dir, items, extra) { out.push(Object.assign({ rel: rel, dir: dir, zh: RELS[rel].zh, total: items.length, items: items }, extra || {})); }
    if (type === "V") {
      const v = c.versions[key];
      if (KG.inst) group("HAS_INSTANCE", "out", (ix.instancesByVersion[key] || []).map(function (i) { return { id: nid("I", i) }; }));
      else out.push({ rel: "HAS_INSTANCE", dir: "out", zh: RELS.HAS_INSTANCE.zh, total: v.ni, items: null });
      (ix.personsByVersion[key] || []).forEach(function (e) { group(e.rel, "out", [{ id: nid("P", e.id), role: e.role, attributed: e.attributed, status: e.status }]); });
      if (KG.comm) group("COMMENTARY_OF", "in", (ix.commByVersion[key] || []).map(function (m) { return { id: nid("M", m) }; }));
      else out.push({ rel: "COMMENTARY_OF", dir: "in", zh: RELS.COMMENTARY_OF.zh, total: v.nc, items: null });
      (ix.pasByVersion[key] || []).forEach(function (e) { group(e.rel, "in", [{ id: nid("R", e.id) }]); });
      out.push({ agg: true, zh: "句子 · HAS_SENTENCE（已聚合）", text: LZ.fmt(v.ns) + " 句 · " + LZ.fmt(v.ch) + " 字" });
      out.push({ agg: true, zh: "候选异文 · HAS_VARIANT（已聚合）", text: LZ.fmt(v.nv) + " 个事件" });
    }
    if (type === "P") {
      const groups = {};
      (ix.versionsByPerson[key] || []).forEach(function (e) { (groups[e.rel] = groups[e.rel] || []).push({ id: nid("V", e.id), role: e.role, attributed: e.attributed, status: e.status }); });
      Object.keys(groups).forEach(function (rel) { group(rel, "in", groups[rel]); });
      group("HAS_ALIAS", "out", (ix.aliasesByPerson[key] || []).map(function (a) { return { id: nid("A", a) }; }));
      if (KG.comm) group("COMMENTATOR", "in", (ix.commByPerson[key] || []).map(function (m) { return { id: nid("M", m) }; }), { derived: true });
      else out.push({ rel: "COMMENTATOR", dir: "in", zh: RELS.COMMENTATOR.zh, total: c.persons[key].nc, items: null, derived: true });
    }
    if (type === "A") { const a = c.aliases[key]; group("HAS_ALIAS", "in", [{ id: nid("P", a.p) }]); }
    if (type === "C") {
      const k = c.concepts[key];
      if (KG.inst) group("MENTIONS_CONCEPT", "in", (ix.instancesByConcept[key] || []).map(function (m) { return { id: nid("I", m.id), n: m.n, recovered: m.recovered }; }));
      else out.push({ rel: "MENTIONS_CONCEPT", dir: "in", zh: RELS.MENTIONS_CONCEPT.zh, total: k.ni, items: null });
      if (KG.comm) group("GLOSSES", "in", (ix.commByConcept[key] || []).map(function (m) { return { id: nid("M", m) }; }));
      else out.push({ rel: "GLOSSES", dir: "in", zh: RELS.GLOSSES.zh, total: k.nc, items: null });
      const rels = (ix.relOut[key] || []).map(function (r) { return { id: nid("C", r.id), type: r.type, category: r.category, source: r.source, dir: "out" }; })
        .concat((ix.relIn[key] || []).map(function (r) { return { id: nid("C", r.id), type: r.type, category: r.category, source: r.source, dir: "in" }; }));
      group("RELATED_CONCEPT", "both", rels);
      if (KG.inst) {
        const loci = [];
        (k.cc || []).forEach(function (ch) { (ix.instancesByChapter[ch] || []).forEach(function (i) { loci.push({ id: nid("I", i), chapter: ch }); }); });
        group("CONCEPT_LOCUS", "out", loci);
      } else if ((k.cc || []).length) out.push({ rel: "CONCEPT_LOCUS", dir: "out", zh: RELS.CONCEPT_LOCUS.zh, total: null, items: null });
    }
    if (type === "I") {
      const r = KG.inst.instances[key];
      group("HAS_INSTANCE", "in", [{ id: nid("V", r[0]) }]);
      group("MENTIONS_CONCEPT", "out", (KG.inst.mentions[key] || []).slice().sort(function (a, b) { return b[1] - a[1]; }).map(function (m) { return { id: nid("C", KG.inst.concept_index[m[0]]), n: m[1], recovered: !!m[2] }; }));
      if (KG.comm) group("INTERPRETS", "in", (ix.commByInstance[key] || []).map(function (m) { return { id: nid("M", m) }; }));
      else out.push({ rel: "INTERPRETS", dir: "in", zh: RELS.INTERPRETS.zh, total: null, items: null });
      if (r[1] > 0) {
        const loci = Object.keys(c.concepts).filter(function (cid) { return (c.concepts[cid].cc || []).indexOf(r[1]) >= 0; }).map(function (cid) { return { id: nid("C", cid) }; });
        group("CONCEPT_LOCUS", "in", loci);
      }
      out.push({ agg: true, zh: "句子 · HAS_SENTENCE（已聚合）", text: LZ.fmt(r[3]) + " 句 · " + LZ.fmt(r[2]) + " 字" });
      out.push({ agg: true, zh: "候选异文 · HAS_VARIANT（已聚合）", text: (r[7] + r[8] + r[9]) ? "词汇层 " + r[7] + " · 字形层 " + r[8] + " · 句法层 " + r[9] : (r[6] === 0 ? "0" : "未运行异文检测") });
    }
    if (type === "M") {
      const m = KG.comm.commentary[key];
      group("GLOSSES", "out", [{ id: nid("C", m[3]) }]);
      if (KG.inst && KG.inst.instances[m[1]]) group("INTERPRETS", "out", [{ id: nid("I", m[1]) }]);
      group("COMMENTARY_OF", "out", [{ id: nid("V", m[0]) }]);
      group("HAS_EVIDENCE", "out", (ix.evidenceByComm[key] || []).map(function (e) { return { id: nid("E", e) }; }));
      if (m[5] && c.persons[m[5]]) group("COMMENTATOR", "out", [{ id: nid("P", m[5]) }], { derived: true });
    }
    if (type === "E") { const e = KG.comm.evidence[key]; group("HAS_EVIDENCE", "in", [{ id: nid("M", e[0]) }]); }
    if (type === "R") { const pa = c.pas[key]; group("PA_ASSERTS_A", "out", [{ id: nid("V", pa.a) }]); group("PA_ASSERTS_B", "out", [{ id: nid("V", pa.b) }]); }
    return out.filter(function (g) { return g.agg || g.items === null || g.items.length; });
  }
  function edgeId(rel, a, b) { return rel + "|" + a + "|" + b; }
  function edgeFor(rel, dir, from, item) {
    const derived = !!RELS[rel].derived;
    let s = from, t = item.id;
    if (dir === "in") { s = item.id; t = from; }
    if (rel === "RELATED_CONCEPT" && item.dir === "in") { s = item.id; t = from; }
    return { id: edgeId(rel, s, t), rel: rel, s: s, t: t, derived: derived, w: item.n || 0, info: item };
  }

  /* ---------- graph state ------------------------------------------------ */
  const nodes = new Map(), links = new Map();
  let selected = null, sim, svg, root, gLinks, gLabels, gNodes, zoom, W, H;
  const hiddenTypes = new Set();
  const undo = [];
  let showELabels = false;

  function setup() {
    svg = d3.select("#kg");
    const box = $("kg").getBoundingClientRect(); W = Math.max(600, box.width); H = Math.max(460, box.height);
    svg.attr("viewBox", [0, 0, W, H]);
    const defs = svg.append("defs");
    defs.append("marker").attr("id", "kg-arrow").attr("viewBox", "0 -4 8 8").attr("refX", 8).attr("refY", 0).attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
      .append("path").attr("d", "M0,-3.5L8,0L0,3.5").attr("class", "arrowhead").attr("fill", LZ.cssVar("--line-2"));
    root = svg.append("g");
    gLinks = root.append("g"); gLabels = root.append("g"); gNodes = root.append("g");
    zoom = d3.zoom().scaleExtent([0.2, 4]).on("zoom", function (e) { root.attr("transform", e.transform); });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", function (e) { if (e.target === svg.node()) select(null); });
    sim = d3.forceSimulation([])
      .force("charge", d3.forceManyBody().strength(-260).distanceMax(420))
      .force("link", d3.forceLink([]).id(function (d) { return d.id; }).distance(function (l) { return l.rel === "HAS_ALIAS" || l.rel === "HAS_EVIDENCE" ? 46 : (l.rel === "MENTIONS_CONCEPT" ? 90 : 76); }).strength(0.7))
      .force("collide", d3.forceCollide().radius(function (d) { return Math.max(d.r + 10, d.label.length * 6.2 + 4); }).iterations(2))
      .force("x", d3.forceX(W / 2).strength(0.03)).force("y", d3.forceY(H / 2).strength(0.04))
      .on("tick", tick).on("end", function () { if (fitOnSettle) { fitOnSettle = false; fit(); } }).alphaDecay(0.035);
  }
  let fitOnSettle = false;
  function tick() {
    gLinks.selectAll("path").attr("d", function (l) {
      const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y, len = Math.hypot(dx, dy) || 1;
      const tr = l.target.r + 6, sr = l.source.r + 2;
      return "M" + (l.source.x + dx / len * sr) + "," + (l.source.y + dy / len * sr) + "L" + (l.target.x - dx / len * tr) + "," + (l.target.y - dy / len * tr);
    });
    gLabels.selectAll("text").attr("x", function (l) { return (l.source.x + l.target.x) / 2; }).attr("y", function (l) { return (l.source.y + l.target.y) / 2 - 3; });
    gNodes.selectAll("g.knode").attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
  }
  function shapePath(type, r) {
    const m = TYPES[type];
    if (m.shape === "circle" || m.shape === "ring") return d3.symbol().type(d3.symbolCircle).size(Math.PI * r * r)();
    if (m.shape === "square") return d3.symbol().type(d3.symbolSquare).size(3.4 * r * r)();
    if (m.shape === "diamond") return d3.symbol().type(d3.symbolDiamond).size(3.6 * r * r)();
    if (m.shape === "triangle") return d3.symbol().type(d3.symbolTriangle).size(3.6 * r * r)();
    if (m.shape === "rect") { const w = r * 2.2, h = r * 1.5; return "M" + (-w / 2 + 2) + "," + (-h / 2) + "h" + (w - 4) + "a2,2 0 0 1 2,2v" + (h - 4) + "a2,2 0 0 1 -2,2h" + (-(w - 4)) + "a2,2 0 0 1 -2,-2v" + (-(h - 4)) + "a2,2 0 0 1 2,-2z"; }
    if (m.shape === "hexagon") { const pts = d3.range(6).map(function (i) { const a = Math.PI / 3 * i - Math.PI / 6; return [r * 1.15 * Math.cos(a), r * 1.15 * Math.sin(a)]; }); return "M" + pts.map(function (p) { return p.join(","); }).join("L") + "z"; }
    return d3.symbol().type(d3.symbolCircle).size(Math.PI * r * r)();
  }
  function typeColor(type) { return LZ.cssVar(TYPES[type].v); }

  function render() {
    const nodeArr = Array.from(nodes.values()), linkArr = Array.from(links.values());
    const link = gLinks.selectAll("path").data(linkArr, function (l) { return l.id; });
    link.exit().remove();
    const linkEnter = link.enter().append("path").attr("class", function (l) { return "klink" + (l.derived ? " is-derived" : ""); })
      .attr("marker-end", "url(#kg-arrow)").attr("stroke-dasharray", function (l) { return RELS[l.rel].dash || null; })
      .attr("stroke-width", function (l) { return l.rel === "MENTIONS_CONCEPT" ? Math.min(3, 0.9 + Math.sqrt(l.w) * 0.45) : 1.2; })
      .style("pointer-events", "stroke");
    linkEnter.each(function (l) { LZ.tip.bind(this, function () { return linkTip(l); }); });
    linkEnter.on("click", function (e, l) { e.stopPropagation(); select(l.target.id); });
    const lab = gLabels.selectAll("text").data(showELabels ? linkArr : [], function (l) { return l.id; });
    lab.exit().remove();
    lab.enter().append("text").attr("class", "elabel").attr("text-anchor", "middle").text(function (l) { return RELS[l.rel].zh + (l.rel === "MENTIONS_CONCEPT" && l.w ? " ×" + l.w : ""); });

    const node = gNodes.selectAll("g.knode").data(nodeArr, function (d) { return d.id; });
    node.exit().remove();
    const enter = node.enter().append("g").attr("class", "knode").attr("tabindex", 0).attr("role", "button").attr("aria-label", function (d) { return TYPES[d.type].zh + "：" + d.full; });
    enter.append("path").attr("class", "mark");
    enter.append("circle").attr("class", "hit").attr("r", function (d) { return Math.max(d.r + 6, 14); });
    enter.append("text").attr("text-anchor", "middle");
    enter.on("click", function (e, d) { e.stopPropagation(); select(d.id); })
      .on("dblclick", function (e, d) { e.stopPropagation(); expandAll(d.id); })
      .on("keydown", function (e, d) { if (e.key === "Enter") { e.preventDefault(); select(d.id); } if (e.key === " ") { e.preventDefault(); expandAll(d.id); } })
      .each(function (d) { LZ.tip.bind(this, function () { return nodeTip(d); }); })
      .call(d3.drag().on("start", function (e, d) { if (!e.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", function (e, d) { d.fx = e.x; d.fy = e.y; })
        .on("end", function (e, d) { if (!e.active) sim.alphaTarget(0); if (!d.pinned) { d.fx = null; d.fy = null; } }));
    const all = enter.merge(node);
    all.classed("is-sel", function (d) { return d.id === selected; }).classed("is-pin", function (d) { return !!d.pinned; });
    all.select("path.mark").attr("d", function (d) { return shapePath(d.type, d.r); })
      .attr("fill", function (d) { return TYPES[d.type].shape === "ring" ? LZ.cssVar("--paper-2") : typeColor(d.type); })
      .attr("stroke", function (d) { return TYPES[d.type].shape === "ring" ? typeColor(d.type) : LZ.cssVar("--paper-2"); })
      .attr("stroke-width", function (d) { return TYPES[d.type].shape === "ring" ? 2.2 : 1.5; });
    all.select("text").attr("y", function (d) { return d.r + 13; }).text(function (d) { return d.label; }).attr("font-weight", function (d) { return d.type === "C" || d.type === "P" ? 700 : 400; });
    svg.select(".arrowhead").attr("fill", LZ.cssVar("--line-2"));
    sim.nodes(nodeArr); sim.force("link").links(linkArr);
    $("kg-stat").textContent = nodeArr.length + " 个节点 · " + linkArr.length + " 条边";
    $("kg-empty").style.display = nodeArr.length ? "none" : "";
    paintTypeCounts();
  }
  function nodeTip(d) {
    const rows = [["类型", TYPES[d.type].zh + " · " + TYPES[d.type].en]];
    if (d.sub) rows.push(["", d.sub]);
    return LZ.tip.rows(d.full, rows, "点击查看详情 · 双击展开");
  }
  function linkTip(l) {
    const rows = [["关系", l.rel + (l.derived ? "（属性推导）" : "")], ["从", l.source.full], ["到", l.target.full]];
    if (l.rel === "MENTIONS_CONCEPT") rows.push(["提及次数", l.w + (l.info.recovered ? "（自动恢复实例）" : "")]);
    if (l.rel === "RELATED_CONCEPT") rows.push(["类型", (LZ.REL_ZH[l.info.type] || l.info.type) + " · " + (LZ.RELCAT_ZH[l.info.category] || l.info.category)]);
    if (l.info && l.info.role) rows.push(["角色", l.info.role + (l.info.attributed ? " · 题署" : "")]);
    return LZ.tip.rows(RELS[l.rel].zh, rows);
  }

  /* ---------- mutations -------------------------------------------------- */
  function addNode(id, near) {
    if (nodes.has(id)) return nodes.get(id);
    const d = describe(id);
    if (!d) return null;
    if (hiddenTypes.has(d.type)) return null;
    d.r = TYPES[d.type].r;
    const anchor = near && nodes.get(near);
    d.x = anchor ? anchor.x + (Math.random() - 0.5) * 60 : W / 2 + (Math.random() - 0.5) * 80;
    d.y = anchor ? anchor.y + (Math.random() - 0.5) * 60 : H / 2 + (Math.random() - 0.5) * 80;
    nodes.set(id, d);
    return d;
  }
  function addEdge(e) {
    if (links.has(e.id) || !nodes.has(e.s) || !nodes.has(e.t)) return false;
    links.set(e.id, Object.assign({}, e, { source: nodes.get(e.s), target: nodes.get(e.t) }));
    return true;
  }
  /** add every edge between visible nodes that the loaded payloads know about */
  function reconcileEdges() {
    if (!KG.core) return;
    let changed = false;
    nodes.forEach(function (d) {
      neighbors(d.id).forEach(function (g) {
        if (g.agg || !g.items) return;
        g.items.forEach(function (it) { if (nodes.has(it.id)) { if (addEdge(edgeFor(g.rel, g.dir, d.id, it))) changed = true; } });
      });
    });
    if (changed) { render(); sim.alpha(0.3).restart(); }
  }
  function removeNode(id) {
    if (!nodes.has(id)) return;
    nodes.delete(id);
    Array.from(links.keys()).forEach(function (k) { const l = links.get(k); if (l.s === id || l.t === id) links.delete(k); });
    if (selected === id) select(null);
  }
  function degree(id) { let n = 0; links.forEach(function (l) { if (l.s === id || l.t === id) n++; }); return n; }

  /** expand one relation group of `id`; returns number added */
  function expandGroup(id, rel, dir, limit) {
    const d = nodes.get(id); if (!d) return Promise.resolve(0);
    return ensure(d.type).then(function () {
      const groups = neighbors(id);
      const added = [], addedEdges = [];
      groups.forEach(function (g) {
        if (g.agg || !g.items) return;
        if (rel && (g.rel !== rel || (dir && g.dir !== dir))) return;
        let n = 0;
        for (let i = 0; i < g.items.length && n < limit; i++) {
          const it = g.items[i];
          if (!nodes.has(it.id)) {
            const nd = addNode(it.id, id);
            if (!nd) continue;
            added.push(it.id); n++;
          }
          const e = edgeFor(g.rel, g.dir, id, it);
          if (addEdge(e)) addedEdges.push(e.id);
        }
      });
      if (added.length || addedEdges.length) undo.push({ added: added, edges: addedEdges });
      // connect the newcomers to everything else already visible
      added.forEach(function (nidNew) {
        neighbors(nidNew).forEach(function (g) { if (g.agg || !g.items) return; g.items.forEach(function (it) { if (nodes.has(it.id)) addEdge(edgeFor(g.rel, g.dir, nidNew, it)); }); });
      });
      render(); sim.alpha(0.6).restart();
      if (selected === id) renderPanel(id);
      return added.length;
    });
  }
  function expandAll(id) { return expandGroup(id, null, null, LIMIT); }
  function collapse(id) {
    const neigh = []; links.forEach(function (l) { if (l.s === id) neigh.push(l.t); else if (l.t === id) neigh.push(l.s); });
    let n = 0; neigh.forEach(function (nb) { if (degree(nb) <= 1) { removeNode(nb); n++; } });
    render(); sim.alpha(0.4).restart(); if (nodes.has(id)) renderPanel(id); return n;
  }
  function doUndo() {
    const op = undo.pop(); if (!op) return;
    op.added.forEach(removeNode); op.edges.forEach(function (eid) { links.delete(eid); });
    render(); sim.alpha(0.3).restart(); if (selected && nodes.has(selected)) renderPanel(selected);
  }
  function clearAll() { nodes.clear(); links.clear(); undo.length = 0; select(null); render(); LZ.hash.set({ n: null }, true); }
  function fit() {
    const arr = Array.from(nodes.values()); if (!arr.length) return;
    const x0 = d3.min(arr, function (d) { return d.x; }) - 40, x1 = d3.max(arr, function (d) { return d.x; }) + 40, y0 = d3.min(arr, function (d) { return d.y; }) - 40, y1 = d3.max(arr, function (d) { return d.y; }) + 40;
    const k = Math.min(3, 0.92 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * (x0 + x1) / 2, H / 2 - k * (y0 + y1) / 2).scale(k));
  }

  /* ---------- selection & panel ----------------------------------------- */
  function select(id) {
    selected = id;
    gNodes.selectAll("g.knode").classed("is-sel", function (d) { return d.id === selected; });
    gLinks.selectAll("path").classed("is-hl", function (l) { return selected && (l.s === selected || l.t === selected); });
    if (id) { LZ.hash.set({ n: id }, true); renderPanel(id); }
    else { LZ.clear($("kg-panel")).appendChild(LZ.el("p.panel__empty", "点击画布上的节点查看它的属性与关系；双击节点直接展开全部关系。")); }
  }
  function props(d) {
    const c = KG.core, v = d.data, rows = [];
    if (d.type === "V") {
      rows.push(["作者（原记）", v.a], ["版本", v.ed || "—"], ["时代", v.e], ["传承系统", v.l], ["体裁", (LZ.WORK_TYPE_ZH[v.w] || v.w) + " · 未审核"], ["文本范围", LZ.SCOPE_ZH[v.s] || v.s],
        ["对齐状态", LZ.ALIGN_ZH[v.al] || v.al], ["对齐章（默认集）", v.nd + (v.nr ? "（+" + v.nr + " 待审核）" : "")], ["公开处置", LZ.DISP_ZH[v.d] || v.d], ["数字来源", v.pv]);
    } else if (d.type === "P") {
      rows.push(["时代", (v.e || "—") + (v.ea ? "（或 " + v.ea + "）" : "")], ["生卒", v.dt || "—"], ["时代来源", v.src === "reference_crosschecked" ? "参考集核对" : (v.src === "placeholder" ? "占位" : "LLM · " + v.src)], ["置信度", v.cf || "—"], ["时代存疑", v.dp ? "是（跨朝代）" : "否"], ["所涉文献", v.nw + " 种"]);
    } else if (d.type === "A") {
      rows.push(["别名类型", v.t], ["规范人物", c.persons[v.p] ? c.persons[v.p].n : v.p]); if (v.note) rows.push(["备注", v.note]);
    } else if (d.type === "C") {
      rows.push(["层级", LZ.typeLabel(v.nt) + " · 未审核"], ["来源", v.sd ? "手工种子" : "LLM 扩展 · " + v.gb], ["定义", v.df], ["匹配特异性", { high: "高", medium: "中", low: "低（单字）" }[v.sp]], ["原始提及", LZ.fmt(v.raw)], ["高特异性提及", LZ.fmt(v.hi)], ["典型章次", (v.cc || []).join("、") || "—"], ["文本证据", v.at ? "有" : "无（语料中未出现）"]);
    } else if (d.type === "I") {
      const ver = c.versions[v[0]];
      rows.push(["文献", ver ? ver.t : v[0]], ["章", v[1] > 0 ? "第 " + v[1] + " 章" : "未对齐（chapter_num = −1）"], ["字数", LZ.fmt(v[2])], ["句数", LZ.fmt(v[3])], ["文本构成", COMP_ZH[v[4]]], ["切分方法", v[5]], ["对齐审核状态", STATUS_ZH[v[6]]], ["文中顺序", String(v[10])]);
      if (v[11] !== null && v[11] !== undefined) rows.push(["经文占比上限", LZ.pct(v[11], 0)]);
    } else if (d.type === "M") {
      const ver = c.versions[v[0]], cn = c.concepts[v[3]] ? c.concepts[v[3]].n : v[3];
      rows.push(["注家（原记）", v[4]], ["注家时代", v[6] || "不详"], ["版本时代", v[7] || "不详"], ["文献", ver ? ver.t : v[0]], ["章", "第 " + v[2] + " 章"], ["训释概念", cn], ["引文来源", PROV_ZH[v[8]]], ["可作原文引用", v[9] ? "是" : "否"], ["可靠性", v[10]], ["抽取方法", v[11] + " · 未审核"]);
      if (!v[12]) rows.push(["文本", v[14] ? "原文 " + v[14] + " 字（第三方转录，公开版撤除）" : (v[13] ? "模型转述 " + v[13] + " 字（公开版撤除）" : "—")]);
    } else if (d.type === "E") {
      rows.push(["引文类型", QK_ZH[v[1]]], ["可靠性", v[2]], ["与源文重合度", v[3] === null ? "—" : String(v[3])], ["逐字引用", v[4] ? "是" : "否"], ["引文字数", String(v[5]) + "（文本撤除）"]);
    } else if (d.type === "R") {
      rows.push(["关系类型", v.rel], ["依据", v.bs], ["置信", v.cf], ["可靠性", v.rl], ["断言者", v.as]);
    }
    return rows;
  }
  function pageLink(d) {
    if (d.type === "V") return ["witnesses.html#id=" + encodeURIComponent(d.key), "在文献页查看"];
    if (d.type === "P") return ["persons.html#id=" + encodeURIComponent(d.key), "在人物页查看"];
    if (d.type === "C") return ["concepts.html#c=" + encodeURIComponent(d.key), "在概念页查看"];
    if (d.type === "I" && d.data[1] > 0) return ["chapters.html#ch=" + d.data[1], "查看第 " + d.data[1] + " 章"];
    if (d.type === "M") return ["chapters.html#ch=" + d.data[2], "查看第 " + d.data[2] + " 章"];
    return null;
  }
  function renderPanel(id) {
    const d = nodes.get(id) || describe(id);
    const p = LZ.clear($("kg-panel"));
    if (!d) { p.appendChild(LZ.el("p.panel__empty", "节点不存在。")); return; }
    p.appendChild(LZ.el("div", LZ.badge(TYPES[d.type].zh + " · " + TYPES[d.type].en, "type", typeColor(d.type))));
    p.appendChild(LZ.el("h2.ptitle", d.full));
    const idEl = LZ.el("div.pid", { title: "点击复制", style: { cursor: "copy" } }, d.key);
    idEl.addEventListener("click", function () { try { navigator.clipboard.writeText(d.key); idEl.textContent = d.key + " ✓"; setTimeout(function () { idEl.textContent = d.key; }, 900); } catch (e) { /* ignore */ } });
    p.appendChild(idEl);
    if (d.type === "M" && d.data[12]) p.appendChild(LZ.el("div.quote", d.data[12]));
    const kv = LZ.el("dl.kv"); props(d).forEach(function (r) { kv.appendChild(LZ.el("dt", r[0])); kv.appendChild(LZ.el("dd", r[1])); }); p.appendChild(kv);
    const act = LZ.el("div.actions");
    if (d.type === "I") act.appendChild(LZ.el("button.btn.btn--sm.btn--primary", { type: "button", onClick: function () { LZ.detail.openInstance(d.key, { chapter: d.data[1] > 0 ? d.data[1] : "unaligned" }); } }, "查看实例内容"));
    if (d.type === "M") act.appendChild(LZ.el("button.btn.btn--sm.btn--primary", { type: "button", onClick: function () { LZ.detail.openCommentary(d.key, { chapter: d.data[2] }); } }, "查看条目详情"));
    const pl = pageLink(d); if (pl) act.appendChild(LZ.el("a.btn.btn--sm", { href: pl[0] }, pl[1]));
    if (!nodes.has(id)) act.appendChild(LZ.el("button.btn.btn--sm.btn--primary", { type: "button", onClick: function () { addSeed(id); } }, "加入画布"));
    p.appendChild(act);
    const sec = LZ.el("section", LZ.el("h4", "关系 · 展开邻居"));
    const groups = neighbors(id);
    if (!groups.length) sec.appendChild(LZ.el("p.panel__empty", "没有可展开的关系。"));
    groups.forEach(function (g) {
      if (g.agg) { sec.appendChild(LZ.el("div.rel-row", LZ.el("div.r", LZ.el("span", g.zh), LZ.el("span.agg", g.text)))); return; }
      const visible = g.items ? g.items.filter(function (it) { return nodes.has(it.id); }).length : 0;
      const total = g.items ? g.items.length : g.total;
      const remaining = g.items ? total - visible : null;
      const label = LZ.el("div.r", LZ.el("span", g.zh + (g.derived ? "（属性推导）" : "") + (g.dir === "in" ? " ←" : (g.dir === "both" ? " ↔" : " →"))),
        LZ.el("code", g.rel + " · " + (total === null ? "?" : LZ.fmt(total)) + (visible ? " · 已显示 " + visible : "")));
      const btnLabel = g.items === null ? "载入并展开" : (remaining > 0 ? "展开 " + Math.min(LIMIT, remaining) + (remaining > LIMIT ? " / " + LZ.fmt(remaining) : "") : "已全部显示");
      const btn = LZ.el("button.btn.btn--sm", { type: "button", disabled: g.items !== null && remaining === 0 }, btnLabel);
      btn.addEventListener("click", function () { if (!nodes.has(id)) addSeed(id, false); expandGroup(id, g.rel, g.dir, LIMIT); });
      sec.appendChild(LZ.el("div.rel-row", label, btn));
    });
    if (nodes.has(id)) {
      const b = LZ.el("button.btn.btn--sm.btn--primary", { type: "button", style: { marginTop: "10px" }, onClick: function () { expandAll(id); } }, "展开全部关系（每类 ≤ " + LIMIT + "）");
      sec.appendChild(b);
    }
    p.appendChild(sec);
    if (d.type === "M") p.appendChild(LZ.el("p.kg-note", { style: { marginTop: "10px" } }, "注疏条目由 LLM 辅助抽取（gloss_reviewed = FALSE）。只有 verbatim_contiguous 且属作者自有资源的条目在此显示原文。"));
    if (d.type === "I" && d.data[6] === 1) p.appendChild(LZ.el("p.kg-note", { style: { marginTop: "10px" } }, "此实例由 v1.1.2 的对齐恢复算法产生，未经专家确认，不在默认分析集内。"));
  }
  function addSeed(id, doExpand) {
    const p = split(id);
    return ensure(p[0]).then(function () {
      const d = addNode(id);
      if (!d) return;
      const t = d3.zoomTransform(svg.node());
      d.x = t.invertX(W / 2); d.y = t.invertY(H / 2);
      undo.push({ added: [id], edges: [] });
      fitOnSettle = true;
      render(); sim.alpha(0.5).restart();
      select(id);
      if (doExpand !== false) return expandAll(id);
    });
  }

  /* ---------- sidebar --------------------------------------------------- */
  function buildSidebar() {
    const seeds = [["C:dao", "概念「道」"], ["C:wuwei", "概念「无为」"], ["P:P_王弼", "人物「王弼」"], ["P:P_HESHANGGONG", "人物「河上公」"], ["V:DZ0682", "文献「道德真經注」"], ["V:S06453", "写本 S.6453"], ["V:WANGBI_TONGSHI_2026", "王弼注通释（作者整理本）"], ["R:PA-e2e5b942", "断言：蘇轍《老子解》两本"]];
    const box = LZ.clear($("kg-seeds"));
    seeds.forEach(function (s) { if (!describe(s[0])) return; box.appendChild(LZ.el("button.chip.chip--link", { type: "button", onClick: function () { addSeed(s[0]); } }, s[1])); });
    const tl = LZ.clear($("kg-types"));
    Object.keys(TYPES).forEach(function (t) {
      const m = TYPES[t];
      const sw = LZ.svg("svg", { viewBox: "-9 -9 18 18" });
      const path = LZ.svg("path", { d: shapePath(t, 6.5), fill: m.shape === "ring" ? "none" : "var(" + m.v + ")", stroke: "var(" + m.v + ")", "stroke-width": m.shape === "ring" ? 2 : 0 });
      sw.appendChild(path);
      const cb = LZ.el("input", { type: "checkbox", checked: true, onChange: function () { toggleType(t, cb.checked); } });
      tl.appendChild(LZ.el("label", cb, sw, LZ.el("span", m.zh, " ", LZ.el("span.en", m.en)), LZ.el("span.n", { "data-type": t }, "0")));
    });
    const rl = LZ.clear($("kg-rels"));
    Object.keys(RELS).forEach(function (r) {
      const m = RELS[r];
      const sw = LZ.svg("svg", { viewBox: "0 0 30 10" });
      sw.appendChild(LZ.svg("line", { x1: 1, y1: 5, x2: 29, y2: 5, stroke: m.derived ? "var(--ink-3)" : "var(--line-2)", "stroke-width": 1.6, "stroke-dasharray": m.dash || "" }));
      rl.appendChild(LZ.el("div", sw, LZ.el("span", m.zh + " "), LZ.el("code", r + (m.derived ? " ·属性推导" : ""))));
    });
    $("kg-q").addEventListener("input", LZ.debounce(search, 100));
    $("kg-q").addEventListener("keydown", function (e) { if (e.key === "Escape") { $("kg-results").classList.remove("is-on"); } if (e.key === "Enter") { const first = $("kg-results").querySelector("li[data-id]"); if (first) first.click(); } });
    document.addEventListener("click", function (e) { if (!e.target.closest(".search")) $("kg-results").classList.remove("is-on"); });
  }
  function toggleType(t, on) {
    if (on) hiddenTypes.delete(t); else { hiddenTypes.add(t); Array.from(nodes.keys()).forEach(function (id) { if (nodes.get(id).type === t) removeNode(id); }); }
    render(); sim.alpha(0.3).restart();
  }
  function paintTypeCounts() {
    const counts = {}; nodes.forEach(function (d) { counts[d.type] = (counts[d.type] || 0) + 1; });
    document.querySelectorAll("#kg-types .n").forEach(function (el) { el.textContent = counts[el.dataset.type] || 0; });
  }
  function search() {
    const q = $("kg-q").value.trim().toLowerCase(), box = LZ.clear($("kg-results"));
    if (!q) { box.classList.remove("is-on"); return; }
    const c = KG.core, hits = [];
    Object.keys(c.versions).forEach(function (id) { const v = c.versions[id]; const hay = (v.t + " " + v.a + " " + id + " " + v.ed).toLowerCase(); if (hay.indexOf(q) >= 0) hits.push({ id: nid("V", id), t: "文献", label: v.t, sub: v.a + " · " + v.e, rank: v.t.toLowerCase().indexOf(q) === 0 ? 0 : 1 }); });
    Object.keys(c.persons).forEach(function (id) { const v = c.persons[id]; if ((v.n + " " + id).toLowerCase().indexOf(q) >= 0) hits.push({ id: nid("P", id), t: "人物", label: v.n, sub: v.e || "", rank: 0 }); });
    Object.keys(c.aliases).forEach(function (id) { const v = c.aliases[id]; if (v.t !== "canonical" && v.a.toLowerCase().indexOf(q) >= 0) hits.push({ id: nid("P", v.p), t: "别名", label: v.a, sub: "→ " + (c.persons[v.p] ? c.persons[v.p].n : v.p), rank: 0 }); });
    Object.keys(c.concepts).forEach(function (id) { const v = c.concepts[id]; if ((v.n + " " + id).toLowerCase().indexOf(q) >= 0) hits.push({ id: nid("C", id), t: "概念", label: v.n, sub: LZ.typeZh(v.nt), rank: v.n === q ? -1 : 0 }); });
    hits.sort(function (a, b) { return a.rank - b.rank || a.label.length - b.label.length; });
    hits.slice(0, 40).forEach(function (h) {
      const li = LZ.el("li", { "data-id": h.id, role: "option" }, LZ.el("span.t", h.t), LZ.el("span", h.label), LZ.el("span.s", h.sub));
      li.addEventListener("click", function () { box.classList.remove("is-on"); $("kg-q").value = ""; addSeed(h.id); });
      box.appendChild(li);
    });
    if (!hits.length) box.appendChild(LZ.el("li.g", "没有匹配的文献、人物或概念"));
    box.classList.add("is-on");
  }

  /* ---------- toolbar ---------------------------------------------------- */
  function buildToolbar() {
    $("btn-expand").addEventListener("click", function () { if (selected) expandAll(selected); });
    $("btn-collapse").addEventListener("click", function () { if (selected) collapse(selected); });
    $("btn-remove").addEventListener("click", function () { if (selected) { const id = selected; removeNode(id); render(); sim.alpha(0.3).restart(); } });
    $("btn-pin").addEventListener("click", function () { const d = selected && nodes.get(selected); if (!d) return; d.pinned = !d.pinned; if (d.pinned) { d.fx = d.x; d.fy = d.y; } else { d.fx = null; d.fy = null; } render(); });
    $("btn-undo").addEventListener("click", doUndo);
    $("btn-fit").addEventListener("click", fit);
    $("btn-reheat").addEventListener("click", function () { nodes.forEach(function (d) { if (!d.pinned) { d.fx = null; d.fy = null; } }); sim.alpha(0.9).restart(); });
    $("btn-clear").addEventListener("click", clearAll);
    $("btn-svg").addEventListener("click", exportSvg);
    $("chk-elabels").addEventListener("change", function () { showELabels = $("chk-elabels").checked; render(); tick(); });
  }
  function exportSvg() {
    const clone = svg.node().cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.style.background = LZ.cssVar("--paper-2");
    clone.querySelectorAll("text").forEach(function (t) { t.setAttribute("font-family", "Noto Serif SC, Songti SC, SimSun, serif"); t.setAttribute("font-size", t.classList.contains("elabel") ? "10" : "12"); t.setAttribute("fill", LZ.cssVar("--ink")); t.setAttribute("stroke", LZ.cssVar("--paper-2")); t.setAttribute("stroke-width", "3"); t.setAttribute("paint-order", "stroke"); });
    clone.querySelectorAll("path.klink").forEach(function (l) { l.setAttribute("fill", "none"); l.setAttribute("stroke", LZ.cssVar("--line-2")); });
    clone.querySelectorAll("circle.hit").forEach(function (h) { h.remove(); });
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "laozikg-graph.svg"; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- seed scene ------------------------------------------------ */
  function seedScene() {
    const start = LZ.hash.get("n");
    if (start && describe(start) !== null || (start && /^[IME]:/.test(start))) {
      return ensure(split(start)[0]).then(function () { if (describe(start)) return addSeed(start); return defaultScene(); });
    }
    return defaultScene();
  }
  function defaultScene() {
    return Promise.all([loadPart("inst"), loadPart("comm")]).then(function () {
      const c = "C:wuwei";
      const d = addNode(c); d.x = W / 2; d.y = H / 2;
      return expandGroup(c, "RELATED_CONCEPT", null, 10).then(function () { return expandGroup(c, "MENTIONS_CONCEPT", "in", 6); })
        .then(function () { return expandGroup(c, "GLOSSES", "in", 5); })
        .then(function () {
          const ps = [];
          nodes.forEach(function (n) { if (n.type === "I") ps.push(expandGroup(n.id, "HAS_INSTANCE", "in", 1)); if (n.type === "M") { ps.push(expandGroup(n.id, "COMMENTARY_OF", "out", 1)); ps.push(expandGroup(n.id, "COMMENTATOR", "out", 1)); } });
          return Promise.all(ps);
        }).then(function () { undo.length = 0; select(c); fitOnSettle = true; sim.alpha(0.5).restart(); });
    });
  }

  /* ---------- boot ------------------------------------------------------- */
  loadPart("core").then(function () {
    setup(); buildSidebar(); buildToolbar();
    window.addEventListener("lz:theme", function () { render(); });
    window.addEventListener("hashchange", function () { const id = LZ.hash.get("n"); if (id && id !== selected && describe(id)) addSeed(id); });
    return seedScene();
  }).catch(function (e) { console.error(e); $("kg-panel").textContent = "数据加载失败：" + e.message; });
})();
