#include "mermaid/mermaid.h"

#include "mermaid/classdiagram.h"
#include "mermaid/erdiagram.h"
#include "mermaid/flowchart.h"
#include "mermaid/mermaid_internal.h"
#include "mermaid/gantt.h"
#include "mermaid/mindmap.h"
#include "mermaid/pie.h"
#include "mermaid/sequence.h"
#include "mermaid/state.h"
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

bool render(const std::string& source, const Options& options, std::string& svg, std::string& error) {
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
    if (keyword == "mindmap") return render_mindmap(source, options, svg, error);
    if (keyword == "gantt")return render_gantt(source, options, svg, error);
    if (keyword == "pie")return render_pie(source, options, svg, error);
    if (keyword == "sequenceDiagram") return render_sequence(source, options, svg, error);
    error = keyword.empty() ? "empty diagram" : "unsupported diagram type: " + keyword;
    return false;
}

}  // namespace mermaid
