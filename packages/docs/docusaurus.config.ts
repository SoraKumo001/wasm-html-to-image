import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "wasm-html-to-image",
  tagline: "High-Performance HTML to Image & Image Optimization Engine",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  // GitHub Pages deployment settings
  url: "https://sorakumo001.github.io",
  baseUrl: process.env.DOCUSAURUS_BASE_URL || "/wasm-html-to-image/",

  organizationName: "SoraKumo001",
  projectName: "wasm-html-to-image",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "ja",
    locales: ["ja", "en"],
    localeConfigs: {
      ja: {
        label: "日本語",
      },
      en: {
        label: "English",
      },
    },
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  themes: [
    "@docusaurus/theme-mermaid",
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        language: ["ja", "en"],
        indexDocs: true,
        indexPages: true,
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig: {
    image: "img/ogp.png",
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "wasm-html-to-image",
      logo: {
        alt: "wasm-html-to-image Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "ドキュメント",
        },
        {
          type: "localeDropdown",
          position: "right",
        },
        {
          href: "https://sorakumo001.github.io/wasm-html-to-image/master",
          label: "Playground",
          position: "left",
        },
        {
          href: "https://github.com/SoraKumo001/wasm-html-to-image-samples",
          label: "Samples",
          position: "left",
        },
        {
          href: "https://github.com/SoraKumo001/wasm-html-to-image",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "ドキュメント",
          items: [
            {
              label: "概要",
              to: "/docs/overview",
            },
            {
              label: "アーキテクチャ",
              to: "/docs/architecture",
            },
            {
              label: "互換性",
              to: "/docs/compatibility",
            },
          ],
        },
        {
          title: "リンク",
          items: [
            {
              label: "Playground",
              href: "https://sorakumo001.github.io/wasm-html-to-image/master",
            },
            {
              label: "サンプルコード (GitHub)",
              href: "https://github.com/SoraKumo001/wasm-html-to-image-samples",
            },
            {
              label: "npm (wasm-html-to-image)",
              href: "https://www.npmjs.com/package/wasm-html-to-image",
            },
          ],
        },
        {
          title: "その他",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/SoraKumo001/wasm-html-to-image",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} SoraKumo. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
