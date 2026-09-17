/* persons page: timeline + table + detail drawer */
(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  let S, P, byId = {}, table;

  LZ.loadAll(["summary", "persons"]).then(function (r) {
    S = r[0]; P = r[1];
    LZ.setEras(S.era_order, S.era_span);
    P.forEach(function (p) { byId[p.id] = p; });
    drawTimeline();
    buildTable();
    $("q").addEventListener("input", LZ.debounce(apply, 120));
    apply();
    const id = LZ.hash.get("id");
    if (id && byId[id]) openDetail(byId[id]);
    window.addEventListener("hashchange", function () { const id = LZ.hash.get("id"); if (id && byId[id]) openDetail(byId[id]); });
    window.addEventListener("lz:theme", drawTimeline);
    LZ.drawer.onClose = function () { LZ.hash.set({ id: null }, true); };
  }).catch(function (e) { console.error(e); $("ptable").textContent = "数据加载失败：" + e.message; });

  /* year estimate: explicit dates → midpoint; else era midpoint */
  function yearOf(p) {
    const m = /(-?\d{3,4})\s*[-–—]\s*(-?\d{1,4})/.exec(p.dates || "");
    if (m) { let a = +m[1], b = +m[2]; if (/前/.test(p.dates)) { a = -Math.abs(a); b = /前\d+$|前\d+\s*$/.test(p.dates) || /-前/.test(p.dates) ? -Math.abs(b) : b; } if (/^约?前\d+-前\d+/.test(p.dates)) { a = -Math.abs(a); b = -Math.abs(b); } return (a + b) / 2; }
    const s = /^约?前\s*(\d+)\s*世[纪紀]/.exec(p.dates || "");
    if (s) return -((+s[1] - 1) * 100 + 50);
    const c = /(\d{1,2})\s*世[纪紀]/.exec(p.dates || "");
    if (c) return (+c[1] - 1) * 100 + 50;
    return LZ.eraMid(p.era);
  }

  function drawTimeline() {
    const host = LZ.clear($("timeline"));
    const rows = P.filter(function (p) { return p.status === "canonical" && yearOf(p) !== null; }).map(function (p) { return { p: p, year: yearOf(p) }; });
    const W = 1100, H = 300, m = { t: 34, r: 30, b: 30, l: 30 };
    const x = d3.scaleLinear().domain([-800, 2000]).range([m.l, W - m.r]);
    const r = d3.scaleSqrt().domain([0, d3.max(rows, function (d) { return d.p.works.length; }) || 1]).range([4, 14]);
    const svg = d3.select(host).append("svg").attr("viewBox", [0, 0, W, H]).attr("class", "timeline").attr("role", "img").attr("aria-label", "人物年表");
    // era bands (major dynasties only)
    const bands = ["春秋", "战国", "西汉", "东汉", "三国", "东晋", "南北朝", "唐", "北宋", "南宋", "元", "明", "清"];
    const eg = svg.append("g").attr("class", "era");
    bands.forEach(function (e, i) {
      const s = LZ.ERA_SPAN[e]; if (!s || s[0] === null) return;
      eg.append("rect").attr("x", x(s[0])).attr("y", m.t).attr("width", Math.max(1, x(s[1]) - x(s[0]))).attr("height", H - m.t - m.b).attr("fill", i % 2 ? LZ.cssVar("--paper-3") : "transparent").attr("opacity", 0.7);
      if (x(s[1]) - x(s[0]) > 26) eg.append("text").attr("x", (x(s[0]) + x(s[1])) / 2).attr("y", m.t - 10).attr("text-anchor", "middle").text(e);
    });
    const ax = svg.append("g").attr("class", "tick").attr("transform", "translate(0," + (H - m.b) + ")").call(d3.axisBottom(x).tickValues([-700, -500, -300, -100, 100, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900]).tickFormat(function (v) { return v < 0 ? "前" + (-v) : String(v); }).tickSize(4));
    ax.select(".domain").attr("stroke", LZ.cssVar("--line-2")); ax.selectAll("line").attr("stroke", LZ.cssVar("--line-2"));
    // beeswarm-ish: assign lanes to avoid overlap
    rows.sort(function (a, b) { return a.year - b.year; });
    const placed = [];
    rows.forEach(function (d) {
      d.r = r(d.p.works.length); d.cx = x(d.year);
      let lane = 0;
      for (; lane < 12; lane++) {
        const cy = (H - m.b) - 22 - lane * 20;
        const clash = placed.some(function (q) { return Math.abs(q.cx - d.cx) < q.r + d.r + 2 && Math.abs(q.cy - cy) < q.r + d.r + 2; });
        if (!clash) { d.cy = cy; break; }
      }
      if (d.cy === undefined) d.cy = (H - m.b) - 22 - (lane % 12) * 20;
      placed.push(d);
    });
    const col = LZ.layerColor("structure");
    const g = svg.append("g");
    const dots = g.selectAll("circle").data(rows).join("circle").attr("class", "dot")
      .attr("cx", function (d) { return d.cx; }).attr("cy", function (d) { return d.cy; }).attr("r", function (d) { return d.r; })
      .attr("fill", function (d) { return d.p.era_disputed ? LZ.cssVar("--paper-2") : col; }).attr("stroke", function (d) { return d.p.era_disputed ? LZ.cssVar("--gold") : LZ.cssVar("--paper-2"); }).attr("stroke-width", function (d) { return d.p.era_disputed ? 2 : 1.5; })
      .attr("tabindex", 0).attr("role", "button").attr("aria-label", function (d) { return d.p.name; })
      .on("click", function (e, d) { openDetail(d.p); }).on("keydown", function (e, d) { if (e.key === "Enter") openDetail(d.p); });
    dots.each(function (d) { LZ.tip.bind(this, function () { return LZ.tip.rows(d.p.name, [["时代", d.p.era + (d.p.era_alt ? "（或 " + d.p.era_alt + "）" : "")], ["生卒", d.p.dates || "—"], ["所涉文献", d.p.works.length + " 种"], ["注疏条目", LZ.fmt(d.p.commentary)]], d.p.era_disputed ? "时代存疑（跨朝代）" : null); }); });
    // labels for the most-connected persons
    const labeled = rows.slice().sort(function (a, b) { return b.p.works.length - a.p.works.length; }).slice(0, 16);
    g.selectAll("text").data(labeled).join("text").attr("x", function (d) { return d.cx + d.r + 3; }).attr("y", function (d) { return d.cy + 4; }).text(function (d) { return d.p.name; });
    host.appendChild(LZ.el("p.small.muted", { style: { margin: "6px 8px 0" } }, "年份取自 person_era_dates（生卒年的中点），缺失时取时代区间的中点；日本江户、近代人物以其年代绘制。时代不详的 " + P.filter(function (p) { return p.status === "canonical" && yearOf(p) === null; }).length + " 位未绘入。"));
  }

  function buildTable() {
    const cols = [
      { key: "name", label: "人物", sort: function (p) { return p.name; }, render: function (p) { return LZ.el("span", LZ.el("b", p.name), p.aliases.length > 1 ? LZ.el("span.sub", "别名：" + p.aliases.filter(function (a) { return a.type !== "canonical"; }).map(function (a) { return a.alias; }).join("、")) : null); } },
      { key: "era", label: "时代", sort: function (p) { return LZ.eraIndex(p.era); }, render: function (p) { return LZ.el("span", p.era || "—", p.era_disputed ? LZ.badge("存疑 · 或 " + p.era_alt, "unreviewed") : null); } },
      { key: "dates", label: "生卒", render: function (p) { return p.dates || "—"; } },
      { key: "source", label: "时代来源", render: function (p) { return p.era_source === "reference_crosschecked" ? "参考集核对" : (p.era_source === "placeholder" ? "—" : LZ.badge("LLM · " + p.era_confidence, "ai")); } },
      { key: "works", label: "文献", num: true, sort: function (p) { return p.works.length; }, render: function (p) { return String(p.works.length); } },
      { key: "commentary", label: "注疏条目", num: true, sort: function (p) { return p.commentary; }, render: function (p) { return p.commentary ? LZ.fmt(p.commentary) : "—"; } }
    ];
    table = LZ.table(P, cols, { sortKey: "era", sortDir: "asc", compact: true, onRow: openDetail });
    $("ptable").appendChild(table);
  }
  function apply() {
    const q = $("q").value.trim().toLowerCase();
    const rows = P.filter(function (p) { if (!q) return true; const hay = (p.name + " " + p.aliases.map(function (a) { return a.alias; }).join(" ") + " " + p.era + " " + p.id).toLowerCase(); return hay.indexOf(q) >= 0; });
    $("count").textContent = "显示 " + rows.length + " / " + P.length + " 位";
    table.update(rows);
  }

  function openDetail(p) {
    LZ.hash.set({ id: p.id }, true);
    const c = [];
    c.push(LZ.el("div.eyebrow.eyebrow--plain", p.id));
    c.push(LZ.el("h2", p.name));
    c.push(LZ.el("div.chips", { style: { marginBottom: "8px" } },
      LZ.badge(p.status === "canonical" ? "规范人物" : "占位"),
      p.era ? LZ.badge("时代：" + p.era + (p.era_alt ? " / " + p.era_alt : "")) : null,
      p.era_disputed ? LZ.badge("时代存疑", "unreviewed") : null,
      p.era_source && p.era_source !== "placeholder" ? LZ.badge((p.era_source === "reference_crosschecked" ? "参考集核对" : "LLM 判定") + " · 置信 " + p.era_confidence + " · 未审核", p.era_source === "reference_crosschecked" ? null : "ai") : null));
    if (p.dates) c.push(LZ.el("p", { style: { color: "var(--ink-2)" } }, "生卒：" + p.dates));
    if (p.aliases.length) c.push(LZ.el("div.dsec", LZ.el("h4", "表面写法 · " + p.aliases.length + " 个"), LZ.el("div.alias-list", p.aliases.map(function (a) { return LZ.chip([a.alias, LZ.el("span.n", a.type)], null, a.type === "canonical" ? "chip--on" : null); }))));
    if (p.works.length) {
      c.push(LZ.el("div.dsec", LZ.el("h4", "所涉文献 · " + p.works.length + " 种"), LZ.el("ul.works", p.works.map(function (w) {
        return LZ.el("li", LZ.el("a", { href: "witnesses.html#id=" + encodeURIComponent(w.version_id) }, w.title), LZ.el("span.role", (w.role_raw || (w.edge_type === "annotated" ? "注" : "撰")) + (w.attributed ? " · 题署" : "") + " · 版本时代 " + (w.era || "不详")));
      }))));
    } else if (p.status === "canonical") c.push(LZ.el("p.muted", "没有署名的文献。"));
    if (p.commentary) {
      c.push(LZ.el("div.dsec", LZ.el("h4", "作为注家出现的注疏条目 · " + LZ.fmt(p.commentary)), LZ.bars(p.commentary_concepts.map(function (x) { return { label: x[1], value: x[2], href: "concepts.html#c=" + x[0] }; }), { labelWidth: "90px", color: LZ.layerColor("commentary") })));
    }
    c.push(LZ.el("p.small.muted", { style: { marginTop: "18px" } }, "「版本时代」是该文献书目记录的时代；「时代」是人物自身的时代。二者不可互换。"));
    LZ.drawer.open(c);
  }
})();
