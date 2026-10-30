// tests/cpp/test_mermaid.cpp — host unit tests for src/cpp/mermaid (flowchart parser, layered layout, SVG).
// Standard library only; a minimal runner like the other tests here.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "mermaid/layered.h"
#include "mermaid/mermaid.h"

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& name) {
    if (ok) {
        ++g_pass;
    } else {
        ++g_fail;
        std::printf("FAIL %s\n", name.c_str());
    }
}

int count(const std::string& hay, const std::string& needle) {
    int n = 0;
    for (size_t p = hay.find(needle); p != std::string::npos; p = hay.find(needle, p + needle.size())) n++;
    return n;
}

bool render(const std::string& src, std::string& svg, std::string& err) {
    mermaid::Options o;
    return mermaid::render(src, o, svg, err);
}

std::string svg_of(const std::string& src) {
    std::string svg, err;
    if (!render(src, svg, err)) return "ERROR: " + err;
    return svg;
}

bool has(const std::string& hay, const std::string& needle) { return hay.find(needle) != std::string::npos; }

using mermaid::Direction;
using mermaid::LayoutEdge;
using mermaid::LayoutNode;

LayoutNode box(double w, double h) {
    LayoutNode n;
    n.w = w;
    n.h = h;
    return n;
}

LayoutEdge edge(int a, int b) {
    LayoutEdge e;
    e.from = a;
    e.to = b;
    return e;
}

}  // namespace

int main() {
    // --- parsing: edges and their variants ---
    check(count(svg_of("graph TD\nA-->B"), "class=\"edge\"") == 1, "edge/basic");
    check(count(svg_of("graph TD\nA-->B-->C"), "class=\"edge\"") == 2, "edge/chain");
    check(count(svg_of("graph TD\nA & B --> C & D"), "class=\"edge\"") == 4, "edge/groups");
    check(count(svg_of("graph TD\nA---B"), "<polygon") == 0, "edge/open_has_no_arrow");
    check(count(svg_of("graph TD\nA-->B"), "<polygon") == 1, "edge/arrow_head");
    check(count(svg_of("graph TD\nA<-->B"), "<polygon") == 2, "edge/both_arrows");
    check(has(svg_of("graph TD\nA-.->B"), "stroke-dasharray=\"4 4\""), "edge/dotted");
    check(has(svg_of("graph TD\nA==>B"), "stroke-width=\"2.5\""), "edge/thick");
    check(has(svg_of("graph TD\nA-->|yes|B"), ">yes<"), "edge/pipe_label");
    check(has(svg_of("graph TD\nA-- some text -->B"), ">some text<"), "edge/inline_label");
    check(count(svg_of("graph TD\nA~~~B"), "class=\"edge\"") == 0, "edge/invisible");
    check(count(svg_of("graph LR\nA-->B;B-->C"), "class=\"edge\"") == 2, "edge/semicolon");

    // --- nodes: shapes and labels ---
    check(has(svg_of("graph TD\nA((round))"), "<circle"), "shape/circle");
    check(has(svg_of("graph TD\nA{choice}"), "<polygon"), "shape/diamond");
    check(has(svg_of("graph TD\nA[(db)]"), "<path"), "shape/cylinder");
    check(has(svg_of("graph TD\nA([pill])"), "rx="), "shape/stadium");
    check(has(svg_of("graph TD\nA[\"quoted [text]\"]"), ">quoted [text]<"), "node/quoted_label");
    check(has(svg_of("graph TD\nA[line one<br/>line two]"), ">line two<"), "node/br_break");
    check(has(svg_of("graph TD\nA[a\xe6\x97\xa5\xe6\x9c\xac]-->B"), ">a\xe6\x97\xa5\xe6\x9c\xac<"), "node/cjk_label");
    check(count(svg_of("graph TD\nA[x] --> A"), "<g class=\"node\">") == 1, "node/redeclared_is_one_node");
    check(has(svg_of("graph TD\nA-->B\nstyle A fill:#ff0000"), "#ff0000"), "style/node_fill");
    check(has(svg_of("graph TD\nclassDef hot fill:#00ff00\nA:::hot-->B"), "#00ff00"), "style/class_def");
    check(has(svg_of("graph TD\nsubgraph one [First]\nA-->B\nend"), "class=\"subgraph\""), "subgraph/frame");
    check(has(svg_of("graph TD\nsubgraph one [First]\nA-->B\nend"), ">First<"), "subgraph/title");

    // --- errors ---
    {
        std::string svg, err;
        check(!render("gitGraph", svg, err) && has(err, "unsupported"), "error/unsupported");
        check(!render("", svg, err), "error/empty");
        check(!render("graph TD\nA -->", svg, err), "error/dangling_edge");
    }

    // --- layout ---
    {
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::TD);
        check(r.center[1].y > r.center[0].y + 30, "layout/td_goes_down");
        check(std::fabs(r.center[1].x - r.center[0].x) < 0.5, "layout/td_aligned");
        check(r.points[0].size() == 2, "layout/straight_edge_has_two_points");
        auto lr = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::LR);
        check(lr.center[1].x > lr.center[0].x + 60, "layout/lr_goes_right");
        auto bt = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::BT);
        check(bt.center[1].y < bt.center[0].y - 30, "layout/bt_goes_up");
        auto rl = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::RL);
        check(rl.center[1].x < rl.center[0].x - 60, "layout/rl_goes_left");
        check(r.center[0].x - 30 >= -0.01 && r.center[0].y - 15 >= -0.01, "layout/origin_is_top_left");
    }
    {
        // a -> b -> c and a -> c: the long edge must not run through b
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {edge(0, 1), edge(1, 2), edge(0, 2)}, Direction::TD);
        bool through = false;
        double bl = r.center[1].x - 30, br = r.center[1].x + 30, bt = r.center[1].y - 15, bb = r.center[1].y + 15;
        const auto& pts = r.points[2];
        for (size_t i = 0; i + 1 < pts.size(); i++) {
            double x = pts[i].x, y0 = std::min(pts[i].y, pts[i + 1].y), y1 = std::max(pts[i].y, pts[i + 1].y);
            if (std::fabs(pts[i].x - pts[i + 1].x) < 0.01 && x > bl && x < br && y1 > bt && y0 < bb) through = true;
        }
        check(!through, "layout/long_edge_avoids_node");
        check(r.center[2].y > r.center[1].y && r.center[1].y > r.center[0].y, "layout/three_layers");
    }
    {
        // a cycle: every edge is routed, the layout terminates, the nodes get different layers
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {edge(0, 1), edge(1, 2), edge(2, 0)}, Direction::TD);
        check(r.points[2].size() >= 2, "layout/cycle_edge_routed");
        check(r.center[0].y != r.center[2].y, "layout/cycle_layers");
        // the reversed edge still runs from its `from` node to its `to` node
        check(std::fabs(r.points[2].front().y - r.center[2].y) < 40 && std::fabs(r.points[2].back().y - r.center[0].y) < 40,
              "layout/cycle_edge_direction");
    }
    {
        auto r = mermaid::layout_layered({box(60, 30)}, {edge(0, 0)}, Direction::TD);
        check(r.points[0].size() == 4, "layout/self_loop");
        // siblings do not overlap
        auto s = mermaid::layout_layered({box(60, 30), box(80, 30), box(70, 30)}, {edge(0, 1), edge(0, 2)}, Direction::TD);
        check(std::fabs(s.center[1].x - s.center[2].x) >= (80 + 70) / 2.0, "layout/siblings_do_not_overlap");
        check(std::fabs(s.center[0].x - (s.center[1].x + s.center[2].x) / 2) < 30, "layout/parent_between_children");
    }
    {
        LayoutEdge e = edge(0, 1);
        e.label_w = 40;
        e.label_h = 30;
        auto lab = mermaid::layout_layered({box(60, 30), box(60, 30)}, {e}, Direction::TD);
        auto plain = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::TD);
        check(lab.center[1].y - lab.center[0].y > plain.center[1].y - plain.center[0].y + 29, "layout/label_gets_room");
    }
    {
        // a group keeps its members together, and nodes outside it stay out of its box
        std::vector<LayoutNode> ns(6, box(60, 30));
        ns[1].group = ns[2].group = ns[4].group = 0;
        auto r = mermaid::layout_layered(ns, {edge(0, 1), edge(0, 2), edge(0, 3), edge(1, 4), edge(3, 5), edge(2, 4)}, Direction::TD, {-1});
        double x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (int v : {1, 2, 4}) {
            x0 = std::min(x0, r.center[v].x - 30);
            x1 = std::max(x1, r.center[v].x + 30);
            y0 = std::min(y0, r.center[v].y - 15);
            y1 = std::max(y1, r.center[v].y + 15);
        }
        for (int v : {0, 3, 5}) {
            bool inside = r.center[v].x + 30 > x0 && r.center[v].x - 30 < x1 && r.center[v].y + 15 > y0 && r.center[v].y - 15 < y1;
            check(!inside, "layout/group_excludes_outsiders_" + std::to_string(v));
        }
    }
    {
        // labels in the same gap do not overlap
        LayoutEdge e1 = edge(0, 1), e2 = edge(0, 2);
        e1.label_w = e2.label_w = 80;
        e1.label_h = e2.label_h = 24;
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {e1, e2}, Direction::TD);
        double dx = std::fabs(r.label_center[0].x - r.label_center[1].x), dy = std::fabs(r.label_center[0].y - r.label_center[1].y);
        check(dx >= 80 || dy >= 24, "layout/labels_do_not_overlap");
    }
    {
        check(has(svg_of("graph TD\nA[\"a < b & c\"]"), "a &lt; b &amp; c"), "svg/escapes_text");
        std::string svg = svg_of("graph TD\nA-->B");
        check(!has(svg, "var(") && !has(svg, "color-mix"), "svg/plain_colours_only");
    }

    // --- sequence diagrams ---
    {
        const std::string seq = "sequenceDiagram\nparticipant A as Alice\nA->>B: hello\nB-->>A: back\n";
        std::string svg = svg_of(seq);
        check(has(svg, ">Alice<") && has(svg, ">B<"), "sequence/participants");
        check(count(svg, "<polygon") == 2, "sequence/arrow_heads");
        check(has(svg, ">hello<") && has(svg, "stroke-dasharray=\"6 4\""), "sequence/labels_and_dashed_reply");
        check(count(svg, ">Alice<") == 2, "sequence/boxes_top_and_bottom");
        check(count(svg_of("sequenceDiagram\nA->B: x"), "<polygon") == 0, "sequence/open_arrow_has_no_head");
        check(count(svg_of("sequenceDiagram\nA-xB: x"), "<line") >= 4, "sequence/cross");
        check(has(svg_of("sequenceDiagram\nA->>A: self"), "<polyline"), "sequence/self_message");
        check(has(svg_of("sequenceDiagram\nautonumber\nA->>B: x\nB->>A: y"), ">2. y<"), "sequence/autonumber");
        check(has(svg_of("sequenceDiagram\nA->>+B: x\nB-->>-A: y"), "width=\"8\""), "sequence/activation_bar");
        check(has(svg_of("sequenceDiagram\nNote over A,B: careful\nA->>B: x"), ">careful<"), "sequence/note");
        std::string blk = svg_of("sequenceDiagram\nloop every day\nA->>B: x\nalt ok\nB->>A: y\nelse bad\nB->>A: z\nend\nend");
        check(has(blk, ">loop<") && has(blk, ">[every day]<") && has(blk, ">alt<") && has(blk, ">[bad]<"), "sequence/blocks");
        check(has(svg_of("sequenceDiagram\nA->>B: \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "sequence/cjk");
        check(!has(blk, "var(") && !has(blk, "color-mix"), "sequence/plain_colours_only");
        std::string e1, e2;
        check(!render("sequenceDiagram\nend", e1, e2) && has(e2, "without a block"), "sequence/error_stray_end");
        check(!render("sequenceDiagram", e1, e2), "sequence/error_empty");
    }

    // --- state diagrams ---
    {
        std::string s = svg_of("stateDiagram-v2\n[*] --> Idle\nIdle --> Busy : start\nBusy --> [*]");
        check(count(s, "class=\"node\"") == 4, "state/nodes");
        check(count(s, "class=\"edge\"") == 3 && has(s, ">start<"), "state/edges_and_label");
        check(has(s, ">Idle<") && has(s, ">Busy<"), "state/names");
        check(has(svg_of("stateDiagram\nstate \"Long name\" as L\n[*] --> L"), ">Long name<"), "state/alias");
        check(has(svg_of("stateDiagram-v2\nA : first\nA : second"), ">second<"), "state/description");
        check(has(svg_of("stateDiagram-v2\nstate X {\n[*] --> In\n}\n[*] --> X"), "class=\"composite\""), "state/composite");
        check(has(svg_of("stateDiagram-v2\nstate c <<choice>>\nA --> c\nc --> B"), "<polygon points"), "state/choice");
        check(has(svg_of("stateDiagram-v2\ndirection LR\nA --> B"), "<svg"), "state/direction");
        check(has(svg_of("stateDiagram-v2\nA --> B : \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "state/cjk");
        std::string e1, e2;
        check(!render("stateDiagram-v2\nstate X {\nA --> B", e1, e2), "state/error_unclosed");
        check(!render("stateDiagram-v2", e1, e2), "state/error_empty");
    }

    // --- class diagrams ---
    {
        std::string s = svg_of("classDiagram\nclass Animal {\n  +String name\n  +eat() void\n}\nAnimal <|-- Dog\nDog : +bark()");
        check(count(s, "class=\"node\"") == 2, "class/nodes");
        check(has(s, ">+String name<") && has(s, ">+eat() void<") && has(s, ">+bark()<"), "class/members");
        check(count(s, "class=\"edge\"") == 1 && has(s, "<polygon"), "class/inheritance_triangle");
        check(has(svg_of("classDiagram\nA *-- B"), "<polygon") && has(svg_of("classDiagram\nA o-- B"), "<polygon"), "class/diamonds");
        check(has(svg_of("classDiagram\nA ..> B"), "stroke-dasharray=\"5 4\""), "class/dashed");
        check(has(svg_of("classDiagram\nA \"1\" --> \"*\" B : owns"), ">owns<") && has(svg_of("classDiagram\nA \"1\" --> \"*\" B"), ">*<"), "class/label_and_cardinality");
        check(has(svg_of("classDiagram\nclass I\n<<interface>> I"), ">&lt;&lt;interface&gt;&gt;<"), "class/annotation");
        check(has(svg_of("classDiagram\nA --|> B"), "<polygon"), "class/marker_at_end");
        check(has(svg_of("classDiagram\nclass \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "class/cjk");
        std::string e1, e2;
        check(!render("classDiagram\nclass A {\n+x", e1, e2), "class/error_unclosed");
        check(!render("classDiagram\nnonsense here", e1, e2), "class/error_unrecognised");
    }

    // --- ER diagrams ---
    {
        std::string s = svg_of("erDiagram\nCUSTOMER ||--o{ ORDER : places\nCUSTOMER {\n  string name PK\n  string email UK \"login\"\n}");
        check(count(s, "class=\"node\"") == 2, "er/entities");
        check(count(s, "class=\"edge\"") == 1 && has(s, ">places<"), "er/relation_and_label");
        check(has(s, ">name<") && has(s, ">email<") && has(s, ">string<") && has(s, ">PK<") && has(s, ">UK<"), "er/attributes");
        check(has(s, "<circle") && count(s, "<line") >= 5, "er/crows_foot");
        check(has(svg_of("erDiagram\nA ||..|{ B : x"), "stroke-dasharray=\"5 4\""), "er/non_identifying_dashed");
        check(has(svg_of("erDiagram\nA }|--|| B"), "<line"), "er/many_to_one");
        check(has(svg_of("erDiagram\nA |o--o| B"), "<circle"), "er/zero_or_one");
        check(has(svg_of("erDiagram\nA[\"Alias\"] ||--|| B"), ">Alias<"), "er/alias");
        check(has(svg_of("erDiagram\nA ||--|| B : \"\xe6\x97\xa5\xe6\x9c\xac\""), ">\xe6\x97\xa5\xe6\x9c\xac<"), "er/cjk_label");
        std::string e1, e2;
        check(!render("erDiagram\nA {\nstring", e1, e2), "er/error_unclosed");
        check(!render("erDiagram\nA xx--|| B", e1, e2), "er/error_unknown_cardinality");
        check(!render("erDiagram", e1, e2), "er/error_empty");
    }

    // --- xychart ---
    {
        std::string s = svg_of("xychart-beta\n  title \"Sales\"\n  x-axis [jan, feb, mar]\n  y-axis \"Revenue\" 0 --> 100\n  bar [10, 50, 90]\n  line [20, 40, 60]");
        check(has(s, ">Sales<") && has(s, ">jan<") && has(s, ">mar<") && has(s, ">Revenue<"), "xychart/titles_and_categories");
        check(count(s, "<rect x=") >= 3 && has(s, "fill-opacity"), "xychart/bars");
        check(has(s, "class=\"series\"") && count(s, "<circle") == 3, "xychart/line_points");
        check(has(s, ">100<") && has(s, ">0<"), "xychart/explicit_range_ticks");
        check(has(svg_of("xychart-beta\nx-axis \"n\" 1 --> 3\nline [1, 2, 3]"), ">2<"), "xychart/numeric_x_axis");
        check(has(svg_of("xychart-beta\nx-axis [\xe6\x97\xa5, \xe6\x9c\x88]\nbar [1, 2]"), ">\xe6\x97\xa5<"), "xychart/cjk");
        check(has(svg_of("xychart-beta\nbar [3, -2]"), "<rect"), "xychart/negative_values");
        std::string e1, e2;
        check(!render("xychart-beta\nx-axis [a]", e1, e2), "xychart/error_no_series");
        check(!render("xychart-beta\nbar [a, b]", e1, e2), "xychart/error_not_a_number");
        check(!render("xychart-beta horizontal\nbar [1]", e1, e2), "xychart/error_horizontal");
    }

    // --- pie ---
    {
        std::string s = svg_of("pie showData\n  title Pets\n  \"Dogs\" : 386\n  \"Cats\" : 85.5\n  \"Rats\" : 15");
        check(has(s, ">Pets<") && count(s, "class=\"slice\"") == 3, "pie/slices_and_title");
        check(has(s, ">Dogs [386]<") && has(s, ">Cats [85.5]<"), "pie/show_data_legend");
        check(has(s, ">79.3%<"), "pie/percent_label");
        check(count(svg_of("pie\n\"A\" : 1"), "<circle") == 1, "pie/single_slice_is_a_circle");
        check(has(svg_of("pie title \xe6\x97\xa5\xe6\x9c\xac\n\"\xe7\x8c\xab\" : 1\n\"b\" : 1"), ">\xe7\x8c\xab<"), "pie/cjk");
        check(!has(s, "var(") && !has(s, "color-mix"), "pie/plain_colours_only");
        std::string e1, e2;
        check(!render("pie\n\"A\" : x", e1, e2), "pie/error_not_a_number");
        check(!render("pie\n\"A\" : 0", e1, e2), "pie/error_zero_total");
        check(!render("pie", e1, e2), "pie/error_empty");
    }
    check(has(svg_of("graph LR\nA[/para/]"), "<polygon") && has(svg_of("graph LR\nA[\\para\\]"), "<polygon"), "shape/parallelogram");

    // --- gantt ---
    {
        std::string s = svg_of("gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Design :a1, 2024-01-01, 10d\n  Build :after a1, 20d\n  Ship :milestone, m1, 2024-02-01, 0d\n  section B\n  Docs :crit, 2024-01-05, 2w");
        check(has(s, ">Plan<") && has(s, ">Design<") && has(s, ">Build<") && has(s, ">Docs<"), "gantt/title_and_tasks");
        check(has(s, ">A<") && has(s, ">B<"), "gantt/sections");
        check(count(s, "class=\"task\"") == 3, "gantt/bars");
        check(has(s, "#e5484d"), "gantt/crit_colour");
        check(has(s, "<polygon"), "gantt/milestone");
        check(has(s, ">2024-01-01<"), "gantt/axis_labels");
        check(has(svg_of("gantt\n  axisFormat %b %e\n  T :2024-03-01, 5d"), ">Mar 1<"), "gantt/axis_format");
        check(has(svg_of("gantt\n  A :a, 2024-01-01, 2024-01-10\n  B :after a, 3d"), ">B<"), "gantt/end_date");
        check(has(svg_of("gantt\n  \xe8\xa8\xad\xe8\xa8\x88 :2024-01-01, 3d"), ">\xe8\xa8\xad\xe8\xa8\x88<"), "gantt/cjk");
        std::string e1, e2;
        check(!render("gantt\n  A :after nope, 3d", e1, e2) && has(e2, "unknown task id"), "gantt/error_unknown_id");
        check(!render("gantt\n  A :3d", e1, e2), "gantt/error_first_task_without_start");
        check(!render("gantt\n  A :2024-01-01, soon", e1, e2), "gantt/error_bad_length");
        check(!render("gantt\n  title x", e1, e2), "gantt/error_no_tasks");
    }

    // --- mindmap ---
    {
        std::string s = svg_of("mindmap\n  root((Centre))\n    A\n      A1\n      A2\n    B[Square]\n    C(Round)\n    D{{Hex}}\n");
        check(count(s, "class=\"node\"") == 7, "mindmap/nodes");
        check(count(s, "class=\"edge\"") == 6, "mindmap/connectors");
        check(has(s, ">Centre<") && has(s, ">Square<") && has(s, ">Round<") && has(s, ">Hex<"), "mindmap/shapes_use_the_text_only");
        check(has(s, "<ellipse") && has(s, "<polygon"), "mindmap/circle_and_hexagon");
        check(has(svg_of("mindmap\n  r\n    \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "mindmap/cjk");
        check(has(svg_of("mindmap\n  r\n    a\n    ::icon(fa fa-book)\n    b"), ">b<"), "mindmap/icon_lines_are_skipped");
        check(!has(s, "var(") && !has(s, "color-mix"), "mindmap/plain_colours_only");
        std::string e1, e2;
        check(!render("mindmap\n  a\n  b", e1, e2) && has(e2, "one root"), "mindmap/error_two_roots");
        check(!render("mindmap", e1, e2), "mindmap/error_empty");
    }

    // --- timeline ---
    {
        std::string s = svg_of("timeline\n  title History\n  section Early\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  : Twitter\n  section Late\n  2010 : Instagram");
        check(has(s, ">History<") && has(s, ">Early<") && has(s, ">Late<"), "timeline/title_and_sections");
        check(count(s, "class=\"period\"") == 3, "timeline/periods");
        check(count(s, "class=\"event\"") == 5, "timeline/events_including_continuation");
        check(has(s, ">Twitter<") && has(s, ">Instagram<"), "timeline/event_text");
        check(count(svg_of("timeline\n  2000 : a\n  2001"), "class=\"period\"") == 2, "timeline/period_without_event");
        check(has(svg_of("timeline\n  \xe6\x97\xa5\xe6\x9c\xac : \xe6\x9d\xb1\xe4\xba\xac"), ">\xe6\x9d\xb1\xe4\xba\xac<"), "timeline/cjk");
        check(!has(s, "var(") && !has(s, "color-mix"), "timeline/plain_colours_only");
        std::string e1, e2;
        check(!render("timeline\n  : orphan", e1, e2), "timeline/error_event_without_period");
        check(!render("timeline", e1, e2), "timeline/error_empty");
    }

    std::printf("----\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
