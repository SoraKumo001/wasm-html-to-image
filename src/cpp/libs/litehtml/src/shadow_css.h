#ifndef LH_SHADOW_CSS_H
#define LH_SHADOW_CSS_H

#include <string>
#include <vector>
#include <cstring>

// Declarative shadow DOM is flattened into the host's children while the node tree is built, so a
// shadow root's <style> has to be confined to the elements that came from that root. Every element
// created inside root N carries data-satoru-scope="N", the host carries data-satoru-host="N", and a
// light-DOM child assigned to a slot carries data-satoru-slotted="N". The rewriter below turns
//   .a .b      -> .a[data-satoru-scope="N"] .b[data-satoru-scope="N"]
//   :host(.x)  -> .x[data-satoru-host="N"]
//   ::slotted(p) -> p[data-satoru-slotted="N"]
// Rules nested inside a style rule (CSS nesting) and selectors inside :is()/:not() are left as written.
namespace litehtml
{
	namespace shadow_css
	{
		inline bool is_ws(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f'; }

		// Index of the closing quote of the string starting at s[i].
		inline size_t skip_string(const std::string& s, size_t i)
		{
			char q = s[i++];
			while (i < s.size() && s[i] != q)
			{
				if (s[i] == '\\') i++;
				i++;
			}
			return i < s.size() ? i : s.size() - 1;
		}

		// Index just past the "}" matching the "{" at s[open] (s.size() when unmatched).
		inline size_t skip_block(const std::string& s, size_t open)
		{
			int depth = 0;
			for (size_t i = open; i < s.size(); i++)
			{
				char c = s[i];
				if (c == '"' || c == '\'') i = skip_string(s, i);
				else if (c == '/' && i + 1 < s.size() && s[i + 1] == '*')
				{
					size_t e = s.find("*/", i + 2);
					if (e == std::string::npos) return s.size();
					i = e + 1;
				}
				else if (c == '{') depth++;
				else if (c == '}' && --depth == 0) return i + 1;
			}
			return s.size();
		}

		// Index just past the ")" matching the "(" at s[open].
		inline size_t skip_parens(const std::string& s, size_t open)
		{
			int depth = 0;
			for (size_t i = open; i < s.size(); i++)
			{
				char c = s[i];
				if (c == '"' || c == '\'') i = skip_string(s, i);
				else if (c == '(') depth++;
				else if (c == ')' && --depth == 0) return i + 1;
			}
			return s.size();
		}

		inline std::string attr_sel(const char* name, int scope)
		{
			return std::string("[") + name + "=\"" + std::to_string(scope) + "\"]";
		}

		inline std::string rewrite_compound(const std::string& c, int scope)
		{
			size_t sl = c.find("::slotted(");
			if (sl != std::string::npos)
			{
				size_t open = sl + 9;
				size_t close = skip_parens(c, open);
				std::string inner = c.substr(open + 1, close - open - 2);
				if (inner.empty()) inner = "*";
				return inner + attr_sel("data-satoru-slotted", scope) + (close < c.size() ? c.substr(close) : std::string());
			}
			if (c.compare(0, 5, ":host") == 0)
			{
				size_t p = 5;
				std::string inner;
				if (c.compare(0, 13, ":host-context") == 0)
				{
					p = 13;
					if (p < c.size() && c[p] == '(') p = skip_parens(c, p);
				}
				else if (p < c.size() && c[p] == '(')
				{
					size_t close = skip_parens(c, p);
					inner = c.substr(p + 1, close - p - 2);
					p = close;
				}
				else if (p < c.size() && (isalnum((unsigned char)c[p]) || c[p] == '-' || c[p] == '_'))
				{
					return c + attr_sel("data-satoru-scope", scope);
				}
				return inner + attr_sel("data-satoru-host", scope) + c.substr(p);
			}
			// Insert the scope before a pseudo-element, otherwise at the end.
			size_t at = c.size();
			int depth = 0;
			for (size_t i = 0; i < c.size(); i++)
			{
				char ch = c[i];
				if (ch == '\\') { i++; continue; }
				if (ch == '"' || ch == '\'') { i = skip_string(c, i); continue; }
				if (ch == '(' || ch == '[') depth++;
				else if (ch == ')' || ch == ']') depth--;
				else if (ch == ':' && depth == 0)
				{
					if (i + 1 < c.size() && c[i + 1] == ':') { at = i; break; }
					static const char* legacy[] = { ":before", ":after", ":first-line", ":first-letter" };
					bool found = false;
					for (const char* l : legacy)
					{
						size_t n = strlen(l);
						if (c.compare(i, n, l) == 0 && (i + n == c.size() || !isalnum((unsigned char)c[i + n]))) { found = true; break; }
					}
					if (found) { at = i; break; }
				}
			}
			return c.substr(0, at) + attr_sel("data-satoru-scope", scope) + c.substr(at);
		}

		inline std::string rewrite_selector(const std::string& sel, int scope)
		{
			std::string out, cur;
			int depth = 0;
			auto flush = [&]() { if (!cur.empty()) { out += rewrite_compound(cur, scope); cur.clear(); } };
			for (size_t i = 0; i < sel.size(); i++)
			{
				char c = sel[i];
				if (c == '\\' && i + 1 < sel.size()) { cur += c; cur += sel[++i]; continue; }
				if (c == '"' || c == '\'')
				{
					size_t e = skip_string(sel, i);
					cur += sel.substr(i, e - i + 1);
					i = e;
					continue;
				}
				if (c == '(' || c == '[') depth++;
				else if (c == ')' || c == ']') depth--;
				if (depth == 0 && (is_ws(c) || c == '>' || c == '+' || c == '~'))
				{
					flush();
					out += c;
				}
				else
				{
					cur += c;
				}
			}
			flush();
			return out;
		}

		inline std::string rewrite_selector_list(const std::string& list, int scope)
		{
			std::string out, cur;
			int depth = 0;
			auto flush = [&]() { out += rewrite_selector(cur, scope); cur.clear(); };
			for (size_t i = 0; i < list.size(); i++)
			{
				char c = list[i];
				if (c == '\\' && i + 1 < list.size()) { cur += c; cur += list[++i]; continue; }
				if (c == '"' || c == '\'')
				{
					size_t e = skip_string(list, i);
					cur += list.substr(i, e - i + 1);
					i = e;
					continue;
				}
				if (c == '(' || c == '[') depth++;
				else if (c == ')' || c == ']') depth--;
				if (c == ',' && depth == 0) { flush(); out += ','; }
				else cur += c;
			}
			flush();
			return out;
		}

		inline std::string rewrite(const std::string& css, int scope)
		{
			std::string out;
			size_t i = 0;
			while (i < css.size())
			{
				if (is_ws(css[i])) { out += css[i++]; continue; }
				if (css.compare(i, 2, "/*") == 0)
				{
					size_t e = css.find("*/", i + 2);
					e = e == std::string::npos ? css.size() : e + 2;
					out += css.substr(i, e - i);
					i = e;
					continue;
				}
				// Prelude: up to the "{" or ";" that ends it.
				size_t j = i;
				int depth = 0;
				while (j < css.size())
				{
					char c = css[j];
					if (c == '"' || c == '\'') { j = skip_string(css, j) + 1; continue; }
					if (c == '(' || c == '[') depth++;
					else if (c == ')' || c == ']') depth--;
					else if (depth <= 0 && (c == '{' || c == ';')) break;
					j++;
				}
				if (j >= css.size()) { out += css.substr(i); break; }
				std::string prelude = css.substr(i, j - i);
				if (css[j] == ';') { out += prelude + ";"; i = j + 1; continue; }
				size_t end = skip_block(css, j);
				size_t body_end = css[end - 1] == '}' ? end - 1 : end;
				std::string body = css.substr(j + 1, body_end - (j + 1));
				if (prelude[0] == '@')
				{
					size_t n = 1;
					while (n < prelude.size() && (isalnum((unsigned char)prelude[n]) || prelude[n] == '-')) n++;
					std::string name = prelude.substr(1, n - 1);
					bool nested = name == "media" || name == "supports" || name == "layer" || name == "container" || name == "document";
					out += prelude + "{" + (nested ? rewrite(body, scope) : body) + "}";
				}
				else
				{
					out += rewrite_selector_list(prelude, scope) + "{" + body + "}";
				}
				i = end;
			}
			return out;
		}
	}

	inline std::string scope_shadow_css(const std::string& css, int scope)
	{
		return shadow_css::rewrite(css, scope);
	}
}

#endif
