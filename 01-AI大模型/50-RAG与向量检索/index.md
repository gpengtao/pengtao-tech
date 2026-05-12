---
tags: [MOC, AI方向, RAG]
priority: P0
---
# RAG 与向量检索 · 内容地图

> **对象**：把**外部知识**以**可检索**形式接到 **LLM 生成**前的管线；与纯参数记忆、纯提示词注入区分。  
> **建议顺序**：总流程 → 切块 → 向量与库 → Rerank → 评估。

---

## 导航

1. [[01-AI大模型/RAG与向量检索/RAG 的基本流程与局限|RAG 的基本流程与局限]]
2. [[01-AI大模型/RAG与向量检索/Chunking 有哪些常用策略|Chunking 有哪些常用策略]]
3. [[01-AI大模型/RAG与向量检索/Embedding 模型怎么选|Embedding 模型怎么选]]
4. [[01-AI大模型/RAG与向量检索/向量库与 pgvector 类方案怎么选|向量库与 pgvector 类方案怎么选]]
5. [[01-AI大模型/RAG与向量检索/为什么 RAG 还需要 Rerank|为什么 RAG 还需要 Rerank]]
6. [[01-AI大模型/RAG与向量检索/检索与排序效果怎么评（Recall、MRR、nDCG）|检索与排序效果怎么评（Recall、MRR、nDCG）]]

---

## 本目录动态

```dataview
TABLE file.mtime AS "最近更新", tags
FROM "01-AI大模型/RAG与向量检索"
WHERE file.name != "index.md" AND !contains(file.name, ".gitkeep")
SORT file.mtime DESC
```
