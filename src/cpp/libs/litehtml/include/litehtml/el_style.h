#ifndef LH_EL_STYLE_H
#define LH_EL_STYLE_H

#include "element.h"

namespace litehtml
{
	class el_style : public element
	{
		elements_list		m_children;
		string				m_media; // media attribute: `element` keeps no attributes of its own
	public:
		explicit el_style(const std::shared_ptr<document>& doc);

		void			set_attr(const char* name, const char* val) override;
		void			parse_attributes() override;
		bool			appendChild(const ptr &el) override;
		void			compute_styles(bool recursive) override;
		string_id		tag() const override;
		const char*		get_tagName() const override;
	};
}

#endif  // LH_EL_STYLE_H
