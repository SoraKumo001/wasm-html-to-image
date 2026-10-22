#include "el_style.h"
#include "document.h"
#include <cstring>
#include <cstdlib>
#include "shadow_css.h"


litehtml::el_style::el_style(const std::shared_ptr<document>& doc) : element(doc)
{

}

void litehtml::el_style::set_attr(const char* name, const char* val)
{
	if(name && !strcmp(name, "media"))
	{
		m_media = val ? val : "";
	}
	else if(name && !strcmp(name, "data-satoru-scope"))
	{
		m_shadow_scope = val ? atoi(val) : 0;
	}
}

void litehtml::el_style::parse_attributes()
{
	string text;

	for(auto& el : m_children)
	{
		el->get_text(text);
	}
	if(m_shadow_scope)
	{
		text = scope_shadow_css(text, m_shadow_scope);
	}
	get_document()->add_stylesheet( text.c_str(), nullptr, m_media.c_str() );
}

bool litehtml::el_style::appendChild(const ptr &el)
{
	if(el && el->is_text())
	{
		m_children.push_back(el);
		return true;
	}
	return false;
}

void litehtml::el_style::compute_styles(bool /* recursive */)
{
	css_w().set_display(display_none);
}

litehtml::string_id litehtml::el_style::tag() const
{
	return _style_;
}

const char* litehtml::el_style::get_tagName() const
{
	return "style";
}
