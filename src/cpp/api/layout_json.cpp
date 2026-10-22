#include "layout_json.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <unordered_map>
#include <vector>

#include <litehtml/document.h>
#include <litehtml/element.h>
#include <litehtml/render_item.h>

namespace {

using litehtml::element;

bool is_tree_element(const std::shared_ptr<element>& el) {
    if (!el || el->is_text() || el->is_comment() || el->is_white_space()) return false;
    const char* tag = el->get_tagName();
    // "-tag-before" / "-tag-after" are the engine's pseudo-element nodes, "anonymous" its table fix-ups:
    // neither exists in a browser's element tree, and counting them would shift every later index.
    return tag && tag[0] && tag[0] != '-' && strcmp(tag, "anonymous") != 0;
}

struct path_index {
    // Index of an element among its parent's element children, filled one parent at a time.
    std::unordered_map<const element*, int> index;
    std::unordered_map<const element*, std::string> memo;

    const std::string& path_of(const std::shared_ptr<element>& el) {
        auto it = memo.find(el.get());
        if (it != memo.end()) return it->second;
        auto parent = el->parent();
        std::string p;
        if (parent) {
            if (!index.count(el.get())) {
                int n = 0;
                for (const auto& c : parent->children()) {
                    if (is_tree_element(c)) index[c.get()] = n++;
                }
            }
            p = path_of(parent) + "." + std::to_string(index[el.get()]);
        } else {
            p = "0";
        }
        return memo.emplace(el.get(), std::move(p)).first->second;
    }
};

void append_escaped(std::string& out, const char* s, size_t max_len) {
    if (!s) return;
    size_t n = 0;
    for (; *s && n < max_len; ++s, ++n) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') {
            out += '\\';
            out += (char)c;
        } else if (c < 0x20) {
            out += ' ';
        } else {
            out += (char)c;
        }
    }
}

bool is_replaced_tag(const char* tag) {
    static const char* names[] = {"img", "svg", "video", "canvas", "iframe", "input", "select", "textarea"};
    for (const char* n : names) {
        if (strcmp(tag, n) == 0) return true;
    }
    return false;
}

void number(std::string& out, double v) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%.2f", std::round(v * 100.0) / 100.0);
    out += buf;
}

void walk(const std::shared_ptr<litehtml::render_item>& ri, path_index& paths, std::string& out,
          bool& first) {
    if (!ri) return;
    const auto& el = ri->src_el();
    if (is_tree_element(el)) {
        const auto display = el->css().get_display();
        const char* tag = el->get_tagName();
        const bool inline_box = display == litehtml::display_inline || display == litehtml::display_inline_text;
        if ((!inline_box || is_replaced_tag(tag)) && strcmp(tag, "br") != 0) {
            litehtml::position pl = ri->get_placement();
            const double x = pl.x - ri->padding_left() - ri->border_left();
            const double y = pl.y - ri->padding_top() - ri->border_top();
            const double w = ri->pos().width + ri->padding_left() + ri->padding_right() + ri->border_left() + ri->border_right();
            const double h = ri->pos().height + ri->padding_top() + ri->padding_bottom() + ri->border_top() + ri->border_bottom();
            if (!first) out += ',';
            first = false;
            out += "{\"p\":\"";
            out += paths.path_of(el);
            out += "\",\"t\":\"";
            append_escaped(out, tag, 32);
            out += "\",\"i\":\"";
            append_escaped(out, el->get_attr("id"), 60);
            out += "\",\"c\":\"";
            append_escaped(out, el->get_attr("class"), 80);
            out += "\",\"x\":";
            number(out, x);
            out += ",\"y\":";
            number(out, y);
            out += ",\"w\":";
            number(out, w);
            out += ",\"h\":";
            number(out, h);
            out += '}';
        }
    }
    for (const auto& child : ri->children()) walk(child, paths, out, first);
}

}  // namespace

std::string satoru_api_layout_json(SatoruInstance* inst, const std::string& html, int width,
                                   int height, int mediaType) {
    if (!inst) return "[]";
    if (!inst->document_ready_for(html, width, height, mediaType)) {
        inst->collect_resources(html, width, height, mediaType);
    }
    if (!inst->doc || !inst->doc->root_render()) return "[]";
    path_index paths;
    std::string out = "[";
    bool first = true;
    walk(inst->doc->root_render(), paths, out, first);
    out += ']';
    return out;
}
