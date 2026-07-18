import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "鹏涛的技术笔记",
    pageTitleSuffix: " · 工程、架构与 AI 知识库",
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
        header: { name: "Inter", weights: [500, 600, 700] },
        body: { name: "Noto Sans SC", weights: [400, 500, 600], includeItalic: false },
        code: { name: "JetBrains Mono", weights: [400, 600] },
      },
      colors: {
        lightMode: {
          light: "#fbfaf7",
          lightgray: "#e7e3db",
          gray: "#66706c",
          darkgray: "#303936",
          dark: "#17211e",
          secondary: "#0f766e",
          tertiary: "#0b5f59",
          highlight: "rgba(15, 118, 110, 0.09)",
          textHighlight: "rgba(245, 158, 11, 0.24)",
        },
        darkMode: {
          light: "#111614",
          lightgray: "#28332f",
          gray: "#99a8a2",
          darkgray: "#d8e0dc",
          dark: "#f2f6f4",
          secondary: "#5eead4",
          tertiary: "#99f6e4",
          highlight: "rgba(94, 234, 212, 0.10)",
          textHighlight: "rgba(245, 158, 11, 0.24)",
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
