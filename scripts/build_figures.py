#!/usr/bin/env python3
"""Rebuild the six release figures from the website's data payloads.

    python scripts/build_figures.py                # reads docs/data, writes docs/assets/img/figures
    python scripts/build_figures.py --print-dpi 800

Every figure is drawn at its final print size (Nature Portfolio column widths:
89 mm single, 120-136 mm column-and-a-half, 183 mm double), in a Helvetica/Arial-class
sans-serif at 5-7 pt with 8 pt bold lowercase panel labels, using the Okabe-Ito
colour-blind-safe palette, no gridlines and no coloured text.  Each figure is written
as a vector PDF with live text, a print-resolution PNG and a web PNG.
"""
import argparse
import collections
import json
import math
import os
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, LogNorm, to_hex  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Circle, FancyArrowPatch, FancyBboxPatch, Rectangle  # noqa: E402

try:
    from pypinyin import lazy_pinyin
except ImportError:  # pragma: no cover - romanization fallback only
    lazy_pinyin = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MM = 1 / 25.4

# Okabe-Ito palette (the colour-blind-safe set recommended by the Nature figure guide)
OI = {"black": "#000000", "orange": "#E69F00", "sky": "#56B4E9", "green": "#009E73", "yellow": "#F0E442",
      "blue": "#0072B2", "verm": "#D55E00", "purple": "#CC79A7", "grey": "#999999"}
INK, INK2, INK3 = "#000000", "#4d4d4d", "#767676"
BAND = "#f2f2f2"
BLUES = LinearSegmentedColormap.from_list("lz_blues", ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"])

ERA_EN = {
    "春秋": "Spring and Autumn", "春秋战国": "Eastern Zhou", "战国": "Warring States", "西汉": "Western Han",
    "东汉": "Eastern Han", "三国": "Three Kingdoms", "吴": "Wu", "西晋": "Western Jin", "东晋": "Eastern Jin",
    "南北朝": "Northern and Southern dynasties", "南朝宋": "Liu Song", "南朝齐": "Southern Qi", "南朝陈": "Chen",
    "隋": "Sui", "唐": "Tang", "五代": "Five Dynasties", "宋": "Song", "北宋": "Northern Song", "南宋": "Southern Song",
    "元": "Yuan", "明": "Ming", "明末清初": "Ming–Qing transition", "清": "Qing", "清末民初": "Late Qing–early Republic",
    "民国": "Republic of China", "日本江户": "Edo Japan", "日本近代": "Modern Japan", "现代": "Modern",
    "不详": "Unknown", "其他": "Other",
}
LINEAGE_EN = {
    "明清注本系统": "Ming–Qing commentary editions", "敦煌吐鲁番写本系统": "Dunhuang–Turfan manuscripts",
    "道藏收录系统": "Daozang canon", "河上公注系统": "Heshanggong commentary", "王弼注系统": "Wang Bi commentary",
    "帛书系统": "Mawangdui silk manuscripts", "郭店楚简": "Guodian bamboo slips",
}
LINEAGE_SHORT = {"明清注本系统": "Ming–Qing", "敦煌吐鲁番写本系统": "Dunhuang–Turfan", "道藏收录系统": "Daozang",
                 "河上公注系统": "Heshanggong", "王弼注系统": "Wang Bi", "帛书系统": "Mawangdui", "郭店楚简": "Guodian"}
# pinyin and a short English gloss for the concepts that appear in the figures
CONCEPT_EN = {
    "道": ("dao", "the Way"), "德": ("de", "virtue"), "无": ("wu", "non-being"), "有": ("you", "being"),
    "圣人": ("shengren", "the sage"), "无为": ("wuwei", "non-action"), "天下": ("tianxia", "all under heaven"),
    "万物": ("wanwu", "the myriad things"), "天地": ("tiandi", "heaven and earth"), "自然": ("ziran", "self-so"),
    "无名": ("wuming", "the nameless"), "不争": ("buzheng", "non-contention"), "得一": ("deyi", "attaining the One"),
    "柔弱": ("rouruo", "softness and weakness"), "侯王": ("houwang", "lords and kings"),
    "为道": ("weidao", "pursuing the Way"), "知足": ("zhizu", "knowing contentment"), "复归": ("fugui", "returning"),
    "知常": ("zhichang", "knowing the constant"), "婴儿": ("ying'er", "the infant"), "抱一": ("baoyi", "embracing the One"),
    "自知": ("zizhi", "self-knowledge"), "知止": ("zhizhi", "knowing when to stop"), "玄德": ("xuande", "mysterious virtue"),
    "复命": ("fuming", "returning to destiny"), "玄牝": ("xuanpin", "the mysterious female"), "谷神": ("gushen", "valley spirit"),
    "名": ("ming", "name"), "玄": ("xuan", "the mysterious"), "一": ("yi", "the One"),
}
PROVIDER_EN = [
    ("Shidian Guji (识典古籍)", "Shidian Guji (Daozang-series transcriptions)"),
    ("Pelliot chinois", "Pelliot collection, BnF (Dunhuang)"),
    ("CADAL", "CADAL digital library"),
    ("Other / undetermined", "Other or undetermined series"),
    ("Stein collection", "Stein collection, British Library (Dunhuang)"),
    ("Dataset authors", "Dataset authors (derived resource)"),
]


def pinyin(name):
    if name in CONCEPT_EN:
        return CONCEPT_EN[name][0]
    if lazy_pinyin:
        return "".join(lazy_pinyin(name))
    return name


def gloss(name):
    return CONCEPT_EN.get(name, (None, ""))[1]


def fmt(n):
    return f"{int(n):,}"


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


# ------------------------------------------------------------------ style helpers
def apply_style():
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica", "Arial", "Nimbus Sans", "Liberation Sans", "DejaVu Sans"],
        "font.size": 6, "axes.titlesize": 7, "axes.labelsize": 7, "xtick.labelsize": 6, "ytick.labelsize": 6,
        "legend.fontsize": 6, "legend.title_fontsize": 6,
        "axes.linewidth": 0.8, "xtick.major.width": 0.8, "ytick.major.width": 0.8,
        "xtick.major.size": 2.2, "ytick.major.size": 2.2, "xtick.major.pad": 2, "ytick.major.pad": 2,
        "xtick.direction": "out", "ytick.direction": "out",
        "axes.spines.top": False, "axes.spines.right": False, "axes.grid": False,
        "lines.linewidth": 1.0, "patch.linewidth": 0.5,
        "pdf.fonttype": 42, "ps.fonttype": 42, "svg.fonttype": "none",
        "savefig.bbox": "standard", "savefig.pad_inches": 0,
        "axes.unicode_minus": True, "mathtext.default": "regular",
        "text.color": INK, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK, "axes.edgecolor": INK,
        "legend.frameon": False, "legend.handlelength": 1.3, "legend.handleheight": 0.8, "legend.handletextpad": 0.5,
        "legend.labelspacing": 0.35, "legend.borderpad": 0.2, "legend.borderaxespad": 0.2, "legend.columnspacing": 1.0,
        "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
        "axes.labelpad": 2.5,
    })


def fig_mm(w, h):
    fig = plt.figure(figsize=(w * MM, h * MM))
    fig.W, fig.H = w, h
    return fig


def ax_mm(fig, x, y, w, h, **kw):
    """Axes at (x, y) mm from the top-left corner, w x h mm."""
    return fig.add_axes([x / fig.W, 1 - (y + h) / fig.H, w / fig.W, h / fig.H], **kw)


def canvas(fig, label="canvas"):
    ax = fig.add_axes([0, 0, 1, 1], label=label)
    ax.set_xlim(0, fig.W)
    ax.set_ylim(fig.H, 0)
    ax.set_aspect("equal")
    ax.axis("off")
    return ax


def panel_label(fig, x, y, letter):
    fig.text(x / fig.W, 1 - y / fig.H, letter, fontsize=8, fontweight="bold", ha="left", va="top")


def thin_spines(ax):
    for s in ("left", "bottom"):
        ax.spines[s].set_linewidth(0.8)


def era_sort_key(order):
    return lambda e: (order.index(e) if e in order else 999, e)


def bbox_mm(fig, ax, artist):
    """Bounding box of a drawn artist in the mm coordinates of a canvas axes."""
    bb = artist.get_window_extent(renderer=fig.canvas.get_renderer())
    (x0, y0), (x1, y1) = ax.transData.inverted().transform([[bb.x0, bb.y0], [bb.x1, bb.y1]])
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


# ------------------------------------------------------------------ data
def load(data_dir):
    def j(*parts):
        with open(os.path.join(data_dir, *parts), encoding="utf-8") as f:
            return json.load(f)
    return {
        "summary": j("summary.json"), "witnesses": j("witnesses.json"), "concept_graph": j("concept_graph.json"),
        "concept_names": j("concept_names.json"), "core": j("kg", "core.json"),
        "commentary": j("kg", "commentary.json")["commentary"], "instances": j("kg", "instances.json")["instances"],
    }


# ------------------------------------------------------------------ Fig. 1  corpus composition
def fig1(D):
    S, W = D["summary"], D["witnesses"]
    order = S["era_order"]
    eras = [e for e in order if any(w["era"] == e for w in W)]
    groups = [
        ("Dao De Jing commentary", {"ddj_commentary"}, OI["blue"]),
        ("Dao De Jing text", {"canonical_ddj"}, OI["sky"]),
        ("Manuscript composite", {"manuscript_composite"}, OI["orange"]),
        ("Other Laozi-related text", {"related_laozi_text", "apocryphal_text", "fragment", "biography_text", "ritual_text"}, OI["grey"]),
    ]
    fig = fig_mm(183, 120)

    # ---- a: witness era x genre --------------------------------------------------
    ax = ax_mm(fig, 12, 6, 168, 38)
    thin_spines(ax)
    xs, xlabels = [], []
    x = 0.0
    for e in eras:
        if e == "不详":
            x += 0.7
        xs.append(x)
        xlabels.append(ERA_EN.get(e, e))
        x += 1
    bottoms = np.zeros(len(eras))
    for label, types, colour in groups:
        vals = np.array([sum(1 for w in W if w["era"] == e and w["work_type"] in types) for e in eras], float)
        ax.bar(xs, vals, 0.72, bottom=bottoms, color=colour, edgecolor="white", linewidth=0.4, label=label)
        bottoms += vals
    for xi, tot in zip(xs, bottoms):
        if tot >= 20:
            ax.text(xi, tot + 0.6, fmt(tot), ha="center", va="bottom", fontsize=6, color=INK2)
    ax.set_xticks(xs)
    ax.set_xticklabels(xlabels, rotation=45, ha="right", rotation_mode="anchor")
    ax.set_xlim(-0.7, x - 0.3)
    ax.set_ylim(0, 40)
    ax.set_yticks([0, 10, 20, 30, 40])
    ax.set_ylabel("Number of resources")
    ax.set_xlabel("Witness era (catalogue attribution of the edition)", labelpad=3)
    leg = ax.legend(loc="upper left", ncol=2, bbox_to_anchor=(0.005, 1.0), title="Work type")
    leg._legend_box.align = "left"
    panel_label(fig, 3, 4, "a")

    # ---- b: chapters aligned per witness, by lineage branch ---------------------
    lin_rows = [k for k, _ in S["lineage"]]  # already sorted by witness count
    ax = ax_mm(fig, 40, 80, 64, 30)
    thin_spines(ax)
    rng = np.random.default_rng(11)
    for i, lin in enumerate(lin_rows):
        vals = [w["record_aligned_chapters"] for w in W if w["lineage"] == lin]
        y = np.full(len(vals), i, float) + rng.uniform(-0.28, 0.28, len(vals)) * (1 if len(vals) > 1 else 0)
        ax.plot(vals, y, "o", ms=2.4, mfc=OI["blue"], mec="white", mew=0.3, alpha=0.85, zorder=3)
        if len(vals) >= 5:
            med = float(np.median(vals))
            ax.plot([med, med], [i - 0.42, i + 0.42], color=INK, lw=0.9, zorder=4, solid_capstyle="butt")
        ax.text(86, i, f"n = {len(vals)}", ha="left", va="center", fontsize=6, color=INK2, clip_on=False)
    ax.set_yticks(range(len(lin_rows)))
    ax.set_yticklabels([LINEAGE_EN[l] for l in lin_rows])
    ax.set_ylim(len(lin_rows) - 0.5, -0.5)
    ax.set_xlim(-2, 84)
    ax.set_xticks([0, 20, 40, 60, 81])
    ax.set_xlabel("Dao De Jing chapters aligned in the witness (of 81)")
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    ax.legend(handles=[Line2D([], [], color=INK, lw=0.9, label="median (branches with n ≥ 5)")],
              loc="lower right", bbox_to_anchor=(1.0, 0.0))
    panel_label(fig, 3, 78, "b")

    # ---- c: source collection -----------------------------------------------------
    ax = ax_mm(fig, 121, 81, 57, 29)
    buckets = S["rights"]["provider_buckets"]
    rows = []
    for key, label in PROVIDER_EN:
        val = next((v for k, v in buckets.items() if k.startswith(key)), 0)
        rows.append((label, val))
    rows.sort(key=lambda r: -r[1])
    for i, (label, val) in enumerate(rows):
        ax.barh(i, val, height=0.32, color=OI["blue"], align="center")
        ax.text(0, i - 0.22, label, ha="left", va="bottom", fontsize=6, color=INK)
        ax.text(val + 1.2, i, fmt(val), ha="left", va="center", fontsize=6, color=INK2)
    ax.set_ylim(len(rows) - 0.5, -0.6)
    ax.set_xlim(0, 85)
    ax.set_xticks([0, 25, 50, 75])
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Number of resources")
    panel_label(fig, 113, 78, "c")
    return fig


# ------------------------------------------------------------------ Fig. 2  concept co-occurrence
def _radius(occ, occ_max):
    return 1.1 + 3.3 * math.sqrt(occ / occ_max)  # mm


def fig2(D, node_min=400, edge_min=120):
    CG = D["concept_graph"]
    nodes = [n for n in CG["nodes"] if len(n["name"]) >= 2 and n["high"] >= node_min]
    ids = {n["id"] for n in nodes}
    edges = [(a, b, w) for a, b, w in CG["cooccurrence_edges"] if a in ids and b in ids and w >= edge_min]
    connected = {a for a, _, _ in edges} | {b for _, b, _ in edges}
    isolated = [n for n in nodes if n["id"] not in connected]
    nodes = [n for n in nodes if n["id"] in connected]
    nodes.sort(key=lambda n: -n["high"])
    idx = {n["id"]: i for i, n in enumerate(nodes)}
    wmax = max(w for _, _, w in edges)
    occ_max = max(n["high"] for n in nodes)
    rad = np.array([_radius(n["high"], occ_max) for n in nodes])

    G = nx.Graph()
    G.add_nodes_from(n["id"] for n in nodes)
    for a, b, w in edges:
        G.add_edge(a, b, weight=math.sqrt(w / wmax), dist=1.0 / math.sqrt(w / wmax))
    pos = nx.kamada_kawai_layout(G, weight="dist", scale=1.0)
    P = np.array([pos[n["id"]] for n in nodes])
    # fit the disc layout to the drawing area (mm), then separate overlapping discs
    box = (7.0, 87.0, 7.0, 93.0)  # x0, x1, y0, y1
    P -= P.mean(axis=0)
    span = np.abs(P).max(axis=0)
    span[span == 0] = 1
    P = P / span
    P = np.column_stack([(box[0] + box[1]) / 2 + P[:, 0] * ((box[1] - box[0]) / 2 - rad.max()),
                         (box[2] + box[3]) / 2 + P[:, 1] * ((box[3] - box[2]) / 2 - rad.max())])
    for _ in range(600):
        moved = False
        for i in range(len(P)):
            for j in range(i + 1, len(P)):
                d = P[j] - P[i]
                dist = float(np.hypot(*d))
                need = rad[i] + rad[j] + 1.6
                if dist < need:
                    unit = d / dist if dist > 1e-6 else np.array([1.0, 0.0])
                    push = (need - dist) / 2 * unit
                    P[i] -= push
                    P[j] += push
                    moved = True
        if not moved:
            break

    fig = fig_mm(120, 100)
    ax = canvas(fig)
    segs = [[P[idx[a]], P[idx[b]]] for a, b, _ in edges]
    lw = [0.3 + 1.9 * (w - edge_min) / (wmax - edge_min) for _, _, w in edges]
    ax.add_collection(LineCollection(segs, colors=OI["grey"], linewidths=lw, alpha=0.6, zorder=1, capstyle="round"))
    atomic = [n["stratum"] == "atomic" for n in nodes]
    for i, n in enumerate(nodes):
        ax.add_patch(Circle(P[i], rad[i], facecolor=OI["blue"] if atomic[i] else "white", edgecolor=OI["blue"],
                            linewidth=0.8, zorder=3))

    # labels: inside the disc when the measured text fits, otherwise outside at the first collision-free angle
    fig.canvas.draw()
    placed = []
    centre = P.mean(axis=0)

    def collides(b):
        x0, y0, x1, y1 = b
        for q in placed:
            if not (x1 < q[0] or q[2] < x0 or y1 < q[1] or q[3] < y0):
                return True
        for k in range(len(P)):
            px = min(max(P[k][0], x0), x1)
            py = min(max(P[k][1], y0), y1)
            if math.hypot(px - P[k][0], py - P[k][1]) < rad[k] + 0.25:
                return True
        return False

    for i in range(len(nodes)):
        label = pinyin(nodes[i]["name"])
        t = ax.text(P[i][0], P[i][1], label, ha="center", va="center", fontsize=6,
                    color="white" if atomic[i] else INK, zorder=4)
        b = bbox_mm(fig, ax, t)
        if (b[2] - b[0]) <= 2 * rad[i] - 0.7 and (b[3] - b[1]) <= 2 * rad[i] - 0.4:
            placed.append(b)
            continue
        t.remove()
        v = P[i] - centre
        a0 = math.atan2(v[1], v[0])
        done = False
        for da in (0, 35, -35, 70, -70, 105, -105, 140, -140, 180):
            a = a0 + math.radians(da)
            ux, uy = math.cos(a), math.sin(a)
            ha = "left" if ux > 0.3 else ("right" if ux < -0.3 else "center")
            va = "center" if abs(ux) > 0.3 else ("top" if uy > 0 else "bottom")
            px, py = P[i][0] + ux * (rad[i] + 0.7), P[i][1] + uy * (rad[i] + 0.7)
            t = ax.text(px, py, label, ha=ha, va=va, fontsize=6, color=INK, zorder=4)
            b = bbox_mm(fig, ax, t)
            if not collides(b) and b[0] > 1 and b[2] < 92 and b[1] > 1 and b[3] < 99:
                placed.append(b)
                done = True
                break
            t.remove()
        if not done:
            ux, uy = math.cos(a0), math.sin(a0)
            t = ax.text(P[i][0] + ux * (rad[i] + 0.7), P[i][1] + uy * (rad[i] + 0.7), label, ha="center", va="center",
                        fontsize=6, color=INK, zorder=4)
            placed.append(bbox_mm(fig, ax, t))

    # legend column
    lx = 95.0
    ax.text(lx, 10, "Occurrences", fontsize=6, fontweight="bold", ha="left", va="center")
    ax.text(lx, 13.5, "high- and medium-specificity\nmatches, default analysis set", fontsize=5.5, color=INK2, ha="left", va="top", linespacing=1.15)
    y = 24
    for val in (500, 2000, 10000):
        r = _radius(val, occ_max)
        ax.add_patch(Circle((lx + 4.5, y), r, facecolor="none", edgecolor=INK, linewidth=0.6))
        ax.text(lx + 10.5, y, fmt(val), fontsize=6, ha="left", va="center")
        y += 2 * r + 2.6
    y += 2
    ax.text(lx, y, "Concept stratum", fontsize=6, fontweight="bold", ha="left", va="center")
    y += 4
    ax.add_patch(Circle((lx + 2, y), 1.5, facecolor=OI["blue"], edgecolor=OI["blue"], linewidth=0.8))
    ax.text(lx + 5.5, y, "atomic concept", fontsize=6, ha="left", va="center")
    y += 4.2
    ax.add_patch(Circle((lx + 2, y), 1.5, facecolor="white", edgecolor=OI["blue"], linewidth=0.8))
    ax.text(lx + 5.5, y, "composite (practice,\nmetaphor)", fontsize=6, ha="left", va="center", linespacing=1.1)
    y += 8
    ax.text(lx, y, "Chapter instances\ncontaining both", fontsize=6, fontweight="bold", ha="left", va="center", linespacing=1.1)
    y += 6
    for val in (edge_min, 500, 1000):
        w = 0.3 + 1.9 * (val - edge_min) / (wmax - edge_min)
        ax.add_line(Line2D([lx, lx + 7], [y, y], color=OI["grey"], lw=w, alpha=0.9, solid_capstyle="round"))
        ax.text(lx + 10.5, y, fmt(val), fontsize=6, ha="left", va="center")
        y += 4
    a_max, b_max, _ = max(edges, key=lambda e: e[2])
    fig.meta = {"nodes": len(nodes), "edges": len(edges), "isolated": [n["name"] for n in isolated],
                "node_min": node_min, "edge_min": edge_min, "wmax": wmax,
                "wmax_pair": f"{pinyin(nodes[idx[a_max]]['name'])}–{pinyin(nodes[idx[b_max]]['name'])}",
                "labels": [n["name"] for n in nodes]}
    return fig


# ------------------------------------------------------------------ Fig. 3  commentator era x witness era
def fig3(D):
    S = D["summary"]
    order = S["era_order"]
    key = era_sort_key(order)
    rows = [r for r in D["commentary"].values() if r[6] and r[7]]
    M = collections.Counter((r[6], r[7]) for r in rows)
    c_eras = sorted({a for a, _ in M}, key=key)
    w_eras = sorted({b for _, b in M}, key=key)
    if "其他" in w_eras:
        w_eras.remove("其他")
        w_eras.append("其他")
    known = [(a, b) for a, b in M.elements() if a != "不详" and b not in ("不详", "其他")]
    n_known = len(known)
    n_same = sum(1 for a, b in known if a == b)

    cell, gap = 5.0, 1.6
    fig = fig_mm(136, 96)
    ax = canvas(fig)
    x0, y0 = 33.0, 4.0
    xpos, x = {}, x0
    for e in w_eras:
        if e == "其他":
            x += gap
        xpos[e] = x
        x += cell
    xend = x
    ypos, y = {}, y0
    for e in c_eras:
        if e == "不详":
            y += gap
        ypos[e] = y
        y += cell
    yend = y
    vmax = max(M.values())
    norm = LogNorm(vmin=1, vmax=vmax)
    for e in c_eras:
        for f in w_eras:
            ax.add_patch(Rectangle((xpos[f], ypos[e]), cell, cell, facecolor="white", edgecolor="#d9d9d9", linewidth=0.3, zorder=1))
    for (a, b), v in M.items():
        colour = BLUES(norm(v))
        ax.add_patch(Rectangle((xpos[b], ypos[a]), cell, cell, facecolor=colour, edgecolor="white", linewidth=0.4, zorder=2))
        ax.text(xpos[b] + cell / 2, ypos[a] + cell / 2, str(v), ha="center", va="center", fontsize=6,
                color="white" if norm(v) > 0.62 else INK, zorder=4)
    for e in c_eras:
        if e in xpos and e != "不详":
            ax.add_patch(Rectangle((xpos[e], ypos[e]), cell, cell, facecolor="none", edgecolor=OI["verm"], linewidth=0.9, zorder=3))
    for e in c_eras:
        ax.text(x0 - 1.4, ypos[e] + cell / 2, ERA_EN.get(e, e), ha="right", va="center", fontsize=6)
        tot = sum(v for (a, _), v in M.items() if a == e)
        ax.text(xend + 1.4, ypos[e] + cell / 2, fmt(tot), ha="left", va="center", fontsize=6, color=INK2)
    ax.text(xend + 1.4, y0 - 1.6, "n", ha="left", va="bottom", fontsize=6, color=INK2, style="italic")
    for e in w_eras:
        ax.text(xpos[e] + cell / 2 + 0.4, yend + 1.6, ERA_EN.get(e, e), ha="right", va="top", fontsize=6, rotation=45, rotation_mode="anchor")
    ax.text(x0 + (xend - x0) / 2, yend + 17.5, "Witness era (edition the gloss was read from)", ha="center", va="top", fontsize=7)
    ax.text(3.5, y0 + (yend - y0) / 2, "Commentator era (the annotator's own lifetime)", ha="center", va="center", fontsize=7, rotation=90)
    cax = ax_mm(fig, 125, 8, 3.2, 30)
    cb = mpl.colorbar.ColorbarBase(cax, cmap=BLUES, norm=norm, orientation="vertical", ticks=[1, 10, 100])
    cb.ax.set_yticklabels(["1", "10", "100"])
    cb.ax.tick_params(labelsize=6, width=0.6, length=2, pad=1.5)
    cb.outline.set_linewidth(0.6)
    cb.ax.minorticks_off()
    ax.text(123.5, 5.8, "Glosses", fontsize=6, ha="left", va="bottom")
    ky = 46
    ax.add_patch(Rectangle((123.5, ky), 3.2, 3.2, facecolor="none", edgecolor=OI["verm"], linewidth=0.9))
    ax.text(119.0, ky + 4.8, "commentator era\n= witness era", fontsize=6, ha="left", va="top", linespacing=1.15)
    fig.meta = {"rows": len(rows), "known": n_known, "same": n_same, "differ": n_known - n_same,
                "pct_differ": round(100 * (n_known - n_same) / n_known, 1),
                "unknown_commentator": sum(v for (a, _), v in M.items() if a == "不详"),
                "other_witness": sum(v for (_, b), v in M.items() if b == "其他")}
    return fig


# ------------------------------------------------------------------ Fig. 4  concept share by commentator era
def fig4(D, min_glosses=25, n_concepts=6):
    S, CN = D["summary"], D["concept_names"]
    order = S["era_order"]
    rows = [r for r in D["commentary"].values() if r[6] and r[6] != "不详"]
    n_era = collections.Counter(r[6] for r in rows)
    eras = [e for e in order if n_era.get(e, 0) >= min_glosses]
    by = collections.defaultdict(collections.Counter)
    for r in rows:
        by[r[6]][r[3]] += 1
    top = [c for c, _ in collections.Counter(r[3] for r in D["commentary"].values()).most_common(n_concepts)]
    share = {c: np.array([100 * by[e][c] / n_era[e] for e in eras]) for c in top}

    fig = fig_mm(183, 98)
    W_, H_, X0, Y0, GX, GY = 50, 27, 14, 6, 8, 8
    ymax = 36
    xs = np.arange(len(eras))
    for k, c in enumerate(top):
        r_, c_ = divmod(k, 3)
        ax_x, ax_y = X0 + c_ * (W_ + GX), Y0 + r_ * (H_ + GY)
        ax = ax_mm(fig, ax_x, ax_y, W_, H_)
        thin_spines(ax)
        for o in top:
            if o != c:
                ax.plot(xs, share[o], color="#bfbfbf", lw=0.6, zorder=1)
        lo, hi = zip(*[wilson(by[e][c], n_era[e]) for e in eras])
        ax.fill_between(xs, np.array(lo) * 100, np.array(hi) * 100, color=OI["blue"], alpha=0.14, lw=0, zorder=2)
        ax.plot(xs, share[c], color=OI["blue"], lw=1.1, marker="o", ms=2.6, mec="white", mew=0.4, zorder=3)
        name = CN[c][0]
        t = ax.text(0.03, 0.96, pinyin(name), transform=ax.transAxes, fontsize=7, fontweight="bold", ha="left", va="top")
        fig.canvas.draw()
        bb = t.get_window_extent(renderer=fig.canvas.get_renderer())
        x_end = ax.transAxes.inverted().transform((bb.x1, bb.y0))[0]
        ax.text(x_end + 0.025, 0.955, gloss(name), transform=ax.transAxes, fontsize=6, color=INK2, ha="left", va="top")
        ax.text(0.98, 0.96, f"{fmt(sum(by[e][c] for e in eras))} glosses", transform=ax.transAxes, fontsize=6, color=INK2, ha="right", va="top")
        ax.set_xlim(-0.4, len(eras) - 0.6)
        ax.set_ylim(0, ymax)
        ax.set_yticks([0, 10, 20, 30])
        ax.set_xticks(xs)
        if r_ == 1:
            ax.set_xticklabels([ERA_EN.get(e, e) for e in eras], rotation=45, ha="right", rotation_mode="anchor")
        else:
            ax.set_xticklabels([])
        if c_ != 0:
            ax.set_yticklabels([])
        panel_label(fig, ax_x - 4.5, ax_y - 0.8, "abcdef"[k])
    fig.text(4.5 / 183, 1 - (Y0 + H_ + GY / 2) / 98, "Share of the era's glosses (%)", rotation=90, ha="center", va="center", fontsize=7)
    fig.text(0.5, 1 - 86.5 / 98, "Commentator era (the annotator's own lifetime), chronological", ha="center", va="top", fontsize=7)
    handles = [Line2D([], [], color=OI["blue"], lw=1.1, marker="o", ms=2.6, mec="white", mew=0.4, label="focal concept"),
               Rectangle((0, 0), 1, 1, facecolor=OI["blue"], alpha=0.14, lw=0, label="95% Wilson interval"),
               Line2D([], [], color="#bfbfbf", lw=0.6, label="the other five concepts")]
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, 1 - 91.5 / 98), ncol=3, frameon=False)
    fig.meta = {"eras": [(ERA_EN.get(e, e), n_era[e]) for e in eras], "concepts": [(pinyin(CN[c][0]), CN[c][0]) for c in top],
                "excluded_unknown": sum(1 for r in D["commentary"].values() if not r[6] or r[6] == "不详"),
                "excluded_small_eras": [(ERA_EN.get(e, e), n) for e, n in n_era.items() if n < min_glosses]}
    return fig


# ------------------------------------------------------------------ Fig. 5  architecture
def fig5(D):
    c = D["summary"]["counts"]
    layers = [
        ("Source layer", "Bibliographic record", [
            ("Version", c["resources"], ["witness era, work type,", "resource class, rights ledger"]),
            ("Person", c["persons"], [f"historical era · {c['aliases']} aliases", f"{c['authorship_edges']} authorship edges"]),
        ]),
        ("Text layer", "Deterministic from source", [
            ("Chapter instance", c["chapter_instances"], [f"{fmt(c['default_include_instances'])} in the default analysis set",
                                                          f"{c['recovered_unreviewed_instances']} auto-recovered (gated) · {c['unaligned_instances']} unaligned"]),
            ("Sentence", c["sentences"], ["character offsets and counts", "segmented within each witness"]),
        ]),
        ("Derived layer", "Machine-detected, unreviewed", [
            ("Variant", c["variants"], ["candidate events against the", "Wang Bi reference · detection score"]),
            ("Concept mention", c["mention_edges_default"], ["edges in the default set", "specificity tiers: high, medium, low"]),
            ("Commentary", c["commentary"], ["glosses with text provenance", f"{fmt(c['citable_quotes'])} verbatim quotes citable"]),
        ]),
        ("Interpretive layer", "LLM-generated, unreviewed", [
            ("Concept", c["concepts"], [f"{c['seed_concepts']} seed (hand-authored)", f"+ {c['llm_expanded_concepts']} LLM-expanded"]),
            ("Concept relation", c["concept_relations"], ["typed edges between concepts", "4 relation categories"]),
            ("Candidate claim", c["candidate_claims"], ["outside the data release", "never cite"]),
        ]),
    ]
    fig = fig_mm(183, 102)
    ax = canvas(fig)
    bx0, bx1 = 46.0, 180.0
    band_h, band_gap, top = 17.0, 5.0, 4.0
    for li, (name, how, boxes) in enumerate(layers):
        y = top + li * (band_h + band_gap)
        ax.add_patch(Rectangle((bx0, y), bx1 - bx0, band_h, facecolor=BAND, edgecolor="none", zorder=0))
        ax.text(4, y + 3.2, name, fontsize=7, fontweight="bold", ha="left", va="center")
        ax.text(4, y + 7.6, how, fontsize=6, color=INK2, ha="left", va="center")
        n = len(boxes)
        gap = 4.0
        bw = (bx1 - bx0 - 2 * 3.0 - (n - 1) * gap) / n
        for bi, (label, count, lines) in enumerate(boxes):
            x = bx0 + 3.0 + bi * (bw + gap)
            ax.add_patch(FancyBboxPatch((x, y + 2.2), bw, band_h - 4.4, boxstyle="round,pad=0,rounding_size=1.0",
                                        facecolor="white", edgecolor=OI["blue"], linewidth=0.8, zorder=2))
            ax.text(x + bw / 2, y + 5.6, f"{label}  {fmt(count)}", fontsize=7, fontweight="bold", ha="center", va="center", zorder=3)
            for k, line in enumerate(lines):
                ax.text(x + bw / 2, y + 9.4 + k * 2.9, line, fontsize=6, color=INK2, ha="center", va="center", zorder=3)
        if li < len(layers) - 1:
            xm = (bx0 + bx1) / 2
            ax.add_patch(FancyArrowPatch((xm, y + band_h + 0.4), (xm, y + band_h + band_gap - 0.4), arrowstyle="-|>",
                                         mutation_scale=8, linewidth=1.0, color=OI["blue"], zorder=2))
    y = top + 4 * (band_h + band_gap) - band_gap + 3.0
    note = ("Provenance is recorded at every step: each assertion carries the witness it came from and its own review flag. "
            f"The {c['recovered_unreviewed_instances']} auto-recovered chapter instances and the {c['unaligned_instances']} unaligned units "
            "stay outside the default analysis set until an expert confirms them, and candidate claims sit outside the data release, "
            "so a default query returns deterministic structure plus layers whose machine origin is declared.")
    ax.text(4, y, "\n".join(textwrap.wrap(note, 150)), fontsize=6, color=INK2, ha="left", va="top", linespacing=1.3)
    return fig


# ------------------------------------------------------------------ Fig. 6  lineage branches
def fig6(D):
    core, inst = D["core"], D["instances"]
    V = core["versions"]
    lin_inst = collections.defaultdict(collections.Counter)
    lin_w = collections.Counter(v["l"] for v in V.values())
    for r in inst.values():
        lin_inst[V[r[0]]["l"]][r[6]] += 1
    branches = sorted(lin_inst, key=lambda l: -sum(lin_inst[l].values()))
    statuses = [(0, "aligned, in default analysis set", OI["blue"]), (1, "auto-recovered, gated out", OI["orange"]), (2, "unaligned", OI["grey"])]

    fig = fig_mm(183, 68)
    ax = ax_mm(fig, 44, 6, 78, 42)
    thin_spines(ax)
    ys = np.arange(len(branches))
    left = np.zeros(len(branches))
    for code, label, colour in statuses:
        vals = np.array([lin_inst[b].get(code, 0) for b in branches], float)
        ax.barh(ys, vals, 0.62, left=left, color=colour, edgecolor="white", linewidth=0.4, label=label)
        left += vals
    for i, b in enumerate(branches):
        ax.text(left[i] + 30, i, f"{fmt(left[i])} instances · {lin_w[b]} witness{'es' if lin_w[b] != 1 else ''}",
                ha="left", va="center", fontsize=6, color=INK2)
    ax.set_yticks(ys)
    ax.set_yticklabels([LINEAGE_EN[b] for b in branches])
    ax.set_ylim(len(branches) - 0.4, -0.6)
    ax.set_xlim(0, 2700)
    ax.set_xticks([0, 500, 1000, 1500, 2000, 2500])
    ax.set_xticklabels(["0", "500", "1,000", "1,500", "2,000", "2,500"])
    ax.set_xlabel("Chapter instances")
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    ax.legend(loc="lower right", bbox_to_anchor=(1.0, 0.0), title="Alignment status")
    panel_label(fig, 3, 4, "a")

    # b: same-work assertions between branches
    pas = core["pas"]
    keys = ["明清注本系统", "敦煌吐鲁番写本系统", "道藏收录系统"]
    pm = collections.Counter()
    for p in pas.values():
        a, b = V[p["a"]]["l"], V[p["b"]]["l"]
        i, j = sorted((keys.index(a), keys.index(b)))
        pm[(i, j)] += 1
    cell = 10.0
    ax = canvas(fig, label="b")
    x0, y0 = 147.0, 9.0
    vmax = max(pm.values())
    for i in range(3):
        for j in range(3):
            if j < i:
                continue
            v = pm.get((i, j), 0)
            colour = BLUES(0.15 + 0.85 * v / vmax) if v else "white"
            ax.add_patch(Rectangle((x0 + j * cell, y0 + i * cell), cell, cell, facecolor=colour, edgecolor="#d9d9d9", linewidth=0.4))
            ax.text(x0 + j * cell + cell / 2, y0 + i * cell + cell / 2, str(v), ha="center", va="center", fontsize=6,
                    color="white" if v / vmax > 0.6 else INK)
    for i, k in enumerate(keys):
        ax.text(x0 - 1.5, y0 + i * cell + cell / 2, LINEAGE_SHORT[k], ha="right", va="center", fontsize=6)
        ax.text(x0 + i * cell + cell / 2 + 0.4, y0 + 3 * cell + 1.5, LINEAGE_SHORT[k], ha="right", va="top", fontsize=6, rotation=45, rotation_mode="anchor")
    ax.text(x0 + 1.5 * cell, y0 - 2.2, f"Same-work assertions ({sum(pm.values())})", ha="center", va="bottom", fontsize=7)
    ax.text(128, y0 + 3 * cell + 15.5, "SAME_WORK_EDITION only: one work in two\ncatalogue records, each evidence-backed.\nNo textual descent is asserted.",
            ha="left", va="top", fontsize=6, color=INK2, linespacing=1.25)
    panel_label(fig, 128, 4, "b")
    fig.meta = {"pairs": {f"{LINEAGE_SHORT[keys[i]]} × {LINEAGE_SHORT[keys[j]]}": v for (i, j), v in pm.items()}}
    return fig


# ------------------------------------------------------------------ legends (Nature style: title sentence, panels, statistics)
def legend(name, meta, D):
    c = D["summary"]["counts"]
    if name.startswith("fig1"):
        no_era = sum(1 for w in D["witnesses"] if w["era"] == "不详")
        return ("Composition of the LaoziKG corpus.",
                f"a, The {c['resources']} resources by witness era (the era attributed to the edition by its catalogue record, "
                f"in chronological order; {no_era} records carry no era) and work type. The four work-type classes group the "
                "catalogue's eight labels (other Laozi-related text: related, apocryphal, biographical and ritual texts, and fragments); "
                "bars are annotated where an era holds 20 or more resources. b, Number of Dao De Jing chapters aligned in each "
                "witness (one dot per resource, of 81 chapters) by lineage branch; vertical bars mark the branch median where "
                "n ≥ 5. Resources at 0 are related texts without chapter structure or witnesses whose units could not be aligned. "
                f"c, Holding collection or transcription provider of the resources. n = {c['resources']} resources throughout. "
                "Eastern Zhou denotes records catalogued as 'Spring and Autumn–Warring States'.")
    if name.startswith("fig2"):
        glosses = "; ".join(f"{pinyin(n)}, {gloss(n)}" for n in meta["labels"])
        iso = ", ".join(f"{pinyin(n)} ({gloss(n)})" for n in meta["isolated"])
        return ("Concept co-occurrence across chapter instances.",
                f"Nodes are the {meta['nodes']} multi-character concepts with at least {meta['node_min']} high- or medium-specificity "
                f"occurrences in the default analysis set ({fmt(c['default_include_instances'])} aligned chapter instances); node area "
                "scales with occurrences. Filled discs are atomic concepts; open discs are composite entries (practices and metaphors). "
                f"An edge joins two concepts that co-occur in at least {meta['edge_min']} chapter instances ({meta['edges']} edges); edge "
                f"width scales with the number of shared instances (maximum {fmt(meta['wmax'])}, {meta['wmax_pair']}). "
                + ((f"One qualifying concept, {iso}, has no edge at this threshold and is omitted. " if len(meta["isolated"]) == 1 else
                    f"{len(meta['isolated'])} qualifying concepts ({iso}) have no edge at this threshold and are omitted. ") if meta["isolated"] else "")
                + f"Labels are pinyin romanizations; glosses: {glosses}. Layout: Kamada–Kawai.")
    if name.startswith("fig3"):
        no_era = c["commentary"] - meta["rows"]
        return ("Commentator era versus witness era of commentary glosses.",
                f"Number of commentary records by the commentator's own era (rows) and the era of the edition the gloss was read "
                f"from (columns), for the {fmt(meta['rows'])} records with both fields present (of {fmt(c['commentary'])}; the remaining "
                f"{fmt(no_era)}, chiefly the authors' modern compilation, carry no commentator era). Colour scale is logarithmic. "
                f"Vermillion outlines mark cells where the two eras coincide. Among the {fmt(meta['known'])} records whose two eras are "
                f"both specific periods (excluding the Unknown row and the Other column), {fmt(meta['differ'])} ({meta['pct_differ']}%) "
                "were read from an edition of an era other than the commentator's own. n gives row totals. Eastern Zhou denotes "
                "editions catalogued as 'Spring and Autumn–Warring States'.")
    if name.startswith("fig4"):
        panels = "; ".join(f"{l}, {p}, {gloss(n)}" for l, (p, n) in zip("abcdef", meta["concepts"]))
        eras = ", ".join(f"{e} (n = {n})" if i == 0 else f"{e} ({n})" for i, (e, n) in enumerate(meta["eras"]))
        small = "; ".join(f"the {e} era ({n} records)" for e, n in meta["excluded_small_eras"])
        return ("Which concepts commentators glossed, by their own era.",
                f"Share of each era's commentary records that gloss the six most-glossed concepts ({panels}) for the "
                f"{len(meta['eras'])} commentator eras with at least 25 records: {eras}. The denominator is all records by commentators "
                "of that era. Blue line, focal concept; shaded band, 95% Wilson score interval; grey lines, the other five concepts. "
                f"Excluded: {fmt(meta['excluded_unknown'])} records whose commentator era is unknown or absent"
                + (f", and {small}." if small else "."))
    if name.startswith("fig5"):
        return ("LaoziKG architecture: four layers, each gated by how it was produced.",
                f"Node types with record counts (v{D['summary']['version']}). The source layer holds bibliographic records; the text "
                "layer is derived deterministically from them; the derived layer is machine-detected and unreviewed; the interpretive "
                "layer is generated with a large language model and unreviewed. Every assertion carries the witness it came from and a "
                f"review flag. The {c['recovered_unreviewed_instances']} auto-recovered chapter instances and {c['unaligned_instances']} "
                "unaligned units are excluded from the default analysis set until confirmed by an expert; candidate scholarly claims are "
                "kept outside the data release.")
    if name.startswith("fig6"):
        return ("Lineage branches and alignment status.",
                f"a, Chapter instances per lineage branch (all {fmt(c['chapter_instances'])} instances from {c['resources']} witnesses), "
                f"coloured by alignment status: aligned and included in the default analysis set ({fmt(c['default_include_instances'])}), "
                f"auto-recovered and gated out pending expert review ({c['recovered_unreviewed_instances']}), unaligned "
                f"({c['unaligned_instances']}). b, The {c['provenance_assertions']} SAME_WORK_EDITION provenance assertions between "
                "witnesses, aggregated by branch pair; each records one work catalogued under two records and is evidence-backed. "
                "No textual-descent relationship is asserted anywhere in the dataset.")
    return (name, "")


# ------------------------------------------------------------------ QC and export
def qc(fig, name, width_mm, allowed_text=(INK, INK2, INK3, "#ffffff")):
    issues, warnings = [], []
    w, h = fig.get_size_inches() * 25.4
    if abs(w - width_mm) > 0.05:
        issues.append(f"width {w:.2f} mm != {width_mm} mm")
    if h > 170:
        issues.append(f"height {h:.1f} mm > 170 mm")
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    page = fig.bbox
    fonts, boxes = set(), []
    for t in fig.findobj(mpl.text.Text):
        if not t.get_text().strip() or not t.get_visible():
            continue
        fs = t.get_fontsize()
        if fs < 5 or fs > 8:
            issues.append(f"text {t.get_text()[:24]!r} is {fs} pt")
        col = to_hex(t.get_color()).lower()
        if col not in [a.lower() for a in allowed_text]:
            issues.append(f"coloured text {t.get_text()[:24]!r} {col}")
        fonts.add(t.get_fontname())
        bb = t.get_window_extent(renderer=renderer)
        tol = 0.3 / 25.4 * fig.dpi
        if bb.x0 < page.x0 - tol or bb.x1 > page.x1 + tol or bb.y0 < page.y0 - tol or bb.y1 > page.y1 + tol:
            issues.append(f"text {t.get_text()[:30]!r} runs off the page")
        if t.get_rotation() == 0:  # rotated tick labels have overlapping axis-aligned boxes by construction
            boxes.append((t.get_text()[:24], bb))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i][1], boxes[j][1]
            if a.overlaps(b):
                ix = min(a.x1, b.x1) - max(a.x0, b.x0)
                iy = min(a.y1, b.y1) - max(a.y0, b.y0)
                if ix > 0.4 / 25.4 * fig.dpi and iy > 0.4 / 25.4 * fig.dpi:
                    warnings.append(f"overlap {boxes[i][0]!r} / {boxes[j][0]!r}")
    return {"figure": name, "size_mm": (round(w, 2), round(h, 2)), "fonts": sorted(fonts), "issues": issues, "warnings": warnings}


def export(fig, name, out, web_dpi, print_dpi):
    os.makedirs(out, exist_ok=True)
    fig.savefig(os.path.join(out, name + ".pdf"))
    fig.savefig(os.path.join(out, f"{name}_{print_dpi}dpi.png"), dpi=print_dpi)
    fig.savefig(os.path.join(out, name + ".png"), dpi=web_dpi)


FIGURES = [
    ("fig1_corpus_composition", fig1, 183),
    ("fig2_concept_cooccurrence", fig2, 120),
    ("fig3_commentator_vs_witness_era", fig3, 136),
    ("fig4_concept_share_by_era", fig4, 183),
    ("fig5_architecture", fig5, 183),
    ("fig6_lineage_alignment", fig6, 183),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.path.join(ROOT, "docs", "data"))
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "assets", "img", "figures"))
    ap.add_argument("--web-dpi", type=int, default=300)
    ap.add_argument("--print-dpi", type=int, default=800)
    ap.add_argument("--only", nargs="*", help="figure name prefixes to build, e.g. fig2")
    args = ap.parse_args()

    apply_style()
    D = load(args.data)
    report, catalogue = [], []
    for k, (name, builder, width) in enumerate(FIGURES, 1):
        if args.only and not any(name.startswith(p) for p in args.only):
            continue
        fig = builder(D)
        r = qc(fig, name, width)
        r["meta"] = getattr(fig, "meta", {})
        export(fig, name, args.out, args.web_dpi, args.print_dpi)
        plt.close(fig)
        report.append(r)
        title, text = legend(name, r["meta"], D)
        catalogue.append({"id": name, "number": k, "file": name, "title": title, "legend": text,
                          "width_mm": r["size_mm"][0], "height_mm": r["size_mm"][1], "print_dpi": args.print_dpi,
                          "web_dpi": args.web_dpi, "legend_words": len((title + " " + text).split())})
        status = "OK" if not r["issues"] else f"{len(r['issues'])} issue(s)"
        print(f"{name}: {r['size_mm'][0]} x {r['size_mm'][1]} mm  fonts={r['fonts']}  legend {catalogue[-1]['legend_words']} words  {status}")
        for i in r["issues"]:
            print("   - ISSUE:", i)
        for i in r["warnings"]:
            print("   - warn:", i)
        if r["meta"]:
            print("   meta:", json.dumps(r["meta"], ensure_ascii=False))
    with open(os.path.join(args.out, "build_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    if not args.only:
        with open(os.path.join(args.data, "figures.json"), "w", encoding="utf-8") as f:
            json.dump(catalogue, f, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(args.out, "LEGENDS.md"), "w", encoding="utf-8") as f:
            f.write("# Figure legends (LaoziKG v%s)\n\nGenerated by `scripts/build_figures.py`; do not edit by hand.\n\n" % D["summary"]["version"])
            for e in catalogue:
                f.write(f"**Fig. {e['number']} | {e['title']}** {e['legend']}\n\n"
                        f"*{e['width_mm']} × {e['height_mm']} mm · `{e['file']}.pdf` (vector, live text) · "
                        f"`{e['file']}_{e['print_dpi']}dpi.png` · {e['legend_words']} words*\n\n")


if __name__ == "__main__":
    main()
