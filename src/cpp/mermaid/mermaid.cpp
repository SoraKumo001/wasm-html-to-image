#include "mermaid/mermaid.h"

#include <algorithm>
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
#include "mermaid/c4.h"
#include "mermaid/venn.h"
#include "mermaid/ishikawa.h"
#include "mermaid/treeview.h"
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

static bool render_once(const std::string& input, const Options& base, std::string& svg, std::string& error) {
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
    if (keyword == "C4Context" || keyword == "C4Container" || keyword == "C4Component" || keyword == "C4Dynamic" || keyword == "C4Deployment") return render_c4(source, options, svg, error);
    if (keyword == "venn-beta" || keyword == "venn") return render_venn(source, options, svg, error);
    if (keyword == "ishikawa-beta" || keyword == "ishikawa") return render_ishikawa(source, options, svg, error);
    if (keyword == "treeView-beta" || keyword == "treeView") return render_treeview(source, options, svg, error);
    if (keyword == "timeline") return render_timeline(source, options, svg, error);
    if (keyword == "mindmap")return render_mindmap(source, options, svg, error);
    if (keyword == "gantt")return render_gantt(source, options, svg, error);
    if (keyword == "pie")return render_pie(source, options, svg, error);
    if (keyword == "sequenceDiagram") return render_sequence(source, options, svg, error);
    error = keyword.empty() ? "empty diagram" : "unsupported diagram type: " + keyword;
    return false;
}

namespace {

const char* const kKeywords[] = {"graph", "flowchart", "stateDiagram", "stateDiagram-v2", "classDiagram", "erDiagram", "xychart-beta", "xychart", "journey", "quadrantChart", "gitGraph", "kanban",
                                 "packet-beta", "sankey-beta", "requirementDiagram", "block-beta", "timeline", "mindmap", "gantt", "pie", "sequenceDiagram", "treemap-beta", "radar-beta", "info",
                                 "architecture-beta", "C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment", "venn-beta", "ishikawa-beta", "treeView-beta"};

std::string lower(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

size_t edit_distance(const std::string& a, const std::string& b) {
    std::vector<size_t> prev(b.size() + 1), cur(b.size() + 1);
    for (size_t j = 0; j <= b.size(); j++) prev[j] = j;
    for (size_t i = 1; i <= a.size(); i++) {
        cur[0] = i;
        for (size_t j = 1; j <= b.size(); j++) cur[j] = std::min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)});
        std::swap(prev, cur);
    }
    return prev[b.size()];
}

/// The known keyword nearest to @p word: a different case counts as a match, otherwise at most two edits
/// (one for short words) and no tie. Empty when nothing fits.
std::string nearest_keyword(const std::string& word, bool allow_typos) {
    std::string lw = lower(word);
    for (const char* k : kKeywords)
        if (lower(k) == lw) return k;
    if (!allow_typos) return "";
    size_t limit = word.size() <= 5 ? 1 : 2, best = limit + 1;
    std::string found;
    bool tie = false;
    for (const char* k : kKeywords) {
        size_t d = edit_distance(lw, lower(k));
        if (d < best) best = d, found = k, tie = false;
        else if (d == best && found != k) tie = true;
    }
    return best <= limit && !tie ? found : "";
}

// Replaces the diagram keyword on the first meaningful line; false when there is none.
bool replace_keyword(std::string& source, const std::string& from, const std::string& to) {
    size_t i = 0;
    while (i < source.size()) {
        size_t e = source.find('\n', i);
        size_t end = e == std::string::npos ? source.size() : e;
        std::string line = litehtml::svgutil::trim(source.substr(i, end - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0 && line.compare(0, 3, "---") != 0) {
            size_t at = source.find(from, i);
            if (at == std::string::npos || at >= end) return false;
            source.replace(at, from.size(), to);
            return true;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    return false;
}

bool starts_with(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

// Drops the first line (after the keyword line) whose text is @p text.
bool drop_line(std::string& source, const std::string& text) {
    size_t i = 0;
    int n = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        size_t end = e == std::string::npos ? source.size() : e;
        std::string line = litehtml::svgutil::trim(source.substr(i, end - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0) n++;
        if (n > 1 && line == text) {
            source.erase(i, (e == std::string::npos ? source.size() : e + 1) - i);
            return true;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    return false;
}

}  // namespace

bool render(const std::string& input, const Options& options, std::string& svg, std::string& error, std::vector<std::string>* warnings) {
    std::string source = input;
    if (options.mode != Options::Mode::Strict) {
        if (source.compare(0, 3, "\xEF\xBB\xBF") == 0) source.erase(0, 3);
        std::string out;
        for (char c : source)
            if (c != '\r') out += c;
        source = out;
    }
    std::vector<std::string> notes;
    bool tried_close = false;
    for (int round = 0; round < 40; round++) {
        if (render_once(source, options, svg, error)) {
            if (!notes.empty()) {
                std::string comment = "<!-- recovered:";
                for (auto& n : notes) {
                    std::string t = n;
                    for (size_t p = t.find("--"); p != std::string::npos; p = t.find("--", p + 1)) t.replace(p, 2, "- ");
                    comment += " " + t + ";";
                }
                comment += " -->\n";
                size_t tag = svg.find('>');
                if (tag != std::string::npos) svg.insert(tag + 1, "\n" + comment);
                if (warnings) *warnings = notes;
            }
            return true;
        }
        if (starts_with(error, "unsupported diagram type: ")) {
            std::string word = error.substr(26), fix = nearest_keyword(word, options.mode == Options::Mode::Recover);
            if (!fix.empty() && options.mode != Options::Mode::Strict && replace_keyword(source, word, fix)) {
                notes.push_back("`" + word + "` read as `" + fix + "`");
                continue;
            }
            std::string hint = nearest_keyword(word, true);
            if (!hint.empty()) error += " (did you mean `" + hint + "`?)";
            return false;
        }
        if (options.mode == Options::Mode::Strict) return false;
        if (!tried_close) {
            tried_close = true;
            bool closed = false;
            for (const char* closer : {"end", "}"}) {
                std::string trial = source;
                for (int n = 1; n <= 3 && !closed; n++) {
                    trial += std::string("\n") + closer;
                    std::string t_svg, t_err;
                    if (render_once(trial, options, t_svg, t_err)) {
                        source = trial;
                        notes.push_back("added " + std::to_string(n) + " missing `" + closer + "`");
                        closed = true;
                    }
                }
                if (closed) break;
            }
            if (closed) continue;
        }
        if (options.mode == Options::Mode::Recover) {
            static const char* const kLinePrefixes[] = {"unrecognised line: ", "cannot parse: ", "unknown element in: ", "unknown service in: ", "an edge is `a:R -- L:b`: "};
            bool dropped = false;
            for (const char* p : kLinePrefixes) {
                if (!starts_with(error, p)) continue;
                std::string line = error.substr(std::char_traits<char>::length(p));
                if (drop_line(source, line)) {
                    notes.push_back("skipped `" + line + "`");
                    dropped = true;
                }
                break;
            }
            if (dropped) {
                tried_close = false;
                continue;
            }
        }
        return false;
    }
    return false;
}

}  // namespace mermaid
