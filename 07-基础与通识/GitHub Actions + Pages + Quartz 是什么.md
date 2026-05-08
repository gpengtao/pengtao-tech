---
tags: [P1, 通用, 工具链, 能讲]
来源: 实战经验 · obsidian-gitpage
---

# GitHub Actions + Pages + Quartz 是什么

## 一句话速记

**Quartz** 把 `.md` 编译成 HTML；**GitHub Actions** 自动触发编译；**GitHub Pages** 把 HTML 托管成公网网站。三者串联，实现 push 笔记 → 自动发布知识库站点。

---

## 整体链路

```
你写 .md 文件
    ↓ git push
GitHub Actions 自动触发
    ↓ npm ci + npx quartz build
.md 编译成 public/（HTML/CSS/JS）
    ↓ upload-pages-artifact
GitHub Pages 托管发布
    ↓
gpengtao.github.io/pengtao-brain
```

---

## GitHub Actions

GitHub 提供的**云端自动化脚本平台**。

核心概念：
- **workflow**：一个自动化流程，写在 `.github/workflows/*.yml` 里
- **job**：workflow 里的一个任务，跑在独立的虚拟机上
- **step**：job 里的每一步，可以是 `run`（shell 命令）或 `uses`（复用别人的 Action）
- **artifact**：job 之间传递文件用的临时包，因为不同 job 跑在不同虚拟机上，文件系统不共享

**触发方式不只有 push：**

```yaml
on:
  push:                      # push 时触发
  pull_request:              # 提 PR 时触发
  schedule:
    - cron: '0 9 * * 1'     # 定时触发（每周一 9 点）
  workflow_dispatch:         # 手动点按钮触发
  release:
    types: [published]       # 发布 release 时触发
```

**`uses: actions/xxx@v4` 是什么：**

GitHub 官方发布的可复用脚本，对应 `github.com/actions/xxx` 仓库。常用的：

| Action | 作用 |
|--------|------|
| `actions/checkout` | 把仓库代码克隆到虚拟机，永远第一步 |
| `actions/setup-node` | 安装 Node.js 环境 |
| `actions/upload-pages-artifact` | 把目录打包上传为 Pages artifact |
| `actions/deploy-pages` | 把 artifact 发布到 GitHub Pages |

**虚拟机：** `runs-on: ubuntu-22.04`，GitHub 提供的临时虚拟机，用完自动销毁。公开仓库无限免费。

**`npm ci` vs `npm install`：**
- `npm install`：以 `package.json` 为准，可能装新版本，会更新 lock 文件
- `npm ci`：严格按 `package-lock.json` 锁定版本，CI 流水线专用，保证环境一致

---

## GitHub Pages

GitHub 官方免费提供的**静态网站托管服务**。

- 服务器、域名、HTTPS、CDN 全包，完全不用管
- 域名格式固定：`用户名.github.io/仓库名`
- 只能托管静态文件（HTML/CSS/JS），没有后端、没有数据库
- 公开仓库**完全免费**

**两种发布方式：**

| 方式 | 适合场景 | 原理 |
|------|----------|------|
| Deploy from a branch | 直接放 HTML 文件 | 指定分支 + 目录，push 即发布 |
| GitHub Actions | 需要编译的内容（md、Vue 等） | 自己写脚本，编译后发布产物 |

两种方式底层都是 Actions，区别是前者用 GitHub 写好的内置脚本，后者自己写。

---

## Quartz

专门为 Obsidian vault 设计的**静态网站生成器**，把 `.md` 编译成 HTML。

- 原生支持 `[[wikilink]]`、标签、frontmatter、反向链接、图谱视图
- 自带搜索、目录、暗黑模式
- 官方推荐把框架源码直接放进仓库（`quartz/` 目录），方便深度定制且版本锁定

**关键文件：**

| 文件/目录 | 作用 |
|-----------|------|
| `quartz/` | Quartz 框架源码，一般不用动 |
| `quartz.config.ts` | 站点配置（标题、baseUrl、语言、忽略目录） |
| `quartz.layout.ts` | 页面布局（侧边栏放什么组件） |
| `package.json` | 依赖声明，`npm install` 靠它 |
| `index.md` | 站点首页，必须叫 `index.md` 才会生成 `index.html` |
| `public/` | 编译产物，不进 git |

**常用命令：**

```bash
npm install                              # 首次安装依赖
npx quartz build --directory .          # 编译
npx quartz build --directory . --serve  # 编译 + 本地预览（localhost:8080）
npx quartz update                       # 升级 Quartz 到最新版
```

**注意：** 根目录必须有 `index.md`（不是 `README.md`），否则首页会返回 RSS 的 `index.xml`。

---

## 延伸追问

- GitHub Actions 还能做什么？→ 自动测试、构建 Docker 镜像、部署到云服务器、定时爬虫、发通知等
- Quartz 的竞品？→ Jekyll、Hugo、MkDocs，但它们对 Obsidian wikilink 支持没 Quartz 好
- 想用自定义域名怎么做？→ 买域名，Pages 设置里填 Custom domain，DNS 加 CNAME 记录指向 `gpengtao.github.io`
