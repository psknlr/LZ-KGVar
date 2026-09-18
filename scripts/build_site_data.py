#!/usr/bin/env python3
"""
Build the static JSON payloads behind the LaoziKG website (docs/).

The site is a static GitHub Pages deployment, so everything it shows is
pre-computed here from the PUBLIC STRUCTURAL RELEASE of the dataset
(the only distribution that may be published; third-party transcriptions are
withheld there and are therefore never on the site).

Usage:
    python scripts/build_site_data.py                      # reads the zip in the repo root
    python scripts/build_site_data.py --release <zip|dir>  # explicit source
    python scripts/build_site_data.py --out docs/data

The six release figures are drawn separately by scripts/build_figures.py from the
payloads this script writes.

By default (--profile public) text columns are used solely for resources whose
release_disposition in the rights ledger is `full_text` (the dataset authors'
own WANGBI_TONGSHI_2026); every other text-bearing column is empty in the public
profile anyway. `--profile full` includes every text column present in the
input — meant for an internal build from the full internal package, whose
third-party transcriptions must not be published (see PROFILE_NOTICE.md).
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
import tempfile
import zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FULL_TEXT_VERSION = "WANGBI_TONGSHI_2026"

# Chronological order used for every era axis on the site (witness eras and
# person eras share it). Approximate year spans drive the timeline layout only;
# they are display conventions, not dataset assertions.
ERA_TABLE = [
    ("春秋", -770, -476), ("春秋战国", -770, -221), ("战国", -475, -221),
    ("西汉", -206, 8), ("东汉", 25, 220), ("三国", 220, 280), ("吴", 222, 280),
    ("西晋", 266, 316), ("东晋", 317, 420), ("南北朝", 420, 589),
    ("南朝宋", 420, 479), ("南朝齐", 479, 502), ("南朝陈", 557, 589),
    ("隋", 581, 618), ("唐", 618, 907), ("五代", 907, 960),
    ("宋", 960, 1279), ("北宋", 960, 1127), ("南宋", 1127, 1279),
    ("元", 1271, 1368), ("明", 1368, 1644), ("明末清初", 1600, 1700),
    ("清", 1644, 1912), ("清末民初", 1880, 1930), ("民国", 1912, 1949),
    ("日本江户", 1603, 1868), ("日本近代", 1868, 1945), ("现代", 1949, 2026),
    ("不详", None, None),
]
ERA_ORDER = [e[0] for e in ERA_TABLE]
ERA_SPAN = {e[0]: [e[1], e[2]] for e in ERA_TABLE}

NODE_TYPE_META = {
    "OntologicalConcept": {"zh": "本体", "stratum": "atomic"},
    "CosmologicalConcept": {"zh": "宇宙", "stratum": "atomic"},
    "EpistemicConcept": {"zh": "认识", "stratum": "atomic"},
    "CultivationConcept": {"zh": "修身", "stratum": "atomic"},
    "EthicalConcept": {"zh": "伦理", "stratum": "atomic"},
    "PoliticalConcept": {"zh": "政治", "stratum": "atomic"},
    "Practice": {"zh": "工夫", "stratum": "composite"},
    "Phrase": {"zh": "语句", "stratum": "composite"},
    "Proposition": {"zh": "命题", "stratum": "composite"},
    "Metaphor": {"zh": "譬喻", "stratum": "composite"},
}

WORK_TYPE_ZH = {
    "ddj_commentary": "《道德经》注疏", "manuscript_composite": "写本合抄",
    "related_laozi_text": "老子相关文献", "canonical_ddj": "《道德经》经文本",
    "apocryphal_text": "托名/道教经典", "fragment": "残片",
    "biography_text": "老子传记", "ritual_text": "科仪文本",
}
TEXTUAL_SCOPE_ZH = {"partial": "部分章", "not_ddj": "非《道德经》", "full_81": "全八十一章", "single_unit": "单一单元"}
ALIGN_ZH = {"aligned_partial": "部分对齐", "aligned_full": "完全对齐", "unaligned": "未对齐"}
DISPOSITION_ZH = {"full_text": "全文发布", "metadata_and_offsets": "仅元数据与偏移", "reference_only": "仅书目记录"}
CHANGE_TYPE_ZH = {"词汇层": "词汇层", "字形层": "字形层", "句法层": "句法层"}
EDIT_OP_ZH = {"insert": "增", "delete": "删", "replace": "改"}
COMPOSITION_ZH = {"mixed": "经注混合", "commentary_dominant": "注文为主", "scripture_dominant": "经文为主", "unknown": "未知"}

GRAPH_NODES = [
    ("Version", "文献版本", "version_id", "一条文本资源记录：175 种历史文献 + 1 种现代整理本"),
    ("Person", "人物", "person_id", "75 位具名人物 + 佚名/待考两个占位"),
    ("PersonAlias", "人物别名", "alias_key", "人名的各种表面写法，指向规范人物"),
    ("ChapterInstance", "章节实例", "instance_id", "某一文献中的一个章级单元；未对齐单元 chapter_num = -1"),
    ("Sentence", "句子", "sentence_id", "按句切分的文献文本（公开版仅保留结构与字数）"),
    ("Variant", "候选异文", "variant_id", "与王弼本比对自动检出的候选差异事件，无一经校勘确认"),
    ("Concept", "概念", "concept_id", "111 个概念，按 node_type 分为 10 层"),
    ("Commentary", "注疏条目", "commentary_id", "某注家对某概念的一条训释，引文来源已分离标注"),
    ("Evidence", "证据", "evidence_id", "支撑注疏条目的证据记录，含 quote_kind"),
    ("ProvenanceAssertion", "版本关系断言", "pa_id", "同书异本等经过中介的版本关系主张"),
    ("CandidateScholarlyClaim", "候选学术主张", "sc_id", "AI 生成、未经核验，位于 derived_unverified/"),
    ("CandidateScholarlyClaimEvidence", "候选主张证据", "evidence_id", "AI 生成、未经核验"),
]
GRAPH_RELS = [
    ("HAS_INSTANCE", "Version", "ChapterInstance"), ("HAS_SENTENCE", "ChapterInstance", "Sentence"),
    ("HAS_VARIANT", "ChapterInstance", "Variant"), ("VARIANT_AGAINST", "Variant", "Version"),
    ("AUTHORED_BY", "Version", "Person"), ("ANNOTATED_BY", "Version", "Person"),
    ("HAS_ALIAS", "Person", "PersonAlias"), ("MENTIONS_CONCEPT", "ChapterInstance", "Concept"),
    ("GLOSSES", "Commentary", "Concept"), ("INTERPRETS", "Commentary", "ChapterInstance"),
    ("COMMENTARY_OF", "Commentary", "Version"), ("HAS_EVIDENCE", "Commentary", "Evidence"),
    ("CONCEPT_LOCUS", "Concept", "ChapterInstance"), ("RELATED_CONCEPT", "Concept", "Concept"),
    ("PA_ASSERTS_A", "ProvenanceAssertion", "Version"), ("PA_ASSERTS_B", "ProvenanceAssertion", "Version"),
    ("CLAIM_EVIDENCE", "CandidateScholarlyClaim", "CandidateScholarlyClaimEvidence"),
]


def log(msg):
    print(f"[build_site_data] {msg}", file=sys.stderr)


def locate_release(path):
    """Return a directory holding the public structural release (extracting a zip if needed)."""
    if os.path.isdir(path):
        root = path
    else:
        tmp = tempfile.mkdtemp(prefix="laozikg_release_")
        with zipfile.ZipFile(path) as zf:
            zf.extractall(tmp)
        root = tmp
    hits = glob.glob(os.path.join(root, "**", "metadata", "public_release_facts.json"), recursive=True) \
        + glob.glob(os.path.join(root, "**", "metadata", "release_facts.json"), recursive=True)
    if not hits:
        sys.exit(f"no metadata/*release_facts.json under {path}; is this a LaoziKG release?")
    # the shallowest hit is the release itself; the full package nests a copy of the public profile under dist/
    hits.sort(key=lambda h: (h.count(os.sep), h))
    return os.path.dirname(os.path.dirname(hits[0]))


def read_csv(rel, root):
    return pd.read_csv(os.path.join(root, rel), encoding="utf-8-sig", dtype=str, keep_default_na=False)


def read_parquet(rel, root):
    return pd.read_parquet(os.path.join(root, rel))


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes")


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)")


def era_key(era):
    return ERA_ORDER.index(era) if era in ERA_ORDER else len(ERA_ORDER)


def specificity(name):
    n = len(name)
    return "high" if n >= 3 else ("medium" if n == 2 else "low")


def counter_dict(counter, sort_by_era=False):
    items = counter.items()
    if sort_by_era:
        items = sorted(items, key=lambda kv: era_key(kv[0]))
    else:
        items = sorted(items, key=lambda kv: (-kv[1], str(kv[0])))
    return [[k, v] for k, v in items]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", default=None, help="public structural release zip or extracted directory")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "data"))
    ap.add_argument("--profile", choices=["public", "full"], default="public",
                    help="public (default): text only for full_text resources — the only mode suitable for a public site. "
                         "full: include every text column present in the input (sentences, quotes, LLM glosses, variant strings); "
                         "for an INTERNAL build from the full internal package, never for public deployment")
    args = ap.parse_args()

    release = args.release
    if release is None:
        zips = sorted(glob.glob(os.path.join(ROOT, "LaoziKG-*-public-structural.zip")))
        if not zips:
            sys.exit("no LaoziKG-*-public-structural.zip in the repo root; pass --release")
        release = zips[-1]
    root = locate_release(release)
    log(f"release root: {root}")

    facts_path = os.path.join(root, "metadata", "public_release_facts.json")
    if not os.path.exists(facts_path):
        facts_path = os.path.join(root, "metadata", "release_facts.json")
    facts = json.load(open(facts_path, encoding="utf-8"))
    log(f"facts: {os.path.relpath(facts_path, root)} · profile: {args.profile}")
    version = facts["release_version"]

    # ------------------------------------------------------------------ tables
    V = read_csv("data/versions.csv", root)
    R = read_csv("data/source_rights.csv", root)
    C = read_csv("data/concepts.csv", root)
    CR = read_csv("data/concept_relations.csv", root)
    CC = read_csv("data/concept_canonical_chapters.csv", root)
    CS = read_csv("data/concept_mention_statistics.csv", root)
    P = read_csv("data/persons.csv", root)
    PA_ = read_csv("data/person_aliases.csv", root)
    AE = read_csv("data/authorship_edges.csv", root)
    PROV = read_csv("data/provenance_assertions.csv", root)
    CM = read_csv("data/commentary.csv", root)
    MENT = read_csv("data/concept_chapter_mentions.csv", root)
    MENT_R = read_csv("data/concept_recovered_mentions.csv", root)
    CI = read_parquet("data/chapter_instances.parquet", root)
    VA = read_parquet("data/variants.parquet", root)
    S = read_parquet("data/sentences.parquet", root)
    CREATORS = read_csv("metadata/creators.csv", root)
    DICT = read_csv("metadata/data_dictionary.csv", root)
    MANIFEST = read_csv("metadata/file_manifest.csv", root)
    STATS = read_csv("metadata/dataset_statistics.csv", root)
    VALID = json.load(open(os.path.join(root, "expert_validation", "validation_metrics.json"), encoding="utf-8"))
    qa_path = os.path.join(root, "qa", "public_profile_qa_report.json")
    QA = json.load(open(qa_path, encoding="utf-8")) if os.path.exists(qa_path) else {"checks_total": None, "checks_passed": None, "checks": []}
    FINAL = json.load(open(os.path.join(root, "metadata", "final_release_verification.json"), encoding="utf-8"))

    # the full internal package carries the text columns instead of the *_char_count columns
    def ensure_count(df, text_col, count_col):
        if count_col not in df.columns:
            df[count_col] = df[text_col].map(lambda v: len(v) if isinstance(v, str) else 0) if text_col in df.columns else 0
        return df
    ensure_count(CI, "raw_heading", "raw_heading_char_count")
    ensure_count(S, "original_text", "original_text_char_count"); ensure_count(S, "normalized_text", "normalized_text_char_count")
    ensure_count(VA, "old_text", "old_text_char_count"); ensure_count(VA, "new_text", "new_text_char_count")
    ensure_count(CM, "source_quote", "source_quote_char_count"); ensure_count(CM, "normalized_quote", "normalized_quote_char_count"); ensure_count(CM, "llm_interpretation", "llm_interpretation_char_count")
    for col in ("original_text", "normalized_text"):
        if col not in S.columns:
            S[col] = ""
    for col in ("old_text", "new_text", "semantic_explanation"):
        if col not in VA.columns:
            VA[col] = ""
    for col in ("source_quote", "llm_interpretation"):
        if col not in CM.columns:
            CM[col] = ""
    for df in (MENT, MENT_R):
        df["mention_count"] = df["mention_count"].map(to_int)
        df["sentence_count"] = df["sentence_count"].map(to_int)
        df["chapter_num"] = df["chapter_num"].map(to_int)
    CM["chapter_num"] = CM["chapter_num"].map(lambda v: to_int(v, -1))

    versions_by_id = {r["version_id"]: r for r in V.to_dict("records")}
    rights_by_id = {r["version_id"]: r for r in R.to_dict("records")}
    concepts_by_id = {r["concept_id"]: r for r in C.to_dict("records")}
    persons_by_id = {r["person_id"]: r for r in P.to_dict("records")}

    # ------------------------------------------------------- chapter instances
    CI_default = CI[CI["analysis_default_include"] == True]  # noqa: E712
    CI_recovered = CI[CI["alignment_review_status"] == "auto_recovered_unreviewed"]
    CI_unaligned = CI[CI["alignment_review_status"] == "not_aligned"]
    inst_chapter = dict(zip(CI["instance_id"], CI["chapter_num"]))
    inst_version = dict(zip(CI["instance_id"], CI["version_id"]))

    chapters_by_version = collections.defaultdict(set)
    recovered_by_version = collections.defaultdict(set)
    for r in CI_default.itertuples():
        chapters_by_version[r.version_id].add(int(r.chapter_num))
    for r in CI_recovered.itertuples():
        recovered_by_version[r.version_id].add(int(r.chapter_num))
    unaligned_by_version = collections.Counter(CI_unaligned["version_id"])
    instances_by_version = collections.Counter(CI["version_id"])
    chars_by_version = CI.groupby("version_id")["char_count"].sum().to_dict()
    composition_by_version = {k: collections.Counter(g["text_composition"]) for k, g in CI.groupby("version_id")}
    base_share_median_by_version = CI_default.groupby("version_id")["base_text_share_upper_bound"].median().to_dict()
    sentences_by_version = collections.Counter(S["version_id"])
    sentences_by_instance = collections.Counter(S["instance_id"])

    # -------------------------------------------------------------- variants
    VA["chapter_num"] = VA["chapter_num"].astype(int)
    variants_by_version = collections.Counter(VA["version_b"])
    variants_type_by_version = {k: collections.Counter(g["change_type"]) for k, g in VA.groupby("version_b")}
    variants_by_chapter = collections.Counter(VA["chapter_num"])
    variants_type_by_chapter = {k: collections.Counter(g["change_type"]) for k, g in VA.groupby("chapter_num")}
    variants_op_by_chapter = {k: collections.Counter(g["edit_op"]) for k, g in VA.groupby("chapter_num")}
    run_instances_by_chapter = collections.Counter(CI[CI["variant_detection_run"] == True]["chapter_num"])  # noqa: E712
    run_instances_by_version = collections.Counter(CI[CI["variant_detection_run"] == True]["version_id"])  # noqa: E712

    # ------------------------------------------------------------ commentary
    CM["citable"] = CM["citable_as_quote"].map(truthy)
    commentary_by_version = collections.Counter(CM["version_id"])
    commentary_by_chapter = collections.Counter(CM[CM["chapter_num"] > 0]["chapter_num"])
    commentary_by_concept = collections.Counter(CM["concept_id"])
    commentary_citable_by_concept = collections.Counter(CM[CM["citable"]]["concept_id"])
    commentary_by_person = collections.Counter(CM["commentator_person_id"])

    # --------------------------------------------------------------- mentions
    MENT_hm = MENT[MENT["match_specificity"].isin(["high", "medium"])]
    occ_by_concept_chapter = MENT.groupby(["concept_id", "chapter_num"])["mention_count"].sum()
    inst_by_concept_chapter = MENT.groupby(["concept_id", "chapter_num"])["instance_id"].nunique()
    occ_by_concept_version = MENT.groupby(["concept_id", "version_id"])["mention_count"].sum()
    inst_by_concept = MENT.groupby("concept_id")["instance_id"].nunique().to_dict()
    ver_by_concept = MENT.groupby("concept_id")["version_id"].nunique().to_dict()
    occ_by_chapter_concept = MENT.groupby(["chapter_num", "concept_id"])["mention_count"].sum()
    inst_by_chapter_concept = MENT.groupby(["chapter_num", "concept_id"])["instance_id"].nunique()
    spec_by_concept = dict(zip(MENT["concept_id"], MENT["match_specificity"]))
    edges_by_version = collections.Counter(MENT["version_id"])

    # co-occurrence over chapter instances (high + medium specificity only)
    concepts_per_instance = MENT_hm.groupby("instance_id")["concept_id"].apply(lambda s: sorted(set(s)))
    pair_counts = collections.Counter()
    hm_inst_by_concept = collections.Counter()
    for concepts in concepts_per_instance:
        for c in concepts:
            hm_inst_by_concept[c] += 1
        for i in range(len(concepts)):
            for j in range(i + 1, len(concepts)):
                pair_counts[(concepts[i], concepts[j])] += 1

    # --------------------------------------------------------------- summary
    era_counter = collections.Counter(V["witness_era_normalized"])
    lineage_counter = collections.Counter(V["lineage_branch"])
    work_type_counter = collections.Counter(V["work_type"])
    disposition_counter = collections.Counter(R["release_disposition"])
    summary = {
        "version": version,
        "site_profile": args.profile,
        "build_date": facts.get("build_date"),
        "generated_at_utc": facts.get("generated_at_utc"),
        "title": facts.get("dataset_title"),
        "profile": facts.get("profile"),
        "status": {
            "public_distribution": facts.get("public_distribution_status"),
            "full_distribution": facts.get("full_distribution_status"),
            "scientific_validation": facts.get("scientific_validation_status"),
            "overall": facts.get("overall_release_status"),
            "release_date_statement": facts.get("release_date_statement"),
        },
        "counts": {k: facts.get(k) for k in [
            "resources", "source_witnesses", "derived_resources", "chapter_instances", "aligned_instances",
            "unaligned_instances", "default_include_instances", "recovered_unreviewed_instances", "sentences",
            "sentences_split_at_colophon", "variants", "structural_mismatches", "variant_explanations_distinct",
            "variant_explanation_rows", "commentary", "citable_quotes", "evidence", "commentary_concepts_covered",
            "era_rows_both_known", "era_rows_differ", "era_differ_pct", "persons", "canonical_persons",
            "placeholder_persons", "aliases", "authorship_edges", "persons_era_disputed", "concepts", "seed_concepts",
            "llm_expanded_concepts", "concepts_with_mentions", "concept_relations", "provenance_assertions",
            "candidate_claims", "mention_edges_default", "mention_occurrences_default", "mention_edges_recovered",
            "mention_occurrences_recovered", "mention_edges_unaligned", "mention_occurrences_unaligned",
            "mention_edges_all_aligned", "sentence_mention_rows_default", "single_char_share_pct",
            "searched_chars_default_set", "graph_node_tables", "graph_rel_tables", "graph_inputs_hashed",
            "validation_frames_items", "validation_adjudicated", "pvs_items", "pvs_adjudicated",
            "rights_rows", "rights_cleared", "rights_not_reviewed", "rights_provider_low_confidence",
            "dictionary_columns", "dictionary_tables",
        ]},
        "full_corpus": {k.replace("_full_corpus", ""): facts.get(k) for k in facts if k.endswith("_full_corpus")},
        "text_provenance": facts.get("text_provenance"),
        "tier_occurrences": facts.get("tier_occurrences"),
        "tier_edges": facts.get("tier_edges"),
        "tier_concepts": facts.get("tier_concepts"),
        "text_composition": facts.get("text_composition"),
        "work_type": counter_dict(work_type_counter),
        "work_type_zh": WORK_TYPE_ZH,
        "textual_scope_zh": TEXTUAL_SCOPE_ZH,
        "alignment_status": facts.get("alignment_status"),
        "unresolved_reason": facts.get("unresolved_reason"),
        "recovery": facts.get("recovery"),
        "lineage": counter_dict(lineage_counter),
        "witness_era": counter_dict(era_counter, sort_by_era=True),
        "era_order": ERA_ORDER,
        "era_span": ERA_SPAN,
        "rights": {
            "cleared": facts.get("rights_cleared"),
            "not_reviewed": facts.get("rights_not_reviewed"),
            "dispositions": counter_dict(disposition_counter),
            "disposition_zh": DISPOSITION_ZH,
            "provider_buckets": facts.get("rights_provider_buckets"),
            "providers": facts.get("rights_providers"),
        },
        "graph": {
            "node_counts": facts.get("graph_node_counts"),
            "rel_counts": facts.get("graph_rel_counts"),
        },
        "relation_categories": facts.get("relation_categories"),
        "top_concepts_raw": facts.get("top_concepts_raw"),
        "top_concepts_high_specificity": facts.get("top_concepts_high_specificity"),
        "spearman_raw_vs_high_specificity": facts.get("spearman_raw_vs_high_specificity"),
        "count_phrasing_instances": facts.get("count_phrasing_instances"),
        "data_availability_statement": facts.get("data_availability_statement"),
        "verified_reproduction_sentence": facts.get("verified_reproduction_sentence"),
        "validation": {
            "status": VALID.get("status"),
            "frames": {k: v for k, v in VALID.get("frame_status", {}).items()},
            "items_total": facts.get("validation_frames_items"),
            "items_full_corpus": facts.get("validation_frames_items_full_corpus"),
        },
        "qa": {
            "checks_total": QA.get("checks_total"),
            "checks_passed": QA.get("checks_passed"),
            "checks": [{"check": c.get("check"), "passed": c.get("passed"), "detail": c.get("detail")} for c in QA.get("checks", [])],
            "payload_files_verified": FINAL.get("public_structural_release", {}).get("payload_files_verified"),
        },
        "authors": [{
            "order": to_int(r["order"]), "display": r["display"], "family": r["family"], "given": r["given"],
            "affiliation": r["affiliation"], "role": r["role"], "orcid": r.get("orcid", ""),
        } for r in CREATORS.to_dict("records")],
        "tables": [{"table": r["table"], "rows": to_int(r["rows"]), "columns": to_int(r["columns"]), "purpose": r["purpose"]} for r in STATS.to_dict("records")],
        "node_type_meta": NODE_TYPE_META,
    }
    dump(summary, os.path.join(args.out, "summary.json"))

    # -------------------------------------------------------------- concepts
    canonical = collections.defaultdict(list)
    for r in CC.itertuples():
        canonical[r.concept_id].append(to_int(r.chapter_num))
    stats_by_id = {r["concept_id"]: r for r in CS.to_dict("records")}
    rel_out = collections.defaultdict(list)
    rel_in = collections.defaultdict(list)
    for r in CR.to_dict("records"):
        e = {"type": r["relation_type"], "category": r["relation_category"], "source": r["source"], "evidence": r["evidence"]}
        rel_out[r["concept_id_a"]].append(dict(e, to=r["concept_id_b"]))
        rel_in[r["concept_id_b"]].append(dict(e, **{"from": r["concept_id_a"]}))
    commentary_era_by_concept = {k: collections.Counter(g["commentator_historical_era"].replace("", "不详")) for k, g in CM.groupby("concept_id")}
    commentary_commentator_by_concept = {k: collections.Counter(g["commentator_raw"]) for k, g in CM.groupby("concept_id")}

    concepts = []
    for r in C.to_dict("records"):
        cid = r["concept_id"]
        st = stats_by_id.get(cid, {})
        by_chapter = []
        if cid in occ_by_concept_chapter.index.get_level_values(0):
            occ = occ_by_concept_chapter.loc[cid]
            inst = inst_by_concept_chapter.loc[cid]
            for ch in occ.index:
                by_chapter.append([int(ch), int(occ[ch]), int(inst[ch])])
        top_witnesses = []
        if cid in occ_by_concept_version.index.get_level_values(0):
            s = occ_by_concept_version.loc[cid].sort_values(ascending=False).head(8)
            top_witnesses = [[vid, int(n)] for vid, n in s.items()]
        concepts.append({
            "id": cid, "name": r["name"], "node_type": r["node_type"],
            "node_type_zh": NODE_TYPE_META.get(r["node_type"], {}).get("zh", r["node_type"]),
            "stratum": NODE_TYPE_META.get(r["node_type"], {}).get("stratum", "atomic"),
            "is_seed": truthy(r["is_seed"]), "generated_by": r["concept_generated_by"],
            "definition_generated_by": r["definition_generated_by"],
            "category": r["category"], "subcategory": r["subcategory"], "definition": r["definition_core"],
            "attested": truthy(r["is_textually_attested"]), "attestation_note": r["attestation_note"],
            "specificity": specificity(r["name"]),
            "canonical_chapters": sorted(canonical.get(cid, [])),
            "stats": {
                "raw": to_int(st.get("raw_lexical_mentions")), "high": to_int(st.get("high_specificity_mentions")),
                "raw_full_corpus": to_int(st.get("raw_lexical_mentions_full_corpus")),
                "high_full_corpus": to_int(st.get("high_specificity_mentions_full_corpus")),
                "per_10k": float(st.get("mentions_per_10k_chars") or 0), "high_per_10k": float(st.get("high_specificity_per_10k_chars") or 0),
                "tier_high": to_int(st.get("mentions_specificity_high")), "tier_medium": to_int(st.get("mentions_specificity_medium")),
                "tier_low": to_int(st.get("mentions_specificity_low")),
                "instances": int(inst_by_concept.get(cid, 0)), "witnesses": int(ver_by_concept.get(cid, 0)),
                "hm_instances": int(hm_inst_by_concept.get(cid, 0)),
            },
            "by_chapter": by_chapter, "top_witnesses": top_witnesses,
            "commentary": {
                "total": int(commentary_by_concept.get(cid, 0)), "citable": int(commentary_citable_by_concept.get(cid, 0)),
                "by_era": counter_dict(commentary_era_by_concept.get(cid, collections.Counter()), sort_by_era=True),
                "by_commentator": counter_dict(commentary_commentator_by_concept.get(cid, collections.Counter()))[:10],
            },
            "relations_out": rel_out.get(cid, []), "relations_in": rel_in.get(cid, []),
        })
    concepts.sort(key=lambda c: (c["stratum"] != "atomic", -c["stats"]["raw"]))
    dump(concepts, os.path.join(args.out, "concepts.json"))

    # co-occurrence graph payload
    cooc = sorted(([a, b, n] for (a, b), n in pair_counts.items() if n >= 20), key=lambda x: -x[2])
    graph = {
        "nodes": [{"id": c["id"], "name": c["name"], "node_type": c["node_type"], "stratum": c["stratum"],
                   "raw": c["stats"]["raw"], "high": c["stats"]["high"], "hm_instances": c["stats"]["hm_instances"],
                   "is_seed": c["is_seed"], "attested": c["attested"]} for c in concepts],
        "ontology_edges": [{"a": r["concept_id_a"], "b": r["concept_id_b"], "type": r["relation_type"],
                            "category": r["relation_category"], "source": r["source"]} for r in CR.to_dict("records")],
        "cooccurrence_edges": cooc,
        "cooccurrence_note": "default analysis set; high/medium-specificity matches only; weight = chapter instances containing both concepts",
    }
    dump(graph, os.path.join(args.out, "concept_graph.json"))

    # ------------------------------------------------------------- witnesses
    persons_by_version = collections.defaultdict(list)
    for r in AE.to_dict("records"):
        p = persons_by_id.get(r["person_id"], {})
        persons_by_version[r["version_id"]].append({
            "id": r["person_id"], "name": p.get("canonical_name", r["person_id"]), "role_raw": r["role_raw"],
            "edge_type": r["edge_type"], "attributed": truthy(r["is_attributed"]), "status": r["attribution_status"],
            "era": p.get("person_historical_era", ""),
        })
    same_work = collections.defaultdict(list)
    for r in PROV.to_dict("records"):
        for me, other in ((r["version_a"], r["version_b"]), (r["version_b"], r["version_a"])):
            same_work[me].append({"pa_id": r["pa_id"], "other": other, "other_title": versions_by_id.get(other, {}).get("title", other),
                                  "relation": r["relation_type"], "basis": r["assertion_basis"], "confidence": r["confidence"], "reliability": r["reliability"]})
    witnesses = []
    for r in V.to_dict("records"):
        vid = r["version_id"]
        rt = rights_by_id.get(vid, {})
        comp = composition_by_version.get(vid, collections.Counter())
        witnesses.append({
            "id": vid, "title": r["title"], "author_raw": r["author_raw"], "edition": r["edition"],
            "era_raw": r["witness_era_raw"], "era": r["witness_era_normalized"] or "不详",
            "era_ambiguous": truthy(r["witness_era_ambiguous"]), "lineage": r["lineage_branch"],
            "work_type": r["work_type"], "textual_scope": r["textual_scope"], "tags": r["category_tags"],
            "is_fragment": truthy(r["is_fragment"]), "resource_class": r["resource_class"],
            "structural_units": to_int(r["source_structural_unit_count"]),
            "record_aligned_chapters": to_int(r["aligned_laozi_chapter_count"]),
            "alignment_status": r["alignment_status"], "unresolved_reason": r["unresolved_reason"],
            "chapters": sorted(chapters_by_version.get(vid, [])),
            "chapters_recovered": sorted(recovered_by_version.get(vid, [])),
            "unaligned_units": int(unaligned_by_version.get(vid, 0)),
            "instances": int(instances_by_version.get(vid, 0)),
            "sentences": int(sentences_by_version.get(vid, 0)),
            "chars": int(chars_by_version.get(vid, 0)),
            "variants": int(variants_by_version.get(vid, 0)),
            "variants_by_type": dict(variants_type_by_version.get(vid, {})),
            "variant_run_instances": int(run_instances_by_version.get(vid, 0)),
            "mention_edges": int(edges_by_version.get(vid, 0)),
            "commentary": int(commentary_by_version.get(vid, 0)),
            "composition": {k: int(v) for k, v in comp.items()},
            "base_text_share_median": (None if pd.isna(base_share_median_by_version.get(vid, float("nan"))) else round(float(base_share_median_by_version[vid]), 3)),
            "persons": persons_by_version.get(vid, []),
            "same_work": same_work.get(vid, []),
            "provider": rt.get("digital_source_provider", ""), "provider_confidence": rt.get("provider_inference_confidence", ""),
            "disposition": rt.get("release_disposition", ""), "rights_status": rt.get("redistribution_status", ""),
            "public_domain_by_age": rt.get("original_text_public_domain", ""),
        })
    witnesses.sort(key=lambda w: (era_key(w["era"]), -len(w["chapters"]), w["title"]))
    dump(witnesses, os.path.join(args.out, "witnesses.json"))
    # slim lookup used by the other pages (titles for chips and links)
    dump({w["id"]: {"t": w["title"], "e": w["era"], "l": w["lineage"], "d": w["disposition"], "n": len(w["chapters"])} for w in witnesses},
         os.path.join(args.out, "witness_index.json"))

    # -------------------------------------------------------------- chapters
    base_sentences = S[(S["version_id"] == FULL_TEXT_VERSION) & (S["original_text"].fillna("").str.len() > 0)]
    base_by_chapter = collections.defaultdict(list)
    for r in base_sentences.sort_values(["instance_id", "seq"]).itertuples():
        base_by_chapter[int(inst_chapter.get(r.instance_id, -1))].append(r.original_text)
    wangbi = CM[(CM["version_id"] == FULL_TEXT_VERSION) & CM["citable"] & (CM["source_quote"].str.len() > 0)]
    wangbi_by_chapter = collections.defaultdict(list)
    for r in wangbi.itertuples():
        wangbi_by_chapter[int(r.chapter_num)].append({"concept_id": r.concept_id, "concept_name": r.concept_name, "quote": r.source_quote})
    default_versions_by_chapter = {k: sorted(set(g["version_id"])) for k, g in CI_default.groupby("chapter_num")}
    recovered_versions_by_chapter = {k: sorted(set(g["version_id"])) for k, g in CI_recovered.groupby("chapter_num")}
    instances_by_chapter = collections.Counter(CI_default["chapter_num"])
    chars_by_chapter = CI_default.groupby("chapter_num")["char_count"].sum().to_dict()
    sentences_by_chapter = collections.Counter()
    for inst, n in sentences_by_instance.items():
        ch = inst_chapter.get(inst)
        if ch is not None and ch > 0:
            sentences_by_chapter[int(ch)] += n
    composition_by_chapter = {k: collections.Counter(g["text_composition"]) for k, g in CI_default.groupby("chapter_num")}
    commentary_concepts_by_chapter = {k: collections.Counter(g["concept_id"]) for k, g in CM[CM["chapter_num"] > 0].groupby("chapter_num")}
    commentary_era_by_chapter = {k: collections.Counter(g["commentator_historical_era"].replace("", "不详")) for k, g in CM[CM["chapter_num"] > 0].groupby("chapter_num")}
    commentary_citable_by_chapter = collections.Counter(CM[(CM["chapter_num"] > 0) & CM["citable"]]["chapter_num"])
    score_bins = sorted(VA["variant_detection_score"].unique().tolist())
    variants_score_by_chapter = {k: collections.Counter(g["variant_detection_score"]) for k, g in VA.groupby("chapter_num")}
    concept_name = {c["id"]: c["name"] for c in concepts}

    chapters = []
    for ch in range(1, 82):
        top = []
        if ch in occ_by_chapter_concept.index.get_level_values(0):
            occ = occ_by_chapter_concept.loc[ch].sort_values(ascending=False)
            inst = inst_by_chapter_concept.loc[ch]
            for cid, n in occ.head(40).items():
                top.append([cid, int(n), int(inst[cid])])
        chapters.append({
            "num": ch,
            "base_text": base_by_chapter.get(ch, []),
            "witnesses": default_versions_by_chapter.get(ch, []),
            "witnesses_recovered": recovered_versions_by_chapter.get(ch, []),
            "instances": int(instances_by_chapter.get(ch, 0)),
            "sentences": int(sentences_by_chapter.get(ch, 0)),
            "chars": int(chars_by_chapter.get(ch, 0)),
            "composition": {k: int(v) for k, v in composition_by_chapter.get(ch, {}).items()},
            "top_concepts": top,
            "variants": {
                "total": int(variants_by_chapter.get(ch, 0)),
                "run_instances": int(run_instances_by_chapter.get(ch, 0)),
                "by_type": {k: int(v) for k, v in variants_type_by_chapter.get(ch, {}).items()},
                "by_op": {k: int(v) for k, v in variants_op_by_chapter.get(ch, {}).items()},
                "by_score": {str(k): int(v) for k, v in variants_score_by_chapter.get(ch, {}).items()},
            },
            "commentary": {
                "total": int(commentary_by_chapter.get(ch, 0)),
                "citable": int(commentary_citable_by_chapter.get(ch, 0)),
                "by_concept": counter_dict(commentary_concepts_by_chapter.get(ch, collections.Counter())),
                "by_era": counter_dict(commentary_era_by_chapter.get(ch, collections.Counter()), sort_by_era=True),
            },
            "wangbi_glosses": wangbi_by_chapter.get(ch, []),
        })
    dump({"chapters": chapters, "score_bins": score_bins, "concept_names": concept_name,
          "base_text_source": {"version_id": FULL_TEXT_VERSION, "title": versions_by_id.get(FULL_TEXT_VERSION, {}).get("title", ""),
                               "disposition": rights_by_id.get(FULL_TEXT_VERSION, {}).get("release_disposition", ""),
                               "rights_status": rights_by_id.get(FULL_TEXT_VERSION, {}).get("redistribution_status", "")}},
         os.path.join(args.out, "chapters.json"))

    # --------------------------------------------------------------- persons
    aliases_by_person = collections.defaultdict(list)
    for r in PA_.to_dict("records"):
        aliases_by_person[r["person_id"]].append({"alias": r["alias"], "type": r["alias_type"], "note": r["note"]})
    works_by_person = collections.defaultdict(list)
    for r in AE.to_dict("records"):
        v = versions_by_id.get(r["version_id"], {})
        works_by_person[r["person_id"]].append({
            "version_id": r["version_id"], "title": v.get("title", r["version_id"]), "era": v.get("witness_era_normalized", ""),
            "role_raw": r["role_raw"], "edge_type": r["edge_type"], "attributed": truthy(r["is_attributed"]), "status": r["attribution_status"],
        })
    commentary_concepts_by_person = {k: collections.Counter(g["concept_id"]) for k, g in CM.groupby("commentator_person_id")}
    persons = []
    for r in P.to_dict("records"):
        pid = r["person_id"]
        persons.append({
            "id": pid, "name": r["canonical_name"], "status": r["entity_status"],
            "era": r["person_historical_era"] or ("" if r["entity_status"] == "placeholder" else "不详"),
            "era_alt": r["person_historical_era_alt"], "dates": r["person_era_dates"],
            "era_source": r["era_source"], "era_confidence": r["era_confidence"], "era_disputed": truthy(r["era_disputed"]),
            "aliases": aliases_by_person.get(pid, []), "works": works_by_person.get(pid, []),
            "commentary": int(commentary_by_person.get(pid, 0)),
            "commentary_concepts": [[cid, concept_name.get(cid, cid), n] for cid, n in counter_dict(commentary_concepts_by_person.get(pid, collections.Counter()))[:8]],
        })
    persons.sort(key=lambda p: (p["status"] != "canonical", era_key(p["era"]), -len(p["works"]), p["name"]))
    dump(persons, os.path.join(args.out, "persons.json"))

    # -------------------------------------------------------------- variants
    explanations = []
    for text, g in VA[VA["semantic_explanation"].fillna("") != ""].groupby("semantic_explanation"):
        # the two characters the note is about are the ones it quotes most often
        # (component mentions such as 从「心」/ 省「心」 are dropped first)
        freq = collections.Counter(re.findall(r"(?<![从省])「(.)」", text))
        pair = [c for c, _ in freq.most_common(2)]
        explanations.append({"pair": pair, "rows": int(len(g)), "text": text, "ops": dict(collections.Counter(g["edit_op"])),
                             "types": dict(collections.Counter(g["change_type"]))})
    explanations.sort(key=lambda e: -e["rows"])
    lineage_of = {r["version_id"]: r["lineage_branch"] for r in V.to_dict("records")}
    era_of = {r["version_id"]: (r["witness_era_normalized"] or "不详") for r in V.to_dict("records")}
    VA["lineage"] = VA["version_b"].map(lineage_of)
    VA["era"] = VA["version_b"].map(era_of)
    run_ci = CI[CI["variant_detection_run"] == True]  # noqa: E712
    run_by_lineage = collections.Counter(run_ci["version_id"].map(lineage_of))
    run_by_era = collections.Counter(run_ci["version_id"].map(era_of))
    top_witness_variants = [{"id": vid, "title": versions_by_id[vid]["title"], "events": int(n), "run_instances": int(run_instances_by_version.get(vid, 0))}
                            for vid, n in variants_by_version.most_common(15)]
    variants = {
        "total": int(len(VA)),
        "by_type": counter_dict(collections.Counter(VA["change_type"])),
        "by_op": counter_dict(collections.Counter(VA["edit_op"])),
        "type_by_op": {t: dict(collections.Counter(g["edit_op"])) for t, g in VA.groupby("change_type")},
        "by_score": [[float(k), int(v)] for k, v in sorted(collections.Counter(VA["variant_detection_score"]).items())],
        "by_chapter": [[int(ch), int(variants_by_chapter.get(ch, 0)), int(run_instances_by_chapter.get(ch, 0))] for ch in range(1, 82)],
        "by_lineage": [[k, int(v), int(run_by_lineage.get(k, 0))] for k, v in collections.Counter(VA["lineage"]).most_common()],
        "by_era": sorted([[k, int(v), int(run_by_era.get(k, 0))] for k, v in collections.Counter(VA["era"]).items()], key=lambda x: era_key(x[0])),
        "old_len": counter_dict(collections.Counter(VA["old_text_char_count"].astype(int).clip(upper=15))),
        "new_len": counter_dict(collections.Counter(VA["new_text_char_count"].astype(int).clip(upper=15))),
        "top_witnesses": top_witness_variants,
        "explanations": explanations,
        "reference": {"reference_text_id": "WANGBI_CANONICAL", "reference_version_id": FULL_TEXT_VERSION,
                      "detection_method": sorted(VA["detection_method"].unique().tolist()),
                      "variant_status": sorted(VA["variant_status"].unique().tolist())},
        "change_type_zh": CHANGE_TYPE_ZH, "edit_op_zh": EDIT_OP_ZH, "composition_zh": COMPOSITION_ZH,
    }
    dump(variants, os.path.join(args.out, "variants.json"))

    # ------------------------------------------------ schema, dictionary, files
    node_counts = facts.get("graph_node_counts", {})
    rel_counts = facts.get("graph_rel_counts", {})
    schema = {
        "nodes": [{"name": n, "zh": zh, "key": key, "rows": node_counts.get(n), "note": note} for n, zh, key, note in GRAPH_NODES],
        "rels": [{"name": n, "from": a, "to": b, "rows": rel_counts.get(n)} for n, a, b in GRAPH_RELS],
    }
    dump(schema, os.path.join(args.out, "schema.json"))

    tables = collections.OrderedDict()
    for r in DICT.to_dict("records"):
        tables.setdefault(r["table"], []).append({
            "column": r["column"], "dtype": r["dtype"], "null_pct": float(r["null_pct"] or 0),
            "distinct": to_int(r["distinct_count"]), "sample": r["sample_values"], "description": r["description"],
        })
    purposes = {r["table"]: r for r in STATS.to_dict("records")}
    dictionary = [{"table": t, "rows": to_int(purposes.get(t, {}).get("rows")), "purpose": purposes.get(t, {}).get("purpose", ""), "columns": cols}
                  for t, cols in tables.items()]
    dump(dictionary, os.path.join(args.out, "dictionary.json"))

    files = [{"path": r["path"], "size": to_int(r["size_bytes"]), "sha256": r["sha256"]} for r in MANIFEST.to_dict("records")]
    by_dir = collections.Counter()
    size_by_dir = collections.Counter()
    for f in files:
        top = f["path"].split("/")[0] if "/" in f["path"] else "(root)"
        by_dir[top] += 1
        size_by_dir[top] += f["size"]
    dump({"files": files, "total_files": len(files), "total_bytes": int(sum(f["size"] for f in files)),
          "by_dir": [[d, int(by_dir[d]), int(size_by_dir[d])] for d in sorted(by_dir, key=lambda d: -size_by_dir[d])],
          "zip_name": os.path.basename(release) if release.endswith(".zip") else None},
         os.path.join(args.out, "files.json"))

    # ------------------------------------------------ knowledge-graph explorer
    # Compact adjacency payloads for the in-browser graph explorer (docs/graph.html).
    # Sentences (167,506) and Variants (18,334) carry no browsable text in the public
    # profile, so they are folded into per-instance aggregates; candidate scholarly
    # claims are excluded on purpose (AI-generated, never citable).
    kg_dir = os.path.join(args.out, "kg")
    COMP_CODE = {"mixed": 0, "commentary_dominant": 1, "scripture_dominant": 2, "unknown": 3}
    STATUS_CODE = {"original_deterministic": 0, "auto_recovered_unreviewed": 1, "not_aligned": 2, "expert_confirmed": 3, "expert_corrected": 4}
    PROV_CODE = {"verbatim_contiguous": 0, "spliced_from_source": 1, "not_located": 2}
    QK_CODE = {"attested_source_quote": 0, "llm_spliced_excerpt": 1, "llm_paraphrase_unlocated": 2}
    core = {
        "versions": {}, "persons": {}, "aliases": {}, "concepts": {}, "pas": {},
        "edges": {"AUTHORED_BY": [], "ANNOTATED_BY": [], "HAS_ALIAS": [], "RELATED_CONCEPT": [], "PA_ASSERTS_A": [], "PA_ASSERTS_B": []},
        "codes": {"composition": COMP_CODE, "status": STATUS_CODE, "provenance": PROV_CODE, "quote_kind": QK_CODE},
    }
    for w in witnesses:
        core["versions"][w["id"]] = {
            "t": w["title"], "a": w["author_raw"], "ed": w["edition"], "e": w["era"], "l": w["lineage"], "w": w["work_type"],
            "s": w["textual_scope"], "al": w["alignment_status"], "d": w["disposition"], "rc": w["resource_class"],
            "ni": w["instances"], "nd": len(w["chapters"]), "nr": len(w["chapters_recovered"]), "nc": w["commentary"],
            "nv": w["variants"], "ns": w["sentences"], "ch": w["chars"], "pv": w["provider"], "su": w["structural_units"],
        }
    for pr in persons:
        core["persons"][pr["id"]] = {"n": pr["name"], "e": pr["era"], "ea": pr["era_alt"], "dt": pr["dates"], "st": pr["status"],
                                     "dp": pr["era_disputed"], "cf": pr["era_confidence"], "src": pr["era_source"],
                                     "nw": len(pr["works"]), "nc": pr["commentary"]}
    for r in PA_.to_dict("records"):
        key = r["person_id"] + "|" + r["alias"]
        core["aliases"][key] = {"p": r["person_id"], "a": r["alias"], "t": r["alias_type"], "note": r["note"]}
        core["edges"]["HAS_ALIAS"].append([r["person_id"], key])
    for c in concepts:
        core["concepts"][c["id"]] = {"n": c["name"], "nt": c["node_type"], "sd": c["is_seed"], "df": c["definition"], "at": c["attested"],
                                     "sp": c["specificity"], "raw": c["stats"]["raw"], "hi": c["stats"]["high"], "cc": c["canonical_chapters"],
                                     "ni": c["stats"]["instances"], "nc": c["commentary"]["total"], "gb": c["generated_by"]}
    for r in PROV.to_dict("records"):
        core["pas"][r["pa_id"]] = {"a": r["version_a"], "b": r["version_b"], "rel": r["relation_type"], "bs": r["assertion_basis"],
                                   "cf": r["confidence"], "rl": r["reliability"], "as": r["asserter"]}
        core["edges"]["PA_ASSERTS_A"].append([r["pa_id"], r["version_a"]])
        core["edges"]["PA_ASSERTS_B"].append([r["pa_id"], r["version_b"]])
    for r in AE.to_dict("records"):
        rel = "ANNOTATED_BY" if r["edge_type"] == "annotated" else "AUTHORED_BY"
        core["edges"][rel].append([r["version_id"], r["person_id"], r["role_raw"], truthy(r["is_attributed"]), r["attribution_status"]])
    for r in CR.to_dict("records"):
        core["edges"]["RELATED_CONCEPT"].append([r["concept_id_a"], r["concept_id_b"], r["relation_type"], r["relation_category"], r["source"]])
    dump(core, os.path.join(kg_dir, "core.json"))

    concept_index = [c["id"] for c in concepts]
    cidx = {cid: i for i, cid in enumerate(concept_index)}
    var_by_inst = {k: collections.Counter(g["change_type"]) for k, g in VA.groupby("instance_id")}
    inst_payload = {}
    for r in CI.itertuples():
        vt = var_by_inst.get(r.instance_id, {})
        inst_payload[r.instance_id] = [
            r.version_id, int(r.chapter_num), int(r.char_count), int(sentences_by_instance.get(r.instance_id, 0)),
            COMP_CODE.get(r.text_composition, 3), r.segmentation_method, STATUS_CODE.get(r.alignment_review_status, 0),
            int(vt.get("词汇层", 0)), int(vt.get("字形层", 0)), int(vt.get("句法层", 0)), int(r.order_in_doc),
            (None if pd.isna(r.base_text_share_upper_bound) else round(float(r.base_text_share_upper_bound), 3)),
        ]
    mentions_payload = collections.defaultdict(list)
    for df, flag in ((MENT, 0), (MENT_R, 1)):
        for r in df.itertuples():
            mentions_payload[r.instance_id].append([cidx[r.concept_id], int(r.mention_count), flag] if flag else [cidx[r.concept_id], int(r.mention_count)])
    dump({"instances": inst_payload, "concept_index": concept_index, "mentions": dict(mentions_payload)}, os.path.join(kg_dir, "instances.json"))

    EV = read_parquet("data/evidence.parquet", root)
    ensure_count(EV, "quote", "quote_char_count")
    text_versions = set(V["version_id"]) if args.profile == "full" else {r["version_id"] for r in R.to_dict("records") if r["release_disposition"] == "full_text"}
    comm_payload = {}
    for r in CM.itertuples():
        comm_payload[r.commentary_id] = [
            r.version_id, r.instance_id, int(r.chapter_num), r.concept_id, r.commentator_raw, r.commentator_person_id,
            r.commentator_historical_era, r.commentary_witness_era, PROV_CODE.get(r.text_provenance, 2), bool(r.citable),
            r.reliability, r.extraction_method, (r.source_quote if (r.version_id in text_versions and r.citable) else ""),
            int(to_int(r.llm_interpretation_char_count)), int(to_int(r.source_quote_char_count)),
            (r.llm_interpretation if args.profile == "full" else ""),
        ]
    ev_payload = {}
    for r in EV.itertuples():
        ev_payload[r.evidence_id] = [r.source_ref, QK_CODE.get(r.quote_kind, 2), r.reliability,
                                     (None if pd.isna(r.source_char_overlap) else round(float(r.source_char_overlap), 3)),
                                     bool(r.quote_is_verbatim), int(r.quote_char_count)]
    dump({"commentary": comm_payload, "evidence": ev_payload}, os.path.join(kg_dir, "commentary.json"))

    # ------------------------------------------------- per-chapter drill-down
    # One file per canonical chapter (plus "unaligned") with the sentence skeleton
    # of every instance, sentence-level concept mentions, the instance's candidate
    # variant events and its commentary records. Text is carried only for
    # resources whose release_disposition is full_text.
    full_text_versions = text_versions
    SM = read_parquet("data/concept_sentence_mentions.parquet", root)
    SMR = read_parquet("data/concept_sentence_recovered_mentions.parquet", root)
    seq_of = dict(zip(S["sentence_id"], S["seq"].astype(int)))
    sent_by_instance = collections.defaultdict(list)
    for r in S.sort_values(["instance_id", "seq"]).itertuples():
        sent_by_instance[r.instance_id].append((int(r.seq), int(r.original_text_char_count), int(r.normalized_text_char_count),
                                                (r.original_text if r.version_id in full_text_versions else ""), r.normalized_text if r.version_id in full_text_versions else ""))
    ment_by_instance = collections.defaultdict(list)
    for df in (SM, SMR):
        for r in df.itertuples():
            ment_by_instance[r.instance_id].append([int(seq_of.get(r.sentence_id, -1)), cidx[r.concept_id], int(r.mention_count)])
    expl_index = {e["text"]: i for i, e in enumerate(explanations)}
    TYPE_CODE = {"词汇层": 0, "字形层": 1, "句法层": 2}
    OP_CODE = {"insert": 0, "delete": 1, "replace": 2}
    var_by_instance = collections.defaultdict(list)
    for r in VA.sort_values(["instance_id", "position"]).itertuples():
        expl = r.semantic_explanation if isinstance(r.semantic_explanation, str) and r.semantic_explanation else ""
        row = [int(r.position), TYPE_CODE.get(r.change_type, 0), OP_CODE.get(r.edit_op, 0), int(r.old_text_char_count),
               int(r.new_text_char_count), float(r.variant_detection_score), expl_index.get(expl, -1), r.variant_id]
        if args.profile == "full":
            row += [r.old_text if isinstance(r.old_text, str) else "", r.new_text if isinstance(r.new_text, str) else ""]
        var_by_instance[r.instance_id].append(row)
    comm_by_instance = collections.defaultdict(list)
    for r in CM.itertuples():
        comm_by_instance[r.instance_id].append(r.commentary_id)
    ev_by_comm = collections.defaultdict(list)
    for r in EV.itertuples():
        ev_by_comm[r.source_ref].append([r.evidence_id, QK_CODE.get(r.quote_kind, 2), r.reliability,
                                         (None if pd.isna(r.source_char_overlap) else round(float(r.source_char_overlap), 3)), bool(r.quote_is_verbatim), int(r.quote_char_count)])
    ref_sent = {}
    for iid, sents in sent_by_instance.items():
        if inst_version.get(iid) == FULL_TEXT_VERSION:
            ref_sent[int(inst_chapter.get(iid, -1))] = [[q[0], q[3], q[4]] for q in sents]
    wangbi_exegesis = {}
    if args.profile == "full":
        try:
            WX = read_parquet("data/wangbi_exegesis_source.parquet", root)
            for r in WX.itertuples():
                if isinstance(r.jingwen, str) and r.jingwen:
                    wangbi_exegesis[int(r.chapter_num)] = [r.jingwen, r.wangbi_commentary or "", r.quanjie_interpretation or ""]
        except Exception as e:  # noqa: BLE001
            log(f"wangbi exegesis source not available: {e}")
    ch_dir = os.path.join(args.out, "chapters")
    instances_index = collections.defaultdict(list)
    groups = {ch: g for ch, g in CI.groupby("chapter_num")}
    for ch, g in groups.items():
        ch = int(ch)
        inst_list = []
        comm_map = {}
        for r in g.sort_values(["version_id"]).itertuples():
            has_text = r.version_id in full_text_versions
            sents = sent_by_instance.get(r.instance_id, [])
            inst_list.append({
                "id": r.instance_id, "v": r.version_id, "st": STATUS_CODE.get(r.alignment_review_status, 0), "chars": int(r.char_count),
                "comp": COMP_CODE.get(r.text_composition, 3), "method": r.segmentation_method, "order": int(r.order_in_doc),
                "share": (None if pd.isna(r.base_text_share_upper_bound) else round(float(r.base_text_share_upper_bound), 3)),
                "run": bool(r.variant_detection_run), "text": has_text,
                "sent": [([q[0], q[1], q[3]] if has_text else [q[0], q[1]]) for q in sents],
                "ment": ment_by_instance.get(r.instance_id, []),
                "var": var_by_instance.get(r.instance_id, []),
                "comm": comm_by_instance.get(r.instance_id, []),
            })
            instances_index[r.version_id].append([r.instance_id, ch, STATUS_CODE.get(r.alignment_review_status, 0)])
            for cid in comm_by_instance.get(r.instance_id, []):
                comm_map[cid] = comm_payload[cid] + [ev_by_comm.get(cid, [])]
        dump({"chapter": ch, "cidx": concept_index, "ref": ref_sent.get(ch, []), "instances": inst_list, "commentary": comm_map,
              "wangbi": wangbi_exegesis.get(ch), "profile": args.profile,
              "expl": [{"pair": e["pair"], "text": e["text"], "rows": e["rows"]} for e in explanations],
              "codes": {"type": ["词汇层", "字形层", "句法层"], "op": ["insert", "delete", "replace"]}},
             os.path.join(ch_dir, ("unaligned" if ch < 1 else str(ch)) + ".json"))
    dump(dict(instances_index), os.path.join(args.out, "instances_index.json"))
    dump({c["id"]: [c["name"], c["node_type"], c["specificity"]] for c in concepts}, os.path.join(args.out, "concept_names.json"))

    log("done — run scripts/build_figures.py to redraw the release figures from these payloads")


if __name__ == "__main__":
    main()
