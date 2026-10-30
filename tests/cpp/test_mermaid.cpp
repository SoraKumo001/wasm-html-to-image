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
        check(!render("pie title x", svg, err) && has(err, "unsupported"), "error/unsupported");
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
        check(has(svg_of("graph TD\nA[\"a < b & c\"]"), "a &lt; b &amp; c"), "svg/escapes_text");
        std::string svg = svg_of("graph TD\nA-->B");
        check(!has(svg, "var(") && !has(svg, "color-mix"), "svg/plain_colours_only");
    }

    std::printf("----\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
