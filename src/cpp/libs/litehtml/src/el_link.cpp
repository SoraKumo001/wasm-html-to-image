#include "el_link.h"
#include "document.h"
#include "document_container.h"
#include <cctype>
#include <cstring>
#include <sstream>

namespace
{
	// rel is a space-separated token list: "preload stylesheet" loads a sheet, "alternate stylesheet" does not.
	bool rel_is_stylesheet(const char* rel)
	{
		if(!rel) return false;
		std::istringstream ss(rel);
		std::string tok;
		bool sheet = false;
		while(ss >> tok)
		{
			for(auto& c : tok) c = (char) tolower((unsigned char) c);
			if(tok == "stylesheet") sheet = true;
			else if(tok == "alternate") return false;
		}
		return sheet;
	}
}

litehtml::el_link::el_link(const std::shared_ptr<document>& doc) : litehtml::html_tag(doc)
{

}

void litehtml::el_link::parse_attributes()
{
	bool processed = false;

	document::ptr doc = get_document();

	const char* rel = get_attr("rel");
	if(rel_is_stylesheet(rel))
	{
		const char* media	= get_attr("media");
		const char* href	= get_attr("href");
		if(href && href[0])
		{
			string css_text;
			string css_baseurl;
			doc->container()->import_css(css_text, href, css_baseurl);
			if(!css_text.empty())
			{
				doc->add_stylesheet(css_text.c_str(), css_baseurl.c_str(), media);
				processed = true;
			}
		}
	}

	if(!processed)
	{
		doc->container()->link(doc, shared_from_this());
	}
}
