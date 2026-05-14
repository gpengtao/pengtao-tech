import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "pengtao-tech",
    pageTitleSuffix: " | 我的技术知识库",
    enableSPA: true,
    enablePopovers: true,
    analytics: {
      provider: "plausible",
    },
    locale: "zh-CN",
    baseUrl: "gpengtao.github.io/pengtao-tech",
    ignorePatterns: ["private", "_模板", "_临时", ".obsidian", ".quartz"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: { name: "Inter", weights: [500, 700] },
        body: { name: "Noto Sans SC", weights: [400, 600], includeItalic: false },
        code: { name: "JetBrains Mono", weights: [400, 600] },
      },
      colors: {
        lightMode: {
          light: "#f8f9fa",
          lightgray: "#e0e0ec",
          gray: "#4a4a68",
          darkgray: "#1a1a2e",
          dark: "#0d0d20",
          secondary: "#059669",
          tertiary: "#10b981",
          highlight: "rgba(5, 150, 105, 0.06)",
          textHighlight: "rgba(5, 150, 105, 0.18)",
        },
        darkMode: {
          light: "#0d0d12",
          lightgray: "#1e1e22",
          gray: "#909099",
          darkgray: "#e2e2e8",
          dark: "#f0f0f6",
          secondary: "#10b981",
          tertiary: "#34d399",
          highlight: "rgba(16, 185, 129, 0.08)",
          textHighlight: "rgba(16, 185, 129, 0.22)",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      // 本地预览时注释掉以加速构建（CI 会生成）
      ...(process.env.QUARTZ_LOCAL ? [] : [Plugin.CustomOgImages()]),
    ],
  },
}

export default config
