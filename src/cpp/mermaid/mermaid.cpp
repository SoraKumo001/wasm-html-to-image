#include "mermaid/mermaid.h"

#include <cctype>

#include "mermaid/classdiagram.h"
#include "mermaid/erdiagram.h"
#include "mermaid/flowchart.h"
#include "mermaid/mermaid_internal.h"
#include "mermaid/gantt.h"
#include "mermaid/mindmap.h"
#include "mermaid/pie.h"
#include "mermaid/sequence.h"
#include "mermaid/state.h"
#include "mermaid/journey.h"
#include "mermaid/quadrant.h"
#include "mermaid/gitgraph.h"
#include "mermaid/kanban.h"
#include "mermaid/packet.h"
#include "mermaid/sankey.h"
#include "mermaid/requirement.h"
#include "mermaid/block.h"
#include "mermaid/treemap.h"
#include "mermaid/radar.h"
#include "mermaid/info.h"
#include "mermaid/architecture.h"
#include "mermaid/timeline.h"
#include "mermaid/xychart.h"

namespace mermaid {

double estimate_text_width(const std::string& text, double size, int weight, bool mono) {
    if (mono) {
        double n = 0;
        for (size_t i = 0; i < text.size(); i++)
            if ((text[i] & 0xC0) != 0x80) n += (unsigned char)text[i] >= 0xE0 ? 2 : 1;  // a CJK character takes two cells
        return n * size * 0.6;
    }
    double em = 0;
    for (size_t i = 0; i < text.size();) {
        unsigned char c = (unsigned char)text[i];
        if (c < 0x80) {
            i++;
            if (c == ' ') em += 0.28;
            else if (std::string("iljI.,:;!|'`").find((char)c) != std::string::npos) em += 0.28;
            else if (std::string("ft()[]{}-/\\\"").find((char)c) != std::string::npos) em += 0.36;
            else if (std::string("mwMW@%").find((char)c) != std::string::npos) em += 0.85;
            else if (c >= 'A' && c <= 'Z') em += 0.66;
            else if (c >= '0' && c <= '9') em += 0.58;
            else em += 0.55;
        } else {
            // one code point; everything outside the Latin range counts as full width
            size_t len = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : 2;
            i += len;
            em += len == 2 ? 0.6 : 1.0;
        }
    }
    return em * size * (weight >= 600 ? 1.05 : 1.0);
}

namespace {

// `---` ... `---` at the very top; returns the text between the fences and removes the block from @p source.
std::string take_frontmatter(std::string& source) {
    size_t i = 0;
    while (i < source.size() && (source[i] == ' ' || source[i] == '\n' || source[i] == '\r' || source[i] == '\t')) i++;
    if (source.compare(i, 3, "---") != 0) return "";
    size_t eol = source.find('\n', i);
    if (eol == std::string::npos || !litehtml::svgutil::trim(source.substr(i + 3, eol - i - 3)).empty()) return "";
    size_t pos = eol + 1;
    while (pos <= source.size()) {
        size_t e = source.find('\n', pos);
        std::string line = litehtml::svgutil::trim(source.substr(pos, e == std::string::npos ? std::string::npos : e - pos));
        if (line == "---") {
            std::string body = source.substr(eol + 1, pos - eol - 1);
            source = e == std::string::npos ? "" : source.substr(e + 1);
            return body;
        }
        if (e == std::string::npos) break;
        pos = e + 1;
    }
    return "";
}

// The value of `key` in JSON-ish ("key": "v"), YAML-ish (key: v) or quoted-key text; empty when absent.
std::string find_value(const std::string& text, const std::string& key) {
    for (size_t at = text.find(key); at != std::string::npos; at = text.find(key, at + 1)) {
        size_t b = at, e = at + key.size();
        if (b > 0 && (std::isalnum((unsigned char)text[b - 1]) || text[b - 1] == '_')) continue;
        if (e < text.size() && text[e] == '"') e++;
        while (e < text.size() && text[e] == ' ') e++;
        if (e >= text.size() || text[e] != ':') continue;
        e++;
        while (e < text.size() && (text[e] == ' ' || text[e] == '"' || text[e] == '\'')) e++;
        size_t end = e;
        while (end < text.size() && text[end] != '"' && text[end] != '\'' && text[end] != ',' && text[end] != '}' && text[end] != '\n' && text[end] != '\r') end++;
        std::string v = litehtml::svgutil::trim(text.substr(e, end - e));
        if (!v.empty()) return v;
    }
    return "";
}

void apply_config(const std::string& cfg, Options& o) {
    std::string theme = find_value(cfg, "theme");
    if (theme == "dark") {
        o.fg = "#e6edf3"; o.bg = "#0d1117"; o.border = "#3d444d"; o.surface = "#151b23"; o.line = ""; o.muted = "";
    } else if (theme == "forest") {
        o.fg = "#1b3a2a"; o.bg = "#ffffff"; o.border = "#8fbf9f"; o.surface = "#e8f5ec"; o.accent = "#2e8b57"; o.line = "#2e8b57"; o.muted = "";
    } else if (theme == "neutral") {
        o.fg = "#222222"; o.bg = "#ffffff"; o.border = "#999999"; o.surface = "#eeeeee"; o.line = ""; o.muted = "";
    }
    auto set = [&](const char* key, std::string& dst) {
        std::string v = find_value(cfg, key);
        if (!v.empty()) dst = v;
    };
    set("textColor", o.fg);
    set("primaryTextColor", o.fg);
    set("background", o.bg);
    set("primaryColor", o.surface);
    set("primaryBorderColor", o.border);
    set("lineColor", o.line);
    set("secondaryTextColor", o.muted);
    set("accentColor", o.accent);
}

// Drops `%%{ ... }%%` directives (they may span lines) and returns their text.
std::string take_directives(std::string& source) {
    std::string found, out;
    size_t i = 0;
    while (i < source.size()) {
        size_t at = source.find("%%{", i);
        if (at == std::string::npos) break;
        size_t end = source.find("}%%", at);
        if (end == std::string::npos) break;
        out += source.substr(i, at - i);
        found += source.substr(at + 3, end - at - 3) + "\n";
        i = end + 3;
    }
    out += source.substr(i);
    source = out;
    return found;
}

}  // namespace

bool render(const std::string& input, const Options& base, std::string& svg, std::string& error) {
    std::string source = input;
    Options options = base;
    std::string config = take_frontmatter(source) + "\n" + take_directives(source);
    if (options.allow_directives) apply_config(config, options);
    // the first line that is not blank or a comment names the diagram
    size_t i = 0;
    std::string keyword;
    while (i < source.size()) {
        size_t e = source.find('\n', i);
        std::string line = litehtml::svgutil::trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0) {
            size_t sp = line.find_first_of(" \t;");
            keyword = line.substr(0, sp);
            break;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    if (keyword == "graph" || keyword == "flowchart" || keyword == "flowchart-elk") return render_flowchart(source, options, svg, error);
    if (keyword == "stateDiagram" || keyword == "stateDiagram-v2") return render_state(source, options, svg, error);
    if (keyword == "classDiagram" || keyword == "classDiagram-v2") return render_class(source, options, svg, error);
    if (keyword == "erDiagram") return render_er(source, options, svg, error);
    if (keyword == "xychart-beta" || keyword == "xychart") return render_xychart(source, options, svg, error);
    if (keyword == "journey") return render_journey(source, options, svg, error);
    if (keyword == "quadrantChart") return render_quadrant(source, options, svg, error);
    if (keyword == "gitGraph") return render_gitgraph(source, options, svg, error);
    if (keyword == "kanban") return render_kanban(source, options, svg, error);
    if (keyword == "packet-beta" || keyword == "packet") return render_packet(source, options, svg, error);
    if (keyword == "sankey-beta" || keyword == "sankey") return render_sankey(source, options, svg, error);
    if (keyword == "requirementDiagram") return render_requirement(source, options, svg, error);
    if (keyword == "block-beta" || keyword == "block") return render_block(source, options, svg, error);
    if (keyword == "treemap-beta" || keyword == "treemap") return render_treemap(source, options, svg, error);
    if (keyword == "radar-beta" || keyword == "radar") return render_radar(source, options, svg, error);
    if (keyword == "info") return render_info(source, options, svg, error);
    if (keyword == "architecture-beta" || keyword == "architecture") return render_architecture(source, options, svg, error);
    if (keyword == "timeline") return render_timeline(source, options, svg, error);
    if (keyword == "mindmap")return render_mindmap(source, options, svg, error);
    if (keyword == "gantt")return render_gantt(source, options, svg, error);
    if (keyword == "pie")return render_pie(source, options, svg, error);
    if (keyword == "sequenceDiagram") return render_sequence(source, options, svg, error);
    error = keyword.empty() ? "empty diagram" : "unsupported diagram type: " + keyword;
    return false;
}

}  // namespace mermaid
