/* LaoziKG site — shared runtime (no build step; plain ES2018+) */
(function () {
  "use strict";

  const LZ = {};
  window.LZ = LZ;

  /* ---------- small helpers ------------------------------------------ */
  LZ.fmt = function (n, digits) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    if (typeof digits === "number") return Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return Number(n).toLocaleString("en-US");
  };
  LZ.pct = function (x, digits) { return (x * 100).toFixed(digits === undefined ? 1 : digits) + "%"; };
  LZ.bytes = function (b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / 1024 / 1024).toFixed(2) + " MB";
  };
  LZ.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, s = this; t = setTimeout(function () { fn.apply(s, a); }, ms || 150); }; };
  LZ.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /** el("div.card#id", {attr: v, onClick: fn, style: {...}}, ...children) — children are nodes or strings (textContent, never HTML) */
  LZ.el = function (spec, attrs) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec || "div");
    const node = document.createElement((m && m[1]) || "div");
    if (m && m[2]) {
      m[2].split(/(?=[.#])/).forEach(function (tok) {
        if (tok[0] === ".") node.classList.add(tok.slice(1));
        else if (tok[0] === "#") node.id = tok.slice(1);
      });
    }
    let children = Array.prototype.slice.call(arguments, 2);
    if (attrs && (attrs instanceof Node || typeof attrs === "string" || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className += (node.className ? " " : "") + v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (/^on[A-Z]/.test(k)) node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "html") node.innerHTML = v; // only for trusted, site-authored markup
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    LZ.append(node, children);
    return node;
  };
  LZ.append = function (node, children) {
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return LZ.append(node, c);
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  };
  LZ.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  LZ.svg = function (tag, attrs) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  };
  LZ.cssVar = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };

  /* ---------- data ---------------------------------------------------- */
  const cache = {};
  LZ.load = function (name) {
    if (!cache[name]) {
      cache[name] = fetch("data/" + name + ".json", { cache: "force-cache" }).then(function (r) {
        if (!r.ok) throw new Error("failed to load " + name + ".json (" + r.status + ")");
        return r.json();
      });
    }
    return cache[name];
  };
  LZ.loadAll = function (names) { return Promise.all(names.map(LZ.load)); };

  /* ---------- theme --------------------------------------------------- */
  LZ.theme = {
    get: function () {
      const t = document.documentElement.getAttribute("data-theme");
      if (t) return t;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    set: function (t) {
      document.documentElement.setAttribute("data-theme", t);
      try { localStorage.setItem("lz-theme", t); } catch (e) { /* storage may be unavailable */ }
      window.dispatchEvent(new CustomEvent("lz:theme", { detail: t }));
      LZ.theme.paint();
    },
    toggle: function () { LZ.theme.set(LZ.theme.get() === "dark" ? "light" : "dark"); },
    paint: function () {
      const b = document.getElementById("theme-toggle");
      if (!b) return;
      const dark = LZ.theme.get() === "dark";
      b.setAttribute("aria-label", dark ? "切换到浅色主题" : "切换到深色主题");
      b.title = b.getAttribute("aria-label");
      b.innerHTML = dark
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    }
  };
  window.addEventListener("storage", function (e) { if (e.key === "lz-theme" && e.newValue) LZ.theme.set(e.newValue); });

  /* ---------- palette ------------------------------------------------- */
  LZ.TYPE_META = {
    OntologicalConcept: { zh: "本体", en: "Ontological", stratum: "atomic", v: "--t-ontological" },
    CosmologicalConcept: { zh: "宇宙", en: "Cosmological", stratum: "atomic", v: "--t-cosmological" },
    EpistemicConcept: { zh: "认识", en: "Epistemic", stratum: "atomic", v: "--t-epistemic" },
    CultivationConcept: { zh: "修身", en: "Cultivation", stratum: "atomic", v: "--t-cultivation" },
    EthicalConcept: { zh: "伦理", en: "Ethical", stratum: "atomic", v: "--t-ethical" },
    PoliticalConcept: { zh: "政治", en: "Political", stratum: "atomic", v: "--t-political" },
    Practice: { zh: "工夫", en: "Practice", stratum: "composite", v: "--t-composite", shape: "square" },
    Phrase: { zh: "语句", en: "Phrase", stratum: "composite", v: "--t-composite", shape: "diamond" },
    Proposition: { zh: "命题", en: "Proposition", stratum: "composite", v: "--t-composite", shape: "triangle" },
    Metaphor: { zh: "譬喻", en: "Metaphor", stratum: "composite", v: "--t-composite", shape: "ring" }
  };
  LZ.TYPE_ORDER = Object.keys(LZ.TYPE_META);
  LZ.typeColor = function (t) { const m = LZ.TYPE_META[t]; return LZ.cssVar(m ? m.v : "--t-composite"); };
  LZ.typeZh = function (t) { const m = LZ.TYPE_META[t]; return m ? m.zh : t; };
  LZ.typeLabel = function (t) { const m = LZ.TYPE_META[t]; return m ? m.zh + " · " + m.en : t; };
  LZ.layerColor = function (layer) { return LZ.cssVar({ structure: "--c-structure", variant: "--c-variant", mention: "--c-mention", commentary: "--c-commentary" }[layer] || "--c-structure"); };

  /** sequential ramp for a layer hue: t in [0,1] → colour (Lab interpolation from the panel surface to the hue's deep end) */
  LZ.ramp = function (layer) {
    const hue = LZ.layerColor(layer);
    const surface = LZ.cssVar("--paper-3");
    const dark = LZ.theme.get() === "dark";
    const deep = window.d3 ? d3.color(hue) : null;
    if (!window.d3) return function () { return hue; };
    const end = dark ? d3.interpolateLab(hue, "#ffffff")(0.25) : d3.interpolateLab(hue, "#000000")(0.25);
    const interp = d3.interpolateLab(surface, end);
    return function (t) { return interp(LZ.clamp(t, 0, 1)); };
  };
  LZ.isDark = function (color) { const c = d3.color(color); if (!c) return false; const r = c.rgb(); return (0.2126 * r.r + 0.7152 * r.g + 0.0722 * r.b) < 128; };

  /* ---------- eras ---------------------------------------------------- */
  LZ.ERA = [];
  LZ.ERA_SPAN = {};
  LZ.setEras = function (order, span) { LZ.ERA = order || []; LZ.ERA_SPAN = span || {}; };
  LZ.eraIndex = function (e) { const i = LZ.ERA.indexOf(e); return i < 0 ? LZ.ERA.length : i; };
  LZ.eraMid = function (e) { const s = LZ.ERA_SPAN[e]; return s && s[0] !== null ? (s[0] + s[1]) / 2 : null; };
  LZ.WORK_TYPE_ZH = { ddj_commentary: "《道德经》注疏", manuscript_composite: "写本合抄", related_laozi_text: "老子相关文献", canonical_ddj: "《道德经》经文本", apocryphal_text: "托名/道教经典", fragment: "残片", biography_text: "老子传记", ritual_text: "科仪文本" };
  LZ.SCOPE_ZH = { partial: "部分章", not_ddj: "非《道德经》", full_81: "全八十一章", single_unit: "单一单元" };
  LZ.ALIGN_ZH = { aligned_partial: "部分对齐", aligned_full: "完全对齐", unaligned: "未对齐" };
  LZ.DISP_ZH = { full_text: "全文发布", metadata_and_offsets: "仅元数据与偏移", reference_only: "仅书目记录" };
  LZ.COMP_ZH = { mixed: "经注混合", commentary_dominant: "注文为主", scripture_dominant: "经文为主", unknown: "未知" };
  LZ.OP_ZH = { insert: "增", delete: "删", replace: "改" };
  LZ.REL_ZH = { EXPRESSES: "表达", REALIZES: "实现", SYMBOLIZES: "象征" };
  LZ.RELCAT_ZH = { lexical_semantic: "词形包含", semantic: "语义", realization: "实现", symbolic: "象征" };
  LZ.LINEAGE_EN = { "明清注本系统": "Ming–Qing commentary editions", "敦煌吐鲁番写本系统": "Dunhuang–Turfan manuscripts", "道藏收录系统": "Daozang canon", "河上公注系统": "Heshanggong commentary", "王弼注系统": "Wang Bi commentary", "郭店楚简": "Guodian bamboo slips", "帛书系统": "Mawangdui silk manuscripts" };

  /* ---------- URL hash params ----------------------------------------- */
  LZ.hash = {
    get: function (key) { const p = new URLSearchParams(location.hash.replace(/^#/, "")); return key ? p.get(key) : p; },
    set: function (obj, replace) {
      const p = new URLSearchParams(location.hash.replace(/^#/, ""));
      Object.keys(obj).forEach(function (k) { if (obj[k] === null || obj[k] === undefined || obj[k] === "") p.delete(k); else p.set(k, obj[k]); });
      const h = p.toString();
      const url = location.pathname + location.search + (h ? "#" + h : "");
      if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
    }
  };

  /* ---------- tooltip ------------------------------------------------- */
  let tipEl = null;
  LZ.tip = {
    node: function () { if (!tipEl) { tipEl = LZ.el("div.tip", { role: "tooltip" }); document.body.appendChild(tipEl); } return tipEl; },
    show: function (content, x, y) {
      const t = LZ.tip.node();
      LZ.clear(t);
      LZ.append(t, content);
      t.classList.add("is-on");
      LZ.tip.move(x, y);
    },
    /** rows: [[label, value], ...] */
    rows: function (title, rows, note) {
      const out = [];
      if (title) out.push(LZ.el("div.tip__title", title));
      (rows || []).forEach(function (r) { out.push(LZ.el("div.tip__row", LZ.el("span", r[0]), LZ.el("b", r[1]))); });
      if (note) out.push(LZ.el("div.tip__note", note));
      return out;
    },
    move: function (x, y) {
      const t = LZ.tip.node();
      const w = t.offsetWidth, h = t.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > window.innerWidth - 8) left = x - w - 14;
      if (top + h > window.innerHeight - 8) top = y - h - 14;
      t.style.left = Math.max(4, left) + "px";
      t.style.top = Math.max(4, top) + "px";
    },
    hide: function () { if (tipEl) tipEl.classList.remove("is-on"); },
    /** attach hover+focus tooltip to an element; builder(el) returns content */
    bind: function (el, builder) {
      el.addEventListener("pointerenter", function (e) { LZ.tip.show(builder(el, e), e.clientX, e.clientY); });
      el.addEventListener("pointermove", function (e) { LZ.tip.move(e.clientX, e.clientY); });
      el.addEventListener("pointerleave", LZ.tip.hide);
      el.addEventListener("focus", function () { const r = el.getBoundingClientRect(); LZ.tip.show(builder(el), r.left + r.width / 2, r.bottom); });
      el.addEventListener("blur", LZ.tip.hide);
    }
  };

  /* ---------- widgets ------------------------------------------------- */
  LZ.badge = function (text, kind, sw) {
    const b = LZ.el("span.badge" + (kind ? ".badge--" + kind : ""), text);
    if (sw) b.style.setProperty("--sw", sw);
    return b;
  };
  LZ.typeBadge = function (t) { return LZ.badge(LZ.typeLabel(t), "type", LZ.typeColor(t)); };
  LZ.chip = function (text, href, cls) {
    const c = href ? LZ.el("a.chip.chip--link", { href: href }, text) : LZ.el("span.chip", text);
    if (cls) cls.split(" ").forEach(function (k) { c.classList.add(k); });
    return c;
  };
  LZ.seg = function (options, value, onChange) {
    const s = LZ.el("div.seg", { role: "tablist" });
    options.forEach(function (o) {
      const b = LZ.el("button.seg__btn", { type: "button", role: "tab", "aria-selected": String(o.value === value) }, o.label);
      if (o.value === value) b.classList.add("is-on");
      b.addEventListener("click", function () {
        s.querySelectorAll(".seg__btn").forEach(function (x) { x.classList.remove("is-on"); x.setAttribute("aria-selected", "false"); });
        b.classList.add("is-on"); b.setAttribute("aria-selected", "true");
        onChange(o.value);
      });
      s.appendChild(b);
    });
    s.set = function (v) { s.querySelectorAll(".seg__btn").forEach(function (x, i) { const on = options[i].value === v; x.classList.toggle("is-on", on); x.setAttribute("aria-selected", String(on)); }); };
    return s;
  };
  /** horizontal bar list. rows: [{label, value, href, sub}] */
  LZ.bars = function (rows, opts) {
    opts = opts || {};
    const max = opts.max || Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    const wrap = LZ.el("div.minibars");
    if (opts.labelWidth) wrap.style.setProperty("--mb-label", opts.labelWidth);
    rows.forEach(function (r) {
      const label = r.href ? LZ.el("a", { href: r.href }, r.label) : (r.onClick ? LZ.el("a", { href: "#", onClick: function (e) { e.preventDefault(); r.onClick(r); } }, r.label) : r.label);
      const row = LZ.el("div.mb",
        LZ.el("div.mb__label", { title: typeof r.label === "string" ? r.label : "" }, label),
        LZ.el("div.mb__track", LZ.el("div.mb__fill", { style: { width: (100 * r.value / max).toFixed(2) + "%", background: r.color || opts.color || null } })),
        LZ.el("div.mb__val", opts.format ? opts.format(r.value, r) : LZ.fmt(r.value)));
      if (r.tip) LZ.tip.bind(row, function () { return r.tip; });
      wrap.appendChild(row);
    });
    return wrap;
  };
  /** 81-bin sparkline (index 0 → chapter 1). values: number[81] */
  LZ.spark = function (values, opts) {
    opts = opts || {};
    const max = Math.max.apply(null, values.concat([1]));
    const s = LZ.el("div.spark", { style: { "--sp-color": opts.color || null } });
    values.forEach(function (v, i) {
      const bar = LZ.el("i", { style: { height: Math.max(1, 100 * v / max) + "%" }, tabindex: -1 });
      LZ.tip.bind(bar, function () { return LZ.tip.rows("第 " + (i + 1) + " 章", [[opts.label || "值", opts.format ? opts.format(v) : LZ.fmt(v)]]); });
      if (opts.onClick) { bar.style.cursor = "pointer"; bar.addEventListener("click", function () { opts.onClick(i + 1); }); }
      s.appendChild(bar);
    });
    return s;
  };
  LZ.legend = function (items) {
    const l = LZ.el("div.legend");
    items.forEach(function (it) {
      const sw = LZ.el("span.sw" + (it.shape ? ".sw--" + it.shape : ""), { style: { "--sw": it.color } });
      l.appendChild(LZ.el("span.legend__item", sw, it.label));
    });
    return l;
  };
  /** sortable table helper: cols: [{key, label, num, render(row)→node|string, sort(row)→value}] */
  LZ.table = function (rows, cols, opts) {
    opts = opts || {};
    let sortKey = opts.sortKey || null, sortDir = opts.sortDir || "desc";
    const table = LZ.el("table.table" + (opts.compact ? ".table--compact" : ""));
    const thead = LZ.el("thead"), tbody = LZ.el("tbody");
    table.appendChild(thead); table.appendChild(tbody);
    function render() {
      LZ.clear(thead); LZ.clear(tbody);
      const tr = LZ.el("tr");
      cols.forEach(function (c) {
        const th = LZ.el("th" + (c.num ? ".num" : ""), { "data-sort": c.sort || c.num ? "1" : null, class: c.cls || null }, c.label);
        if (c.key === sortKey) th.classList.add(sortDir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
        if (c.sort || c.num) th.addEventListener("click", function () {
          if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc"; else { sortKey = c.key; sortDir = c.num ? "desc" : "asc"; }
          render();
        });
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      let data = rows.slice();
      if (sortKey) {
        const col = cols.find(function (c) { return c.key === sortKey; });
        const get = col.sort || function (r) { return r[col.key]; };
        data.sort(function (a, b) {
          const va = get(a), vb = get(b);
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "zh");
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
      if (opts.limit) data = data.slice(0, opts.limit);
      data.forEach(function (r) {
        const trr = LZ.el("tr" + (opts.onRow ? ".row-link" : ""));
        cols.forEach(function (c) { trr.appendChild(LZ.el("td" + (c.num ? ".num" : ""), { class: c.cls || null }, c.render ? c.render(r) : (c.num ? LZ.fmt(r[c.key]) : r[c.key]))); });
        if (opts.onRow) { trr.tabIndex = 0; trr.addEventListener("click", function () { opts.onRow(r); }); trr.addEventListener("keydown", function (e) { if (e.key === "Enter") opts.onRow(r); }); }
        tbody.appendChild(trr);
      });
      if (!data.length) tbody.appendChild(LZ.el("tr", LZ.el("td", { colspan: cols.length }, LZ.el("div.empty", opts.empty || "没有符合条件的记录"))));
    }
    render();
    table.update = function (newRows) { rows = newRows; render(); };
    return table;
  };

  /* ---------- drawer ----------------------------------------------------- */
  LZ.drawer = (function () {
    let d = null, scrim = null;
    function ensure() {
      if (d) return;
      scrim = LZ.el("div.scrim"); scrim.addEventListener("click", LZ.drawer.close);
      d = LZ.el("aside.drawer", { role: "dialog", "aria-modal": "true" });
      document.body.appendChild(scrim); document.body.appendChild(d);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") LZ.drawer.close(); });
    }
    return {
      open: function (content) {
        ensure();
        d.classList.remove("drawer--wide");
        LZ.clear(d);
        d.appendChild(LZ.el("button.iconbtn.drawer__close", { type: "button", "aria-label": "关闭", onClick: LZ.drawer.close }, LZ.el("span", { html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })));
        LZ.append(d, content);
        d.classList.add("is-open"); scrim.classList.add("is-open");
        d.scrollTop = 0;
        document.body.style.overflow = "hidden";
      },
      close: function () { if (!d) return; d.classList.remove("is-open"); scrim.classList.remove("is-open"); document.body.style.overflow = ""; if (LZ.drawer.onClose) LZ.drawer.onClose(); },
      isOpen: function () { return !!(d && d.classList.contains("is-open")); }
    };
  })();

  /* ---------- page chrome ------------------------------------------------ */
  const NAV = [
    ["index.html", "首页", "home"], ["graph.html", "图谱", "graph"], ["concepts.html", "概念", "concepts"], ["witnesses.html", "文献", "witnesses"],
    ["chapters.html", "章节", "chapters"], ["persons.html", "人物", "persons"], ["data.html", "数据", "data"]
  ];
  LZ.REPO = "https://github.com/psknlr/LZ-KGVar";
  LZ.chrome = function () {
    const page = document.body.dataset.page;
    const header = document.getElementById("site-header");
    if (header) {
      const nav = LZ.el("nav.nav", { "aria-label": "站点导航" });
      NAV.forEach(function (n) { nav.appendChild(LZ.el("a" + (n[2] === page ? ".is-active" : ""), { href: n[0], "aria-current": n[2] === page ? "page" : null }, n[1])); });
      const tools = LZ.el("div.topbar__tools",
        LZ.el("button.iconbtn#theme-toggle", { type: "button", onClick: LZ.theme.toggle }),
        LZ.el("a.iconbtn", { href: LZ.REPO, target: "_blank", rel: "noopener", "aria-label": "GitHub 仓库", title: "GitHub 仓库", html: '<svg viewBox="0 0 24 24"><path d="M9 19c-4.5 1.4-4.5-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6 0C6.5 2.8 5.5 3.1 5.5 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>' }));
      header.className = "topbar";
      header.appendChild(LZ.el("div.wrap.topbar__in",
        LZ.el("a.brand", { href: "index.html" }, LZ.el("span.seal", { "aria-hidden": "true" }, LZ.el("span", "老子")),
          LZ.el("span.brand__text", LZ.el("span.brand__zh", "老子语料知识图谱"), LZ.el("span.brand__en", "LaoziKG · Textual Knowledge Graph"))),
        nav, tools));
      LZ.theme.paint();
    }
    const footer = document.getElementById("site-footer");
    if (footer) {
      footer.className = "footer";
      footer.appendChild(LZ.el("div.wrap",
        LZ.el("div.footer__grid",
          LZ.el("div", LZ.el("h4", "LaoziKG"),
            LZ.el("p", "《老子》多版本溯源文本知识图谱：175 种历史文献与 1 种现代整理本的结构、候选异文、概念与注疏层，每条断言都追溯到其所出文献。"),
            LZ.el("p.small", "本站仅展示可公开发布的「公开结构版」；第三方转录文本已依版权审查撤除。所有 LLM 生成的标签均带有未审核标记。")),
          LZ.el("div", LZ.el("h4", "导航"), LZ.el("ul", NAV.map(function (n) { return LZ.el("li", LZ.el("a", { href: n[0] }, n[1])); }))),
          LZ.el("div", LZ.el("h4", "资源"), LZ.el("ul",
            LZ.el("li", LZ.el("a", { href: LZ.REPO, target: "_blank", rel: "noopener" }, "GitHub 仓库")),
            LZ.el("li", LZ.el("a", { href: "data.html#download" }, "下载公开结构版")),
            LZ.el("li", LZ.el("a", { href: "data.html#cite" }, "引用方式")),
            LZ.el("li", LZ.el("a", { href: "data.html#license" }, "许可与权利"))))),
        LZ.el("div.footer__bottom",
          LZ.el("span", "数据注释与代码 © 数据集作者 · 注释层 CC BY 4.0 · 代码 MIT · 底本转录版权待定"),
          LZ.el("span#footer-version", "v1.1.2-rc11 · 公开结构版"))));
    }
  };

  /* ---------- boot ---------------------------------------------------- */
  LZ.ready = function (fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); };
  LZ.ready(function () {
    LZ.chrome();
    LZ.load("summary").then(function (s) {
      LZ.setEras(s.era_order, s.era_span);
      if (s.site_profile === "full") {
        const rb = LZ.el("div.ribbon", { role: "note" }, LZ.el("div.wrap", LZ.el("b", "全量内部版"), " · 本构建包含版权尚未审查的第三方转录文本（" + s.counts.rights_not_reviewed + " / " + s.counts.rights_rows + " 个来源未清），仅限内部查阅，不得公开部署。"));
        const h = document.getElementById("site-header"); if (h) h.parentNode.insertBefore(rb, h.nextSibling);
      }
      const fv = document.getElementById("footer-version");
      if (fv) fv.textContent = "v" + s.version + " · " + (s.profile === "public_structural_release" ? "公开结构版" : s.profile) + " · 构建于 " + s.build_date;
      window.dispatchEvent(new CustomEvent("lz:summary", { detail: s }));
    }).catch(function (e) { console.error(e); });
  });
})();
