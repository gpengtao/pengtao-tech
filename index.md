---
title: pengtao-tech
tags: [入口]
---
# pengtao-tech · 我的技术知识库

个人技术知识库，使用 [Obsidian](https://obsidian.md) 管理。**问题驱动，一题一文件**——每个 `.md` 文件回答一个具体技术问题。

> **What got you here won't get you there.**
> **But what got you here is more than enough to start getting you there.**
> 让你走到这里的，到不了那里；但让你走到这里的，已足以让你启程。
>
> **第一性原理：知道一件事，和知道为什么是这件事，是两个人。**

---

## 模块导航

| 模块                                      | 说明                                     |
| --------------------------------------- | -------------------------------------- |
| [[01-AI大模型/index\|01 · AI 大模型]]         | Transformer、RAG、Agent、训练微调、推理部署、多模态、具身 |
| [[02-Java后端核心/index\|02 · Java 后端核心]]   | JVM/GC、Spring/Dubbo、并发编程               |
| [[03-Python技术栈/index\|03 · Python 技术栈]] | 语言核心、异步并发、工程化、生态                       |
| [[04-数据库与中间件/index\|04 · 数据库与中间件]]      | MySQL、Redis、Elasticsearch、消息队列         |
| [[05-分布式与架构/index\|05 · 分布式与架构]]        | 一致性/事务、高可用/容灾、系统设计题                    |
| [[06-线上排障/index\|06 · 线上排障]]            | OOM/内存泄漏、慢查询/性能、全链路排查                  |
| [[07-基础与通识/index\|07 · 基础与通识]]          | 底层原理（OS/网络/CPU）+ 通用常识                  |
| [[08-应用安全/index\|08 · 应用安全]]            | 常见漏洞、认证授权、安全编码                         |
| [[09-技术管理/index\|09 · 技术管理]]            | 带团队、管项目、技术决策、招聘                        |

---

## 笔记格式

每个文件一个技术问题，文件名即问题本身。结构：

- **一句话速记** — 30 秒能背出来的核心答案
- **通俗解释** — 不含公式的直觉理解，5 分钟能看完
- **关键细节** — 被追问一层时用，含命令、配置、边界讨论
- **延伸追问** — 面试/实战中可能被继续追问的问题
- **我的记法** — 助记口诀或关键词锚点

---

## 标签体系

| 维度 | 标签 |
|------|------|
| 优先级 | `#P0` `#P1` `#P2` |
| 熟练度 | `#未动` `#生疏` `#能讲` `#已背熟` |
| 方向 | `#AI方向` `#Java方向` `#架构方向` `#通用` |
| 盲点类型 | `#真盲区` `#有底子` |
| 来源 | `#模考` `#实战题` `#课程笔记` |

---

## 使用约定

1. **一个文件 = 一个问题**，文件名就是问题原文，别用缩写
2. **新题从 `_临时/` 起草**，补全后再迁入对应模块
3. **每周日做一次 `_周复盘.md`**，不跳过

## Obsidian 配置约定

1. **图片放笔记同级的 `attachments/` 子目录**，粘贴截图自动存入（Settings → 文件与链接 → 附件默认存路径 → `./attachments`）
2. **frontmatter 后不加空行**，Obsidian 会把那个空行渲染成正文空段落

---

## 本周必做：P0 且生疏的题

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "" AND !"_临时" AND !"_模板" AND !"_附件"
WHERE contains(tags, "P0") AND contains(tags, "生疏")
SORT file.mtime ASC
```

## 最近 7 天更新的笔记

```dataview
LIST file.mtime
FROM "" AND !"_临时" AND !"_模板" AND !"_附件"
WHERE file.mtime >= date(today) - dur(7 days)
SORT file.mtime DESC
```

## 仍标记为「未动」的笔记

```dataview
LIST
FROM "" AND !"_临时" AND !"_模板" AND !"_附件"
WHERE contains(tags, "未动")
SORT file.name ASC
```
