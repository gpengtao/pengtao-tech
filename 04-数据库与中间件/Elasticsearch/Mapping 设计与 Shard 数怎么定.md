---
tags: [P0, ES, 生疏]
相关: [[04-数据库与中间件/_MOC]]
---

# Mapping 设计 / Shard 数怎么定

## 一句话速记

**Mapping 设计原则**：明确字段类型（text vs keyword，date vs long），禁用不需要的特性（`index: false`，`doc_values: false`），避免字段爆炸（Dynamic Mapping 的坑）；**Shard 数原则**：一个 Shard 控制在 10~50GB，单 Shard 文档数 < 2亿，不要过分多（影响搜索性能），且 **Shard 数一旦创建不可修改**（只有通过 Reindex 才能改）。

## 关键细节

### 1）字段类型选择

```
text：
  - 全文搜索字段（标题、描述、内容）
  - 会被分词，不能精确查询、排序、聚合
  - 占用空间大（存倒排索引）

keyword：
  - 不分词，精确匹配（ID、状态码、标签、枚举值）
  - 支持排序、聚合、精确查询
  - 最大长度 32766 字节（超过会报错）

text + keyword（multi-field，常用）：
  {
    "title": {
      "type": "text",        // 用于全文搜索
      "analyzer": "ik_max_word",
      "fields": {
        "keyword": {
          "type": "keyword",  // 用于精确匹配/排序/聚合
          "ignore_above": 256 // 超过 256 字符的 keyword 不建索引
        }
      }
    }
  }

date：
  "created_at": { "type": "date", "format": "yyyy-MM-dd HH:mm:ss||epoch_millis" }
  避免用 string 存时间（无法范围查询）

numeric：
  integer, long, float, double
  避免用 keyword 存数字（range 查询会走全扫）

nested（嵌套对象）：
  对象数组需要用 nested 类型，否则跨对象的字段关联查询不准确
  代价：每个 nested 对象是独立的隐藏文档，聚合/查询开销大
```

### 2）Mapping 设计最佳实践

```json
PUT /hotel_index
{
  "mappings": {
    "dynamic": "strict",  // 禁止动态新增字段（防止字段爆炸）
    "properties": {
      "hotel_id":    { "type": "keyword" },  // 唯一 ID → keyword
      "name":        {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",  // 搜索时用更少分词
        "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } }
      },
      "city":        { "type": "keyword" },  // 城市 → 枚举，keyword
      "star_level":  { "type": "integer" },  // 星级 → 数字，范围查询
      "price":       { "type": "scaled_float", "scaling_factor": 100 },  // 价格
      "description": { "type": "text", "analyzer": "ik_max_word" },  // 描述 → 全文
      "updated_at":  { "type": "date", "format": "epoch_millis" },
      "location":    { "type": "geo_point" },  // 地理坐标（附近搜索）
      
      // 不需要搜索，只用于展示的字段
      "thumbnail_url": { "type": "keyword", "index": false },  // index:false = 不建倒排索引
      
      // 不需要排序/聚合的纯文本字段
      "raw_content": { "type": "text", "doc_values": false }  // 节省磁盘
    }
  }
}
```

**Dynamic Mapping 的坑**：

```
默认 "dynamic": "true" 时：
  新文档中的未知字段 → 自动推断类型并加入 Mapping
  
  坑 1：字段爆炸（Field Explosion）
    JSON 的 key 不固定（如 user 自定义属性）→ Mapping 字段数暴增
    → Cluster State 变大，内存压力增大（Mapping 存在 master 内存中）
  
  坑 2：类型推断错误
    "order_id": "123456789" → 推断为 text（按字符串存）
    后来想用 long 范围查询 → 不行！

  解法：
    "dynamic": "strict"（报错，拒绝未知字段）
    "dynamic": "false"（忽略未知字段，不建索引但存储）
    明确 Mapping，禁止动态推断
```

### 3）Shard 数如何设计

**核心原则**：

```
一个 Shard 的建议大小：
  日志/时序：每个 Shard 10~30GB（文档数量大，每条较小）
  搜索业务：每个 Shard 20~50GB（文档数量中等，内容较大）
  单 Shard 文档数：< 2 亿（Lucene 单 Segment 限制 2^31 文档）

计算方式：
  预计总数据量 / 目标 Shard 大小 = Primary Shard 数
  
  例：预计 100GB 数据，目标每 Shard 20GB → 5 个 Primary Shard
  考虑 1 年增长：5 × 1.5 = 7~8 个 Shard（留余量）

Replica Shard：
  每个 Primary 配 1~2 个 Replica（高可用 + 读分流）
  3 节点集群：建议 2 个 Replica
```

**Shard 过多的危害**：

```
每个 Shard 是一个 Lucene 实例（JVM + 文件句柄）
Shard 太多：
  - 文件句柄耗尽（每个 Shard 至少几百个 fd）
  - 搜索时每个 Shard 都要扫描（scatter-gather），Shard 越多协调成本越高
  - Master 节点 Cluster State 变大
  
原则：宁可 Shard 偏大（50GB），也不要 Shard 过多（1000+）
"Oversharding is the most common ES performance problem" — Elastic官方
```

**Shard 数不够的问题（已创建，无法修改）**：

```
Primary Shard 数创建后不能修改！
  原因：文档路由规则 shard = hash(routing) % primary_shard_count
  修改 Shard 数 → 路由规则变化 → 旧数据找不到
  
  唯一解法：Reindex（创建新索引，重新导入数据）
  
避免方式：
  初始 Shard 数适当冗余（宁多勿少，但别太多）
  或用时间索引（按月/按季）：每个时间窗口创建新索引，Shard 数可以不同
  
Replica Shard 数可以随时修改！
  PUT /my_index/_settings
  { "number_of_replicas": 2 }
```

### 4）分片策略示例

```json
// 创建索引时指定 Shard 数
PUT /products
{
  "settings": {
    "number_of_shards": 5,    // Primary Shard（不可改）
    "number_of_replicas": 1,  // Replica Shard（可改）
    "refresh_interval": "1s"  // 近实时刷新间隔（bulk 写入时可设为 -1 关闭）
  }
}

// 时间索引（按月）：适合日志/时序
// 索引名：products_2024_01, products_2024_02, ...
// 别名：products → 指向所有月度索引（用于搜索）
// 写别名：products_write → 只指向当月索引
```

## 延伸追问

- **Q：Mapping 中 `index: false` 和 `store: true` 有什么区别？**
  → `index: false`：不建倒排索引，无法搜索（但存储在 `_source` 中可以返回）；`store: true`：额外单独存储该字段的值（默认不 store，ES 通过解析 `_source` 返回字段）。通常不需要 `store: true`，除非 `_source` 被禁用且需要单独读取特定字段。
- **Q：一个索引多少 Shard 合适，7 个节点怎么分配？**
  → 一般推荐 Primary Shard 数 = 节点数或节点数的整数倍，保证均匀分布。7 节点：可以 7 Primary Shard（每节点 1 个 Primary）或 14 Primary Shard（每节点 2 个 Primary）。加上 1 个 Replica，每个节点有 Primary + Replica，总 Shard 数 = 14 或 28，合理。
- **Q：为什么中文搜索要用 `ik_max_word` 建索引，`ik_smart` 搜索？**
  → 建索引时用最细粒度分词（`ik_max_word`），保证任何可能的查询词都能匹配；搜索时用智能分词（`ik_smart`，词粒度较大），减少召回（提高精准度），避免搜"机器学习"被拆成"机器"和"学习"各自匹配，导致不相关结果过多。

## 我的记法

- **text** = 分词全文搜索；**keyword** = 精确匹配/排序/聚合；**multi-field** = 都要
- `dynamic: strict` 防字段爆炸；`index: false` 省存储
- **Shard 大小**：10~50GB，不是越多越好
- **Primary Shard 不可改**，创建时想清楚；Replica 随时可改
- Oversharding 是最常见的 ES 性能问题
- 一句话：**「Mapping 要预设好字段类型，Shard 数按数据量算，建完改不了」**

## 状态
- [ ] 已背速记
- [ ] 能写 text + keyword multi-field 的 Mapping
- [ ] 能说 Shard 数计算方法
