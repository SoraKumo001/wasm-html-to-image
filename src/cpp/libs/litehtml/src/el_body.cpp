#include "el_body.h"
#include "document.h"

litehtml::el_body::el_body(const std::shared_ptr<litehtml::document>& doc) : litehtml::html_tag(doc)
{
}

bool litehtml::el_body::is_body()  const
{
	return true;
}

// https://html.spec.whatwg.org/multipage/rendering.html#the-page
void litehtml::el_body::parse_presentational_hints()
{
	const char* str = get_attr("bgcolor");
	if (str)
	{
		m_style.add_property(_background_color_, str, "", false, get_document()->container());
	}

	str = get_attr("background");
	if (str)
	{
		string url = "url('";
		for (const char c : string(str))
		{
			if (c == '\\' || c == '\'') url += '\\';
			url += c;
		}
		url += "')";
		m_style.add_property(_background_image_, url);
	}

	str = get_attr("text");
	if (str)
	{
		m_style.add_property(_color_, str, "", false, get_document()->container());
	}

	html_tag::parse_presentational_hints();
}
