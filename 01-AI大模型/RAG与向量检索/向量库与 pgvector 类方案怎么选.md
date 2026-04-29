---
tags: [P0, 真盲区, AI方向, 生疏]
来源: 知识库 · RAG
相关: [[RAG 的基本流程与局限]]
---

# 向量库与 pgvector 类方案怎么选

## 出处与发音

| 名字 | 音标 | 念法 | 出处 |
|------|------|------|------|
| **FAISS** | /feɪs/ | "fays"（同 face 去掉 e） | Meta（Facebook）AI Research，2019 年开源，全称 Facebook AI Similarity Search |
| **Chroma** | /ˈkroʊmə/ | "KRO-muh"（克罗-嬷） | Chroma 公司（前 Trychroma），2022 年开源，专为 LLM 应用设计的嵌入式向量库 |
| **Milvus** | /ˈmɪlvəs/ | "MIL-vus"（米尔-乌斯） | Zilliz 公司主导，2019 年开源，名字来自拉丁语"鸢"（一种猛禽），LF AI & Data 基金会项目 |
| **Qdrant** | /ˈkwɒdrənt/ | "KWOD-rənt"（象限） | 德国团队 Qdrant Solutions，2021 年开源，名字取自 quadrant（象限），暗指向量空间 |
| **pgvector** | /piː dʒiː ˈvektər/ | "pee-jee-VEK-ter" | Postgres 社区扩展，Jonathan Katz 等人维护，2021 年发布，直接在 PostgreSQL 里加向量索引 |

## 一句话速记
- **FAISS**：本地/原型，纯索引库，无持久化无服务，适合快速验证
- **Chroma**：开发阶段首选，内置持久化+元数据过滤，小规模 RAG 快速落地
- **Milvus**：大规模生产，分布式，K8s 生态，运维成本最高
- **pgvector**：已用 Postgres 做主存、量不大、要向量与业务数据同库

## 产品取向对照

| 维度 | FAISS | Chroma | Milvus | Qdrant | pgvector |
|------|-------|--------|--------|--------|----------|
| 常见定位 | 本地/原型，Meta 出品，纯索引库 | 本地/小规模，开发首选，内置持久化+元数据 | 大规模生产，K8s 生态，分布式向量专库 | 中大规模，自托管易用，API 好 | OLTP+向量同库，Postgres 扩展 |
| 部署形态 | Python 库，无服务进程 | 本地文件/嵌入式，也有 Cloud | 独立服务/集群（Etcd + MinIO + 多组件） | 独立服务 | Postgres 插件 |
| 规模 | 内存级（< 百万级） | 小（几十万级） | 亿级+ | 中大规模 | 中等；大了要分区 |
| 元数据过滤 | ❌ 不支持（需自己管） | ✅ 支持 where 过滤 | ✅ 强 | ✅ 强 | SQL WHERE 天然支持 |
| 持久化 | ❌ 无（需自己 serialize） | ✅ 默认持久化 | ✅ 有 | ✅ 有 | ✅ Postgres 本身 |
| 多租户/权限 | ❌ | ❌ 基础 | ✅ | ✅ | SQL 行级权限天然支持 |
| 运维成本 | 极低（一个 pip 包） | 低 | 高 | 中 | 低（熟 Postgres 即可） |

## 面试"三者怎么选"一句话版

- **FAISS**：本地跑 demo，不需要服务，只需要一个 Python 包来算近邻，上生产不用它
- **Chroma**：开发阶段快速验证 RAG pipeline，有元数据过滤，开箱即用，但不是生产首选
- **Milvus**：生产环境大规模向量检索，分布式，功能最全，运维成本也最高

**三者关系**：原型 → Chroma / FAISS；生产 → Milvus / Qdrant / pgvector，根据规模和运维能力选。

## 与「只存文件 + 内存 FAISS」

- 原型可用 **FAISS / Chroma** 等本地索引 + 自管元数据
- **上生产** 往往要持久、HA、多租户隔离、权限、可观测 → 进 Milvus 等专用库或托管方案
- **Dify 内置知识库**底层是可配置的向量库（支持 pgvector / Milvus / Qdrant）——这是你最直接的实战背书，面试里可以这样讲：「我在 Dify 的多环境部署中配置过不同的向量库后端，理解它们在持久化和检索性能上的差异。」

## 延伸追问

- **Q：为何不用 MySQL 存向量？**  
  答：传统行存 + B 树不为高维近邻优化；专用库用 HNSW/IVF，查询性能差距 10-100x；需要向量功能就用专用库或 pgvector。

- **Q：元数据 + 向量必须同库吗？**  
  答：不必须，但同库减少两致性和跨系统对账；大规模常 ID 外链在行存、向量在专库，用业务 ID 回联。

- **Q：HNSW 和 IVF 怎么选？**  
  答：**HNSW**：图+贪心，查询快、召回高，内存与建索引成本高，适合中等规模要低延迟；**IVF/PQ**：省空间、可扩超大库，要调聚类/量化参数，适合极大规模。

## 我的记法

- **FAISS = 算法课的手工具，生产用不了**
- **Chroma = 开发时的便利贴，够用但不持久**
- **Milvus = 生产向量库的首选，但运维重**
- **pgvector = 已有 Postgres 就加一个插件，省事**
- 一句话：**「选库先问规模：demo → FAISS/Chroma，生产 < 千万 → pgvector/Qdrant，生产 > 千万 → Milvus」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问

## 参考资料
- [FAISS 官方文档](https://faiss.ai/)
- [Chroma 官方文档](https://docs.trychroma.com/)
- [Milvus 官方文档](https://milvus.io/docs)
- pgvector 的 HNSW/IVF 文档
