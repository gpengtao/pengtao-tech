---
tags: [P1, 系统设计, 生疏]
相关: "[[05-分布式与架构/_MOC]]"
---

# 设计 RAG 问答系统

## 一句话速记

RAG（Retrieval-Augmented Generation）= **检索（Retrieval）+ 生成（Generation）**。用户提问 → Embedding 向量化 → 向量数据库检索最相关的文档片段 → 拼接到 Prompt → LLM 生成答案。核心挑战：**检索质量**（召回率 + 精准率）、**LLM 幻觉控制**（只基于检索内容回答）、**延迟**（向量检索 + LLM 推理的叠加）。

## 系统架构

```
离线（Indexing Pipeline）：
文档 → 分块（Chunking）→ Embedding 模型 → 向量 → 向量数据库（Milvus/Qdrant）
                                                → 原文 → 文档存储（MongoDB/ES）

在线（Query Pipeline）：
用户问题 → Query Embedding → 向量检索（Top-K）→ Rerank（重排序）
         → 构建 Prompt（问题 + 检索到的上下文）→ LLM → 流式输出答案
```

## 核心组件设计

### 1）文档处理（离线 Indexing）

**分块策略（Chunking）**：

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 固定大小分块（简单但可能切断语义）
splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,      # 每块 512 个 Token
    chunk_overlap=50,    # 前后 50 Token 重叠（保留语义连续性）
    separators=["\n\n", "\n", "。", " "]  # 优先按段落，再按句子
)
chunks = splitter.split_text(document)

# 更好的策略：语义分块（按语义边界，而不是固定大小）
# 用 LLM 识别段落主题，相同主题的句子归为一块

# 每个 chunk 附加元数据（用于过滤和溯源）
chunk_with_metadata = {
    "text": chunk,
    "metadata": {
        "doc_id": "doc-123",
        "source": "产品手册.pdf",
        "page": 5,
        "section": "第二章 安装指南",
        "created_at": "2024-01-01"
    }
}
```

**Embedding 向量化**：

```python
from openai import OpenAI

client = OpenAI()

def embed_text(text: str) -> list[float]:
    """将文本转换为向量"""
    response = client.embeddings.create(
        model="text-embedding-3-small",  # 1536 维
        input=text
    )
    return response.data[0].embedding  # List[float]，长度 1536

# 批量 Embedding（节省 API 调用次数）
def embed_batch(texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts  # 最多 2048 条
    )
    return [item.embedding for item in response.data]
```

**向量写入 Milvus**：

```python
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType

# 创建集合（表）
fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
    FieldSchema(name="chunk_id", dtype=DataType.VARCHAR, max_length=64),
    FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=2048),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
    FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=64),
    FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=256),
]
schema = CollectionSchema(fields)
collection = Collection("knowledge_base", schema)

# 创建 HNSW 索引（检索速度 vs 精度的平衡）
collection.create_index("embedding", {
    "index_type": "HNSW",
    "metric_type": "COSINE",     # 余弦相似度
    "params": {"M": 16, "efConstruction": 200}
})
```

### 2）在线查询

**向量检索 + Rerank**：

```python
def retrieve(query: str, top_k: int = 20) -> list[dict]:
    # 1. Query Embedding
    query_embedding = embed_text(query)
    
    # 2. 向量检索（初召回 Top-20，比最终 Top-5 多几倍）
    results = collection.search(
        data=[query_embedding],
        anns_field="embedding",
        param={"metric_type": "COSINE", "params": {"ef": 100}},
        limit=top_k,
        output_fields=["chunk_id", "text", "source"]
    )
    
    candidates = [{"text": r.entity.get("text"), 
                   "source": r.entity.get("source"),
                   "score": r.score} for r in results[0]]
    
    # 3. Rerank（精排，提升精准率）
    # 用 Cross-Encoder 模型（比 Bi-Encoder 精度高，但速度慢）
    reranked = reranker.rerank(query, candidates, top_n=5)
    return reranked

# Reranker 选项：
# - Cohere Rerank API（调用简单）
# - BGE-Reranker（开源，本地部署）
# - LLM as Reranker（用 LLM 给候选打分，效果好但贵）
```

**构建 Prompt + LLM 生成**：

```python
def answer(query: str) -> str:
    # 1. 检索相关上下文
    contexts = retrieve(query, top_k=20)
    
    # 2. 构建 Prompt
    context_text = "\n\n---\n\n".join([
        f"[来源: {c['source']}]\n{c['text']}" 
        for c in contexts
    ])
    
    prompt = f"""你是一个专业助手，请根据以下参考资料回答用户问题。
如果参考资料中没有相关信息，请明确说明"根据已有资料，无法回答该问题"，不要编造答案。

参考资料：
{context_text}

用户问题：{query}

回答："""
    
    # 3. 流式调用 LLM
    stream = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        temperature=0.1  # 低温度，减少随机性（准确性优先）
    )
    
    # 4. 流式返回（SSE）
    for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

### 3）检索质量优化

**混合检索（Hybrid Search）**：

```python
# 向量检索（语义相似）+ 关键词检索（精确匹配）
# 通过 RRF（Reciprocal Rank Fusion）融合两路结果

def hybrid_search(query: str) -> list[dict]:
    # 向量检索（语义）
    vector_results = milvus.search(embed(query), top_k=20)
    
    # BM25 关键词检索（精确，适合专有名词）
    keyword_results = elasticsearch.search({"match": {"text": query}}, size=20)
    
    # RRF 融合（k=60 是经验值）
    k = 60
    scores = {}
    for rank, doc in enumerate(vector_results):
        scores[doc.id] = scores.get(doc.id, 0) + 1 / (k + rank + 1)
    for rank, doc in enumerate(keyword_results):
        scores[doc.id] = scores.get(doc.id, 0) + 1 / (k + rank + 1)
    
    # 按融合得分排序
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)[:10]
```

**Query 优化**：

```python
# HyDE（Hypothetical Document Embeddings）
# 先让 LLM 生成一个假设性答案，用答案向量去检索（比 Query 向量更接近文档分布）
def hyde_search(query: str) -> list[dict]:
    hypothetical_answer = llm.generate(
        f"请简短回答以下问题（不超过100字）：{query}"
    )
    return retrieve(hypothetical_answer + " " + query)  # 问题 + 假设答案组合检索

# Query 扩展（Query Expansion）
# 生成同义词/相关表达，扩大召回
def expand_query(query: str) -> list[str]:
    variations = llm.generate(
        f"为以下问题生成3个语义相近的表达方式，用换行分隔：\n{query}"
    )
    return [query] + variations.split("\n")
```

### 4）系统可观测性

```python
# 每次查询记录评估指标
@dataclass
class QueryLog:
    query: str
    retrieved_chunks: list[str]
    answer: str
    latency_ms: float
    context_relevance: float  # 检索相关性评分（0-1）
    answer_faithfulness: float  # 答案忠实度（是否基于检索内容）
    
# 用 RAGAS 框架自动评估
from ragas import evaluate
from ragas.metrics import context_recall, context_precision, faithfulness, answer_relevancy

result = evaluate(
    dataset,
    metrics=[context_recall, context_precision, faithfulness, answer_relevancy]
)
```

### 5）延迟优化

```
端到端延迟 = Embedding（50ms）+ 向量检索（20ms）+ Rerank（100ms）+ LLM（1-5s）

优化方向：
  1. 流式输出（Streaming）：LLM 生成第一个 token 就开始返回（TTFT < 500ms）
  2. 缓存常见问题的答案（Redis，TTL=1h）
  3. Rerank 可选（简单问题跳过，复杂问题启用）
  4. 更小的 LLM（GPT-4o-mini 替代 GPT-4o，速度 3x，成本 10x 低）
  5. 向量检索并行化（多集合同时检索，取 union）
```

## 延伸追问

- **Q：如何评估 RAG 系统质量？**
  → 用 RAGAS 框架评估四个维度：Context Recall（检索覆盖率）、Context Precision（检索精准率）、Faithfulness（答案是否基于检索内容）、Answer Relevancy（答案是否回答了问题）。可以用 LLM 作为 Judge 自动打分（LLM-as-Judge）。
- **Q：向量数据库选哪个？**
  → Milvus（开源，功能完整，支持分布式）用于自托管大规模；Pinecone（云服务，开箱即用）用于快速验证；Qdrant（Rust 实现，性能好，也开源）；pgvector（PostgreSQL 扩展，适合已有 PG 的场景，省去额外组件）。

## 我的记法

- RAG = **分块 → Embedding → 向量库 → 检索 → Rerank → Prompt → LLM**
- 检索：向量（语义）+ BM25（关键词）混合，RRF 融合
- 质量：Rerank + HyDE + Query 扩展
- 评估：RAGAS（Recall/Precision/Faithfulness/Relevancy）
- 延迟：流式输出 + 缓存热门问题 + 小模型替代
- 一句话：**「文档向量化入库，问题向量化检索，检索结果拼 Prompt 给 LLM 生成答案」**

## 状态
- [ ] 已背速记
- [ ] 能画 RAG 的离线和在线架构
- [ ] 能解释混合检索（向量+BM25）
