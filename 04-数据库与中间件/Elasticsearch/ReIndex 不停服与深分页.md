---
tags: [P1, ES, 生疏]
相关: "[[04-数据库与中间件/_MOC]]"
---

# ReIndex 如何做到不停服 / 深分页：search_after + PIT vs scroll

## 一句话速记

**ReIndex 不停服**：用**别名（Alias）+ 双写过渡**——新索引准备好后，切别名指向新索引，业务感知不到；**深分页**：`from + size` 在深页时全 Shard 拉大量数据再合并（性能差），应换用 `search_after`（游标翻页，每次只取下一页）+ **PIT（Point In Time）**（固定快照，防止翻页时数据变化导致结果不稳定）。

## 关键细节

### 1）ReIndex 不停服方案

**场景**：需要修改 Mapping（如新增字段、修改分词器、修改 Shard 数）

```
为什么普通 Reindex 会停服：
  原索引继续接收写入
  Reindex 过程中（几小时）原索引有新数据
  Reindex 完成后切换 → 新索引缺少 Reindex 期间的增量数据
```

**不停服 Reindex 标准步骤**：

```
Step 1：准备新索引
  PUT /hotel_index_v2
  { "mappings": {...新Mapping}, "settings": {...} }

Step 2：创建写别名（指向旧索引）
  POST /_aliases
  {
    "actions": [
      { "add": { "index": "hotel_index_v1", "alias": "hotel_write" } }
    ]
  }
  
  业务代码始终写 "hotel_write" 别名（不关心底层索引名）

Step 3：开始 Reindex（后台执行）
  POST /_reindex?wait_for_completion=false
  {
    "source": { "index": "hotel_index_v1", "size": 5000 },  // 批量大小
    "dest":   { "index": "hotel_index_v2" }
  }
  
  Reindex 期间：业务继续写 hotel_v1（新数据在 v1，历史数据在迁移到 v2）

Step 4：开启双写（Reindex 进行中）
  修改业务代码，同时写 v1 和 v2（或修改别名 hotel_write 同时指向 v1 和 v2）
  
  方案 A：代码层双写（应用层处理）
  方案 B：别名多索引（一个别名指向多个索引，ES 会写入所有）
  
  注意：双写期间 v1 的增量数据会同步到 v2
  但 Reindex 在进行的历史数据迁移可能和双写有重复 → 需要幂等（ES _id 覆盖）

Step 5：Reindex 完成，数据校验
  比较 v1 和 v2 的文档数
  抽样校验关键文档
  
Step 6：原子切换别名（切搜索流量）
  POST /_aliases
  {
    "actions": [
      { "remove": { "index": "hotel_index_v1", "alias": "hotel_search" } },
      { "add":    { "index": "hotel_index_v2", "alias": "hotel_search" } }
    ]
  }
  // 这是原子操作，没有中间状态

Step 7：停止写 v1，只写 v2
  修改 hotel_write 别名只指向 v2
  
Step 8：保留 v1 一段时间（回滚用），确认稳定后删除
```

### 2）深分页问题分析

**`from + size` 的问题**：

```
search with from=10000, size=10

流程：
  Coordinator Node 向所有 N 个 Shard 发请求
  每个 Shard：按排序取前 10010 条（from + size）
  Coordinator 收到 N × 10010 条，合并排序，取第 10001~10010 条

代价：
  - 每个 Shard 需要在内存中排序 10010 条
  - 网络传输 N × 10010 × (doc元数据) 
  - Coordinator 内存 N × 10010 条合并排序
  
  from 越大，代价越高（O(from × shards)）
  默认 max_result_window = 10000，超过报错
```

**`search_after`（推荐翻页方式）**：

```json
// 第一页：
GET /hotel/_search
{
  "size": 10,
  "sort": [
    { "price": "asc" },
    { "_id": "asc" }       // 加 _id 作为 tiebreaker（保证唯一排序）
  ]
}
// 返回 hits[-1] 的 sort 值：[200, "hotel_123"]

// 第二页：
GET /hotel/_search
{
  "size": 10,
  "sort": [{ "price": "asc" }, { "_id": "asc" }],
  "search_after": [200, "hotel_123"]  // 从上一页最后一条的 sort 值开始
}
// 每次只取 10 条，无需大 offset → 性能稳定，O(size) 无关页数
```

**`search_after` 的问题：数据变动导致翻页不一致**：

```
翻第 3 页时，第 2、3 页之间新插入了文档
→ 第 3 页结果偏移，可能跳过某些文档 或 重复某些文档
```

**PIT（Point In Time）—— 解决翻页一致性**：

```json
// Step 1：创建 PIT（固定一个快照）
POST /hotel/_pit?keep_alive=5m  // 保存 5 分钟
// 返回：{ "id": "46ToAwMDaWR5..." }

// Step 2：使用 PIT 进行翻页（快照固定，结果稳定）
GET /_search
{
  "size": 10,
  "sort": [{ "price": "asc" }, { "_id": "asc" }],
  "pit": {
    "id": "46ToAwMDaWR5...",
    "keep_alive": "5m"
  }
}
// PIT 期间，索引的修改不影响搜索结果（快照隔离）

// Step 3：翻页
GET /_search
{
  "size": 10,
  "sort": [{ "price": "asc" }, { "_id": "asc" }],
  "pit": { "id": "46ToAwMDaWR5...", "keep_alive": "5m" },
  "search_after": [200, "hotel_123"]
}

// Step 4：翻页完成后关闭 PIT
DELETE /_pit
{ "id": "46ToAwMDaWR5..." }
```

**scroll（旧方案，不推荐用于分页）**：

```json
// scroll 保存搜索上下文（包含 Shard 状态）
GET /hotel/_search?scroll=1m
{ "size": 100, "sort": ["_doc"] }
// 返回 scroll_id

// 继续翻页
POST /_search/scroll
{ "scroll": "1m", "scroll_id": "..." }

// 问题：
// 1. scroll_id 保存整个搜索上下文（占 Heap 内存）
// 2. 大量并发 scroll → OOM 风险
// 3. 不能跳页（必须按顺序翻）
// 适用：数据导出（一次性遍历所有数据），不适合实时翻页
```

**三种分页方式对比**：

```
方式          适用场景              性能        一致性      可跳页
from+size     小数据集（<10000）   O(from×shards)  否      ✅
search_after  列表翻页（任意深度）  O(size)        弱（数据变动）✅（需带 sort 值）
PIT+search_after  实时精确翻页    O(size)        ✅（快照）  ✅
scroll        批量导出全量数据     O(batch)       ✅         ❌（顺序）
```

## 延伸追问

- **Q：PIT 的 `keep_alive` 过期了怎么办？**
  → PIT 过期后尝试使用会报错（`SearchContextMissingException`）。需要重新创建 PIT 并从第一页开始。设计翻页 API 时，客户端需要缓存 `pit_id`，并在每次请求时更新（每次请求可以延长 keep_alive）。
- **Q：`search_after` 能不能向前翻页（返回上一页）？**
  → `search_after` 本质是游标，只能向前翻。向后翻需要反转排序字段（如 `price: desc`）从上一页第一条的 sort 值开始查，然后将结果反转。实现复杂，大多数业务（如列表滚动加载）不需要后退翻页。
- **Q：Reindex 期间索引性能会受影响吗？**
  → 会有影响。Reindex 是大量读 v1 + 写 v2 的操作，会消耗 I/O、CPU、网络。可以通过 `requests_per_second` 参数限速（如 `POST /_reindex?requests_per_second=1000`）控制速率，避免影响线上查询性能。

## 我的记法

- **Reindex 不停服**：别名 + 双写 + 原子切换别名
- **深分页**：`from+size` 性能 O(from × shards)，深页极慢
- **search_after**：游标翻页，O(size)，需加 tiebreaker（`_id`）
- **PIT**：固定快照 + search_after，翻页结果一致
- **scroll**：数据导出专用，不适合实时分页
- 一句话：**「深分页用 search_after + PIT，不停服 Reindex 用别名原子切换」**

## 状态
- [ ] 已背速记
- [ ] 能写 search_after + PIT 的完整查询
- [ ] 能说 Reindex 不停服的 8 个步骤
