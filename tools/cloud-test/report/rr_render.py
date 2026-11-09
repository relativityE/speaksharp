"""rr_render: HTML (self-contained, offline) and CSV rendering for the run comparison report."""
import html
import collections

import rr_core as C

PF = C.PF


def esc(x):
    return html.escape("" if x is None else str(x), quote=True)


CSS = """
:root{--bg:#fbfbf9;--fg:#1c1f23;--mut:#5a6169;--card:#ffffff;--line:#d9dcdf;--acc:#1b4f8a;--accbg:#e8f0f9;
--imp:#14683b;--impbg:#e2f3e8;--reg:#a3231a;--regbg:#fbe7e5;--unc:#3a4047;--uncbg:#eceef0;--inc:#8a5a00;--incbg:#fdf1d6;
--pass:#14683b;--fail:#a3231a;--nr:#5a6169;--code:#f1f2f4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14171a;--fg:#e6e8ea;--mut:#a3aab2;--card:#1c2024;--line:#363c43;--acc:#7fb2ee;--accbg:#1c2b3d;
--imp:#6fd09a;--impbg:#17301f;--reg:#ff9d94;--regbg:#3a1a17;--unc:#c3c8ce;--uncbg:#2a2f35;--inc:#f0c36a;--incbg:#3a2e12;--pass:#6fd09a;--fail:#ff9d94;--nr:#a3aab2;--code:#262b30}}
:root[data-theme="dark"]{--bg:#14171a;--fg:#e6e8ea;--mut:#a3aab2;--card:#1c2024;--line:#363c43;--acc:#7fb2ee;--accbg:#1c2b3d;
--imp:#6fd09a;--impbg:#17301f;--reg:#ff9d94;--regbg:#3a1a17;--unc:#c3c8ce;--uncbg:#2a2f35;--inc:#f0c36a;--incbg:#3a2e12;--pass:#6fd09a;--fail:#ff9d94;--nr:#a3aab2;--code:#262b30}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:12px 16px 64px;overflow-wrap:anywhere}
h1{font-size:1.25rem;margin:8px 0 2px}
h2{font-size:1.15rem;margin:0 0 8px}
h3{font-size:1rem;margin:16px 0 6px}
p{margin:6px 0}
a{color:var(--acc)}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;background:var(--code);padding:0 3px;border-radius:3px;overflow-wrap:anywhere}
.sub{color:var(--mut);font-size:.9rem;margin:0 0 6px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:.85rem;margin:6px 0 10px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;margin:12px 0}
section.lead{border-left:4px solid var(--acc)}
.headline{font-size:1.1rem;font-weight:600;line-height:1.45;margin:4px 0}
.kicker{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:0 0 4px}
.muted{color:var(--mut)}
.small{font-size:.85rem}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}
.tile{border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.tile b{display:block;font-size:1.5rem;line-height:1.1}
.tile.improved{background:var(--impbg)}.tile.regressed{background:var(--regbg)}.tile.unchanged{background:var(--uncbg)}.tile.inconclusive{background:var(--incbg)}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.8rem;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.pill.improved{color:var(--imp);background:var(--impbg)}.pill.regressed{color:var(--reg);background:var(--regbg)}
.pill.unchanged{color:var(--unc);background:var(--uncbg)}.pill.inconclusive{color:var(--inc);background:var(--incbg)}
.pill.no-signal,.pill.no-verdict{color:var(--mut);background:transparent}
.v{font-weight:700;white-space:nowrap}.v.PASS{color:var(--pass)}.v.FAIL{color:var(--fail)}.v.NOTRUN{color:var(--nr)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;color:var(--mut);white-space:nowrap;background:var(--card);position:sticky;top:0}
tr.empty td{color:var(--mut);font-style:italic}
details{margin:6px 0}
summary{cursor:pointer;font-weight:600}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.tools input[type=search],.tools select{font:inherit;font-size:.9rem;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);max-width:100%}
.tools input[type=search]{min-width:220px;flex:1 1 220px}
.tools button{font:inherit;font-size:.9rem;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer}
.tools .count{font-size:.85rem;color:var(--mut)}
ul.tight{margin:4px 0 4px 18px;padding:0}
ul.tight li{margin:2px 0}
.note{border-left:3px solid var(--inc);background:var(--incbg);padding:6px 10px;border-radius:4px;margin:8px 0;font-size:.92rem}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;font-size:.88rem}
.kv dt{color:var(--mut)}.kv dd{margin:0;overflow-wrap:anywhere}
.nw{white-space:nowrap}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:720px){
 .headline{font-size:1rem}
 .tiles{grid-template-columns:repeat(2,1fr)}
 table.cards,table.cards thead,table.cards tbody,table.cards tr,table.cards td{display:block;width:100%}
 table.cards thead{position:absolute;left:-9999px}
 table.cards tr{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:6px 8px}
 table.cards td{border:0;padding:3px 0}
 table.cards td::before{content:attr(data-label);display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:var(--mut)}
 table.cards td:empty{display:none}
 .kv{grid-template-columns:1fr}
}
"""

JS = r"""
(function(){
 function norm(s){return (s||'').toLowerCase();}
 document.querySelectorAll('.tools[data-table]').forEach(function(tools){
  var tbl=document.getElementById(tools.getAttribute('data-table'));
  if(!tbl)return;
  var rows=[].slice.call(tbl.querySelectorAll('tbody tr.r'));
  var empty=tbl.querySelector('tr.empty');
  var q=tools.querySelector('input[type=search]');
  var sels=[].slice.call(tools.querySelectorAll('select[data-key]'));
  var cnt=tools.querySelector('.count');
  function apply(){
   var n=0,needle=norm(q&&q.value);
   rows.forEach(function(r){
    var ok=true;
    sels.forEach(function(s){var v=s.value;if(v!==''&&r.getAttribute('data-'+s.getAttribute('data-key'))!==v)ok=false;});
    if(ok&&needle&&norm(r.textContent).indexOf(needle)<0)ok=false;
    r.hidden=!ok;if(ok)n++;
   });
   if(empty)empty.hidden=n!==0;
   if(cnt)cnt.textContent='Showing '+n+' of '+rows.length;
  }
  if(q)q.addEventListener('input',apply);
  sels.forEach(function(s){s.addEventListener('change',apply);});
  var b=tools.querySelector('button.clear');
  if(b)b.addEventListener('click',function(){if(q)q.value='';sels.forEach(function(s){s.value='';});apply();});
  apply();
 });
})();
"""


import re as _re
_URL = _re.compile(r"https?://\S+")


def plain(t, n=150):
    """Display text for source quotes: URLs are not repeated in the page (they stay in comparison.json and the CSV)."""
    t = _URL.sub("[link omitted]", t or "")
    return t if len(t) <= n else t[:n].rstrip() + "\u2026"


def vspan(v):
    if v is None:
        return '<span class="v NOTRUN">-</span>'
    return '<span class="v %s">%s</span>' % (v.replace(" ", ""), esc(v))


def pill(c):
    label = {"no-signal": "no signal", "no-verdict": "no verdict"}.get(c, c)
    sym = {"improved": "▲ ", "regressed": "▼ ", "unchanged": "= ", "inconclusive": "? "}.get(c, "")
    return '<span class="pill %s">%s%s</span>' % (esc(c), sym, esc(label))


def counts_str(c):
    return "%d / %d / %d" % (c["PASS"], c["FAIL"], c["NOT RUN"])


class Links:
    """Resolve receipt links inside the bundle and remember their sha256."""

    def __init__(self, index):
        self.sha = {e["path"]: e["sha256"] for e in index}

    def a(self, path, text=None, show_sha=True):
        if path not in self.sha:
            return esc(text or path.split("/")[-1]) + ' <span class="muted small">(not in bundle)</span>'
        s = self.sha[path]
        return '<a href="%s" data-sha256="%s">%s</a>%s' % (esc(path), s, esc(text or path.split("/")[-1]), (' <code>%s</code>' % s[:10]) if show_sha else "")


def tools_block(table_id, selects, placeholder="Search this table"):
    parts = ['<div class="tools" data-table="%s"><label class="sr-only" for="%s-q">Search</label><input type="search" id="%s-q" placeholder="%s" aria-label="%s">' % (table_id, table_id, table_id, esc(placeholder), esc(placeholder))]
    for key, label, opts in selects:
        parts.append('<label class="small">%s <select data-key="%s"><option value="">All</option>%s</select></label>' % (
            esc(label), key, "".join('<option value="%s">%s</option>' % (esc(o), esc(o)) for o in opts)))
    parts.append('<button type="button" class="clear">Clear</button><span class="count" aria-live="polite"></span></div>')
    return "".join(parts)


def render_html(data, links, title, generated):
    """data: the comparison dict (comparison.json content) plus 'rows' etc. Returns an HTML string."""
    P, Cn = data["previous"], data["current"]
    pl, cl = P["label"], Cn["label"]
    out = []
    w = out.append
    w('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">')
    w("<title>%s</title><style>%s</style></head><body><div class=\"wrap\">" % (esc(title), CSS))
    w('<header><p class="kicker">SpeakSharp cloud-test comparison · offline report</p><h1>%s against %s</h1>' % (esc(cl), esc(pl)))
    w('<p class="sub">Current run <b>%s</b> (campaign %s, served %s) compared with prior run <b>%s</b> (campaign %s, served %s). Generated %s.</p>' % (
        esc(cl), esc(Cn["campaignId"]), esc(C.short(Cn["servedSha"])), esc(pl), esc(P["campaignId"]), esc(C.short(P["servedSha"])), esc(generated)))
    w('<nav class="toc" aria-label="Sections"><a href="#headline">Headline</a><a href="#validity">Validity</a><a href="#class-counts">Counts</a><a href="#areas">Areas</a>'
      '<a href="#journeys">Journeys</a><a href="#changes">Lost and gained</a><a href="#rules">Rules</a><a href="#breakdown">Outcome classes</a><a href="#cleanup">Cleanup</a>'
      '<a href="#budget">Budget</a><a href="#identity">Identity</a><a href="#assertions">Assertions</a><a href="#requirements">Requirements</a><a href="#receipts">Receipts</a></nav></header>')
    # (a) headline
    w('<section id="headline" class="lead"><p class="kicker">Headline: prior versus current</p><p class="headline" id="headline-sentence">%s</p></section>' % esc(data["headline"]))
    # (b) validity
    V = data["validity"]
    w('<section id="validity"><h2>Is the comparison valid?</h2><p id="validity-statement"><b>%s</b> %s</p>' % (esc(V["verdict"]), esc(V["statement"])))
    w('<div class="scroll"><table class="cards" id="factors"><thead><tr><th>Factor</th><th>%s (prior)</th><th>%s (current)</th><th>Status</th><th>Known as</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for f in V["factors"]:
        det = ('<details><summary class="small">detail</summary><span class="small muted">%s</span></details>' % esc(f["detail"])) if f.get("detail", "").strip() else ""
        w('<tr data-status="%s"><td data-label="Factor">%s%s</td><td data-label="%s (prior)">%s</td><td data-label="%s (current)">%s</td><td data-label="Status"><b>%s</b></td><td data-label="Known as">%s</td></tr>' % (
            esc(f["status"]), esc(f["label"]), det, esc(pl), esc(f["previous"]), esc(cl), esc(f["current"]), esc(f["status"]), esc(f["known"])))
    w("</tbody></table></div>")
    w('<p class="small muted">Backend and deployment state are labelled <b>owner-stated</b> where the run data cannot verify them; only the frontend release is verified by this run\'s counted identity reads.</p></section>')
    # (c) counts
    K = data["classes"]
    w('<section id="class-counts"><h2>Improved, regressed, unchanged, inconclusive</h2>')
    for kind, label in (("areas", "Product areas (%d)" % sum(K["areas"].values())), ("journeys", "Journeys (%d)" % sum(K["journeys"].values()))):
        w('<h3>%s</h3><div class="tiles" id="tiles-%s">' % (esc(label), kind))
        for c in C.CLASSES:
            w('<div class="tile %s" data-class="%s"><b>%d</b>%s</div>' % (c, c, K[kind][c], esc(c)))
        w("</div>")
    w('<p class="small"><b>Inconclusive means not comparable</b>: the two runs cannot be compared like for like on that item (stimulus never happened, observer or capture binding changed, row omitted by design or stopped by an allowance, coverage lost, or an original receipt missing). It is not a failure and not an improvement. <a href="#rules">How each class is decided</a>.</p>')
    D = data["denominators"]
    w('<h3>Three separate denominators</h3><div class="scroll"><table class="cards" id="denominators"><thead><tr><th>Counted unit</th><th>Total</th><th>%s PASS / FAIL / NOT RUN</th><th>%s PASS / FAIL / NOT RUN</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for key, label in (("requirements", "Requirement rows"), ("journeys", "Journeys"), ("assertions", "Assertions")):
        d = D[key]
        w('<tr><td data-label="Counted unit">%s</td><td data-label="Total">%d</td><td data-label="%s">%s</td><td data-label="%s">%s</td></tr>' % (
            esc(label), d["total"], esc(pl), counts_str(d["previous"]), esc(cl), counts_str(d["current"])))
    w('</tbody></table></div><p class="small muted">A journey verdict, a requirement-row verdict and an assertion verdict are different units. They are never added together and none of them is a software-quality score.</p>')
    w('<h3>What happened to the %d prior FAIL assertions</h3><div class="scroll"><table class="cards" id="fail-fates"><thead><tr><th>Assertion row</th><th>Prior</th><th>Current</th><th>Fate</th></tr></thead><tbody>' % len(data["prior_fail_fates"]))
    for f in data["prior_fail_fates"]:
        w('<tr><td data-label="Assertion row"><code>%s</code></td><td data-label="Prior">%s</td><td data-label="Current">%s</td><td data-label="Fate">%s</td></tr>' % (esc(f["key"]), vspan("FAIL"), vspan(f["cur"]), esc(f["fate"])))
    w("</tbody></table></div></section>")
    # (d) areas
    w('<section id="areas"><h2>The seven product areas</h2>')
    w('<p class="note" id="coverage-note">%s</p>' % esc(data["coverage_note"]))
    w('<div class="scroll"><table class="cards" id="areas-table"><thead><tr><th>Area</th><th>Class</th><th>Why</th><th>Journeys involved</th><th>Requirement rows with a verdict in either run</th><th>Evidence</th></tr></thead><tbody>')
    for a in data["areas"]:
        rows = ", ".join("%s %s&rarr;%s" % (esc(r["id"]), esc(r["prev"] or "-"), esc(r["cur"])) for r in a["rows"] if r["has_verdict"]) or "none (0 of %d rows)" % a["n_rows"]
        jr = []
        for j in a["journeys"]:
            jr.append('<a href="#j-%s">%s</a>' % (esc(j), esc(j)))
        rel = ", ".join('<a href="#j-%s">%s</a>' % (esc(j), esc(j)) for j in a["related_journeys"])
        ev = []
        for j in a["journeys"]:
            jd = next((x for x in data["journeys"] if x["id"] == j), None)
            if jd and (jd["prev_counts"]["total"] and any(r["has_verdict"] for r in a["rows"] if r["id"] == j)):
                ev.append('<span class="nw">%s</span>' % links.a("receipts/previous-%s/cases/%s/case-result.json" % (pl, j), "%s %s" % (pl, j), False))
                ev.append('<span class="nw">%s</span>' % links.a("receipts/current-%s/cases/%s/case-result.json" % (cl, j), "%s %s" % (cl, j), False))
        w('<tr id="area-%s" data-class="%s"><td data-label="Area"><b>%s</b> %s</td><td data-label="Class">%s</td><td data-label="Why">%s</td><td data-label="Journeys involved">%s%s</td><td data-label="Requirement rows with a verdict in either run">%s<br><span class="muted small">%d of %d rows</span></td><td data-label="Evidence">%s</td></tr>' % (
            esc(a["id"]), esc(a["class"]), esc(a["id"]), esc(a["name"] or ""), pill(a["class"]), esc(a["why"]),
            ", ".join(jr) if jr else '<span class="muted">none scored</span>',
            ('<br><span class="muted small">related only (not scored): %s</span>' % rel) if rel else "", rows, a["verdict_rows"], a["n_rows"], " ".join(ev) or '<span class="muted">no verdict rows</span>'))
    w("</tbody></table></div><p class=\"small muted\">%s</p></section>" % esc(data["area_mapping_note"]))
    # (e) journeys
    w('<section id="journeys"><h2>One 15-journey comparison</h2>')
    w(tools_block("journeys-table", [("class", "Class", list(C.CLASSES)), ("validity", "Validity", ["valid", "not comparable"])], "Search journeys"))
    w('<div class="scroll"><table class="cards" id="journeys-table"><thead><tr><th>Journey</th><th>Areas</th><th>%s result</th><th>%s result</th><th>Assertions P / F / NR (%s &rarr; %s)</th><th>Class</th><th>Validity</th><th>Why, and what changed</th></tr></thead><tbody>' % (esc(pl), esc(cl), esc(pl), esc(cl)))
    for j in data["journeys"]:
        areas = esc(j["primary_area"] or "")
        if j["related_areas"]:
            areas += '<br><span class="muted small">also: %s</span>' % esc(", ".join(j["related_areas"]))
        sig = ""
        if j["unresolved"]:
            sig = '<br><span class="muted small">unresolved: no behavioural verdict in either run</span>'
        elif j["disputed_rows"]:
            sig = '<br><span class="muted small">disputed oracle, not scored</span>'
        chg = []
        for r in data["changes"]:
            if r["case"] == j["id"]:
                chg.append('<li><code>%s</code> %s&rarr;%s: %s</li>' % (esc(r["id"]), esc(r["prev"]), esc(r["cur"]), esc(r["reason_code"])))
        det = ""
        if chg:
            det = '<details><summary>%d changed assertion%s</summary><ul class="tight">%s</ul></details>' % (len(chg), "" if len(chg) == 1 else "s", "".join(chg))
        w('<tr class="r" id="j-%s" data-class="%s" data-validity="%s"><td data-label="Journey"><b>%s</b> %s</td><td data-label="Areas">%s</td><td data-label="%s result">%s</td><td data-label="%s result">%s</td><td data-label="Assertions">%s &rarr; %s</td><td data-label="Class">%s%s</td><td data-label="Validity">%s</td><td data-label="Why">%s%s</td></tr>' % (
            esc(j["id"]), esc(j["class"]), esc(j["validity"]), esc(j["id"]), esc(plain(j["title"], 80)), areas, esc(pl), vspan(j["prev"]), esc(cl), vspan(j["cur"]),
            counts_str(j["prev_counts"]), counts_str(j["cur_counts"]), pill(j["class"]), sig, esc(j["validity"]),
            esc(j["why"]), det))
    w('<tr class="empty" hidden><td colspan="8">No journey matches the filters.</td></tr></tbody></table></div>')
    w('<h3 id="changes">Every lost, gained or changed assertion (%d)</h3><p class="small muted">%s</p>' % (len(data["changes"]), esc(data["changes_note"])))
    w(tools_block("changes-table", [("kind", "Change", ["lost", "gained", "changed"]), ("reason", "Reason", sorted({r["reason_code"] for r in data["changes"]})), ("case", "Journey", sorted({r["case"] for r in data["changes"]}))], "Search changed rows"))
    w('<div class="scroll"><table class="cards" id="changes-table"><thead><tr><th>Row</th><th>%s</th><th>%s</th><th>Change</th><th>Reason</th><th>Class</th><th>Why it is not a product verdict</th><th>Evidence</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for r in data["changes"]:
        ev = []
        for rk, role, lab, refs in (("prev", "previous-" + pl, pl, r["prev_refs"]), ("cur", "current-" + cl, cl, r["cur_refs"])):
            for ref in refs:
                ev.append(links.a("receipts/%s/cases/%s/%s" % (role, r["case"], ref), "%s %s" % (lab, ref), False))
        w('<tr class="r" data-kind="%s" data-reason="%s" data-case="%s"><td data-label="Row"><code>%s</code></td><td data-label="%s">%s</td><td data-label="%s">%s</td><td data-label="Change">%s</td><td data-label="Reason"><b>%s</b></td><td data-label="Class">%s</td><td data-label="Why">%s<br><span class="muted small">%s</span></td><td data-label="Evidence">%s</td></tr>' % (
            esc(r["kind"]), esc(r["reason_code"]), esc(r["case"]), esc(r["key"]), esc(pl), vspan(r["prev"]), esc(cl), vspan(r["cur"]), esc(r["kind"]), esc(r["reason_code"]), pill(r["class"]),
            esc(r["reason_text"]), esc("; ".join("%s: %s" % (g["code"], g["text"]) for g in r["reasons"])), "<br>".join(ev)))
    w('<tr class="empty" hidden><td colspan="8">No changed row matches the filters.</td></tr></tbody></table></div></section>')
    # rules
    w('<section id="rules"><h2>How classes are decided</h2><ul class="tight">')
    for name, text in data["rules_text"]:
        w("<li><b>%s.</b> %s</li>" % (esc(name), esc(text)))
    w("</ul><details><summary>Constants used</summary><dl class=\"kv\">")
    for k, v in data["policy_constants"].items():
        w("<dt>%s</dt><dd>%s</dd>" % (esc(k), esc(v)))
    w("</dl></details><details><summary>Mutation switches active in this build</summary><p class=\"small\">%s</p></details></section>" % esc(data["rules_active"]))
    # outcome breakdown
    w('<section id="breakdown"><h2>Outcome classes: product, harness, missing evidence, omitted, setup-blocked, allowance</h2><p class="small muted">Every assertion of each run is in exactly one row, so each column adds to the assertion denominator. Causes come from the receipts (evidence facts, interruption records); FAIL classification comes from the analyst overlay and is shown as unclassified when none is given.</p>')
    w('<div class="scroll"><table class="cards" id="breakdown-table"><thead><tr><th>Outcome class</th><th>%s</th><th>%s</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for b in data["breakdown"]["order"]:
        w('<tr><td data-label="Outcome class">%s</td><td data-label="%s">%d</td><td data-label="%s">%d</td></tr>' % (esc(b), esc(pl), data["breakdown"]["previous"].get(b, 0), esc(cl), data["breakdown"]["current"].get(b, 0)))
    w('<tr><td data-label="Outcome class"><b>Total assertions</b></td><td data-label="%s"><b>%d</b></td><td data-label="%s"><b>%d</b></td></tr></tbody></table></div>' % (esc(pl), sum(data["breakdown"]["previous"].values()), esc(cl), sum(data["breakdown"]["current"].values())))
    w('<h3>Observed backend signals (guard log)</h3><div class="scroll"><table class="cards"><thead><tr><th>Signal</th><th>%s</th><th>%s</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for s in data["signals"]:
        w('<tr><td data-label="Signal">%s</td><td data-label="%s">%s</td><td data-label="%s">%s</td></tr>' % (esc(s["label"]), esc(pl), esc(s["previous"]), esc(cl), esc(s["current"])))
    w("</tbody></table></div></section>")
    # cleanup
    w('<section id="cleanup"><h2>Cleanup receipts</h2>')
    cu = data["cleanup"]
    w('<p>%s</p><div class="scroll"><table class="cards" id="cleanup-table"><thead><tr><th>Journey</th><th>%s exit / stop / processes left / ended</th><th>%s exit / stop / processes left / ended</th></tr></thead><tbody>' % (esc(cu["statement"]), esc(pl), esc(cl)))
    for row in cu["rows"]:
        def cell(x):
            if not x:
                return "-"
            return "exit %s · %s · %s left · %s" % (x["exitCode"], x["reason"], x["owned_left"], x["endedAt"])
        w('<tr><td data-label="Journey">%s</td><td data-label="%s">%s</td><td data-label="%s">%s</td></tr>' % (esc(row["case"]), esc(pl), esc(cell(row["previous"])), esc(cl), esc(cell(row["current"]))))
    w("</tbody></table></div></section>")
    # budget
    w('<section id="budget"><h2>Budget receipts</h2><p>%s</p><div class="scroll"><table class="cards" id="budget-table"><thead><tr><th>Journey</th><th>%s requests used / planned / allowance</th><th>%s requests used / planned / allowance</th><th>Starts used/limit, takes used/limit (%s &rarr; %s)</th><th>Identity reads before &rarr; after (%s / %s)</th></tr></thead><tbody>' % (
        esc(data["budget"]["statement"]), esc(pl), esc(cl), esc(pl), esc(cl), esc(pl), esc(cl)))
    for row in data["budget"]["rows"]:
        def rq(b):
            if not b:
                return "-"
            return "%s / %s / %s%s" % (b["requests_used"], b["planned"] if b["planned"] is not None else "n/a", b["allowance"] if b["allowance"] is not None else "n/a", " (allowance exhausted)" if b["allowance_exhausted"] else "")
        def sl(b):
            if not b:
                return "-"
            return "S %s/%s T %s/%s" % (b["start_presses"], b["start_limit"], b["take_attempts"], b["take_limit"])
        def idr(b):
            if not b:
                return "-"
            return "%s→%s" % (b["identity_gets_before"], b["identity_gets_after"])
        w('<tr><td data-label="Journey">%s</td><td data-label="%s">%s</td><td data-label="%s">%s</td><td data-label="Starts and takes">%s &rarr; %s</td><td data-label="Identity reads">%s / %s</td></tr>' % (
            esc(row["case"]), esc(pl), esc(rq(row["previous"])), esc(cl), esc(rq(row["current"])), esc(sl(row["previous"])), esc(sl(row["current"])), esc(idr(row["previous"])), esc(idr(row["current"]))))
    w('</tbody></table></div><h3>Run totals</h3><div class="scroll"><table class="cards"><thead><tr><th>Total</th><th>%s</th><th>%s</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for t in data["budget"]["totals"]:
        w('<tr><td data-label="Total">%s</td><td data-label="%s">%s</td><td data-label="%s">%s</td></tr>' % (esc(t["label"]), esc(pl), esc(t["previous"]), esc(cl), esc(t["current"])))
    w("</tbody></table></div></section>")
    # identity binding
    w('<section id="identity"><h2>Identity binding</h2><p class="small muted">%s</p>' % esc(data["identity_binding"]["note"]))
    for role in ("previous", "current"):
        ib = data["identity_binding"][role]
        lab = pl if role == "previous" else cl
        w('<h3>%s (%s)</h3><dl class="kv">' % (esc(lab), role))
        for k, v in ib["facts"]:
            w("<dt>%s</dt><dd>%s</dd>" % (esc(k), v if k.endswith("(html)") else esc(v)))
        w("</dl>")
        w('<details><summary>Binding checks (%d)</summary><ul class="tight">' % len(ib["checks"]))
        for c in ib["checks"]:
            w("<li>%s <b>%s</b> <span class=\"muted small\">%s</span></li>" % (esc(c["name"]), "PASS" if c["ok"] else "FAIL", esc(c["detail"])))
        w("</ul></details>")
        w('<details><summary>Per-journey driver, config and media hashes</summary><div class="scroll"><table class="cards"><thead><tr><th>Journey</th><th>Driver sha256</th><th>Config sha256</th><th>Media sha256 (plan)</th><th>Guard media records</th><th>Original case-result sha256</th></tr></thead><tbody>')
        for r in ib["per_case"]:
            w('<tr><td data-label="Journey">%s</td><td data-label="Driver"><code>%s</code></td><td data-label="Config"><code>%s</code></td><td data-label="Media">%s</td><td data-label="Guard media records">%s</td><td data-label="Case result">%s</td></tr>' % (
                esc(r["case"]), esc(r["driver"]), esc(r["config"]), ("<code>%s</code>" % esc(r["media"])) if r["media"] else "none bound", esc(r["guard_media"]), links.a(r["case_result_path"], r["case_result_sha"][:12], False)))
        w("</tbody></table></div></details>")
    w("</section>")
    # assertions table
    rows = data["rows"]
    w('<section id="assertions"><h2>All %d assertions</h2>' % len(rows))
    w(tools_block("assertions-table", [("case", "Journey", sorted({r["case"] for r in rows})), ("prev", "Prior", list(C.VERDICTS)), ("cur", "Current", list(C.VERDICTS)),
                                       ("kind", "Change", ["same", "lost", "gained", "changed"]), ("class", "Class", ["improved", "regressed", "unchanged", "inconclusive", "no-signal"])], "Search assertions, ids, reasons"))
    w('<div class="scroll"><table class="cards" id="assertions-table"><thead><tr><th>Row</th><th>%s</th><th>%s</th><th>Change</th><th>Class</th><th>Cause of NOT RUN / note</th><th>Evidence</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for r in rows:
        note = []
        if r["cur"] == "NOT RUN" and r["cur_cause"]:
            note.append("%s: %s" % (cl, r["cur_cause"]["text"]))
        if r["prev"] == "NOT RUN" and r["prev_cause"]:
            note.append("%s: %s" % (pl, r["prev_cause"]["text"]))
        for rk in ("previous", "current"):
            fc = r["fail_class"].get(rk)
            if fc:
                note.append("%s FAIL class: %s%s" % (pl if rk == "previous" else cl, fc["class"], (" (%s)" % fc["note"]) if fc.get("note") else ""))
        note += r["flags"]
        if r["kind"] != "same":
            note.append(r["reason_text"] or "")
        ev = []
        for lab, role, refs in ((pl, "previous-" + pl, r["prev_refs"]), (cl, "current-" + cl, r["cur_refs"])):
            for ref in refs:
                ev.append(links.a("receipts/%s/cases/%s/%s" % (role, r["case"], ref), "%s %s" % (lab, ref), False))
        w('<tr class="r" data-case="%s" data-prev="%s" data-cur="%s" data-kind="%s" data-class="%s"><td data-label="Row"><code>%s</code></td><td data-label="%s">%s</td><td data-label="%s">%s</td><td data-label="Change">%s</td><td data-label="Class">%s</td><td data-label="Note">%s</td><td data-label="Evidence">%s</td></tr>' % (
            esc(r["case"]), esc(r["prev"] or ""), esc(r["cur"] or ""), esc(r["kind"]), esc(r["class"]), esc(r["key"]), esc(pl), vspan(r["prev"]), esc(cl), vspan(r["cur"]), esc(r["kind"]), pill(r["class"]), esc("; ".join(n for n in note if n)), "<br>".join(ev)))
    w('<tr class="empty" hidden><td colspan="7">No assertion matches the filters.</td></tr></tbody></table></div></section>')
    # requirements table
    req = data["requirement_rows"]
    w('<section id="requirements"><h2>All %d requirement rows</h2><p class="small muted">%s</p>' % (len(req), esc(data["requirement_note"])))
    w(tools_block("requirements-table", [("area", "Area", sorted({r["category"] or "" for r in req})), ("prev", "Prior", list(C.VERDICTS)), ("cur", "Current", list(C.VERDICTS)), ("class", "Class", ["improved", "regressed", "unchanged", "inconclusive", "no-verdict"])], "Search requirement rows"))
    w('<div class="scroll"><table class="cards" id="requirements-table"><thead><tr><th>Requirement row</th><th>Area</th><th>%s</th><th>%s</th><th>Class</th><th>Basis</th></tr></thead><tbody>' % (esc(pl), esc(cl)))
    for r in req:
        w('<tr class="r" data-area="%s" data-prev="%s" data-cur="%s" data-class="%s"><td data-label="Requirement row"><code>%s</code> %s</td><td data-label="Area">%s</td><td data-label="%s">%s</td><td data-label="%s">%s</td><td data-label="Class">%s</td><td data-label="Basis">%s</td></tr>' % (
            esc(r["category"] or ""), esc(r["prev"] or ""), esc(r["cur"] or ""), esc(r["class"]), esc(r["id"]), esc(plain(r["title"])), esc(r["category"] or ""), esc(pl), vspan(r["prev"]), esc(cl), vspan(r["cur"]), pill(r["class"]), esc(r["basis"])))
    w('<tr class="empty" hidden><td colspan="6">No requirement row matches the filters.</td></tr></tbody></table></div></section>')
    # receipts
    w('<section id="receipts"><h2>Original receipts in this bundle</h2><p class="small muted">%s</p>' % esc(data["receipts"]["note"]))
    w('<div class="scroll"><table class="cards" id="receipts-table"><thead><tr><th>Campaign-level file</th><th>Run</th><th>sha256</th></tr></thead><tbody>')
    for e in data["receipts"]["campaign_files"]:
        w('<tr><td data-label="File">%s</td><td data-label="Run">%s</td><td data-label="sha256"><code>%s</code></td></tr>' % (links.a(e["path"], e["path"].split("receipts/")[1], False), esc(e["run"]), esc(e["sha256"])))
    w("</tbody></table></div>")
    if data["receipts"]["problems"]:
        w('<div class="note"><b>Receipt problems found while loading:</b><ul class="tight">%s</ul></div>' % "".join("<li>%s</li>" % esc(p) for p in data["receipts"]["problems"]))
    if data["receipts"]["supplemented"]:
        w('<div class="note"><b>Supplemented evidence:</b> %s</div>' % esc(data["receipts"]["supplemented_note"]))
    w('<p class="small">Per-journey receipts (case-result.json, evidence files, sanitized summary, guard-derived counts, source hashes) are under <code>receipts/previous-%s/cases/</code> and <code>receipts/current-%s/cases/</code>; every file and its sha256 is in <a href="MANIFEST.json" data-sha256="">MANIFEST.json</a>. Raw guard logs, browser sandbox files and TLS material are not copied.</p></section>' % (esc(pl), esc(cl)))
    w('<p class="small muted">Generated by build_run_report.py. No network request is made by this page or by the generator.</p>')
    w("</div><script>%s</script></body></html>" % JS)
    return "".join(out)
