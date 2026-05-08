---
tags: [P1, ES, 生疏]
相关: "[[04-数据库与中间件/_MOC]]"
---

# Version 冲突 / 乐观并发控制（if_seq_no + if_primary_term）

## 一句话速记

**ES 的乐观并发控制（OCC）**：用 `if_seq_no` + `if_primary_term` 组合作为版本条件——只有当文档的序列号 == 指定值时，更新才成功；否则返回 409（Version Conflict）。`_version` 字段已被弃用（内部版本号），现在用 `_seq_no` + `_primary_term` 更可靠。适用场景：防止"先读后写"的并发覆盖问题（与数据库乐观锁一致）。

## 关键细节

### 1）为什么需要版本控制

```
并发问题场景：
  t=0：客户端 A 读取文档 hotel:123，price=200，_seq_no=10
  t=1：客户端 B 读取文档 hotel:123，price=200，_seq_no=10
  t=2：客户端 A 更新 price=250，成功，_seq_no=11
  t=3：客户端 B 更新 price=180，成功，_seq_no=12
  → 客户端 A 的更新被 B 覆盖！（最后写赢，Last Write Wins）

使用 OCC：
  t=0：A 读取 price=200，_seq_no=10
  t=1：B 读取 price=200，_seq_no=10
  t=2：A 用 if_seq_no=10 更新 price=250 → 成功，_seq_no 变为 11
  t=3：B 用 if_seq_no=10 更新 price=180 → 失败！（409，当前 _seq_no=11 != 10）
  → B 需要重新读取最新数据后重试
```

### 2）_seq_no + _primary_term 详解

```
_seq_no（Sequence Number）：
  每个分片内全局单调递增
  每次文档的创建、更新、删除都会递增
  相当于该分片上的"操作序号"
  
_primary_term：
  Primary Shard 的任期号（类比 Raft 的 term）
  每次 Primary Shard 重新选举（故障切换），term +1
  防止"旧 Primary"的写操作覆盖"新 Primary"的数据
  
组合使用：
  (primary_term=1, seq_no=100) 和 (primary_term=2, seq_no=50) 两个版本
  primary_term 更大的更新优先（即使 seq_no 更小）
  → 确保分片故障切换后的正确性
```

### 3）实际 API 使用

**读取文档，获取版本信息**：

```json
GET /hotel/_doc/123

// 响应：
{
  "_index": "hotel",
  "_id": "123",
  "_version": 3,
  "_seq_no": 25,           // ← 记录这两个值
  "_primary_term": 1,      // ← 
  "_source": { "price": 200, "name": "Marriott" }
}
```

**条件更新（OCC）**：

```json
// 方式 1：直接 PUT 带版本条件
PUT /hotel/_doc/123?if_seq_no=25&if_primary_term=1
{
  "price": 250,
  "name": "Marriott"
}
// 成功：200，_seq_no 变为 26
// 失败（seq_no 不匹配）：409 Version Conflict

// 方式 2：Update API
POST /hotel/_update/123?if_seq_no=25&if_primary_term=1
{
  "doc": { "price": 250 }
}
```

**Java 代码示例**：

```java
// 使用 ES Java Client（High Level REST Client 或 ES Java API Client）
GetResponse<Hotel> getResponse = client.get(g -> g
    .index("hotel")
    .id("123")
, Hotel.class);

long seqNo = getResponse.seqNo();
long primaryTerm = getResponse.primaryTerm();
Hotel hotel = getResponse.source();

// 修改
hotel.setPrice(250);

// 条件更新
try {
    IndexResponse indexResponse = client.index(i -> i
        .index("hotel")
        .id("123")
        .document(hotel)
        .ifSeqNo(seqNo)
        .ifPrimaryTerm(primaryTerm)
    );
} catch (ElasticsearchException e) {
    if (e.status() == RestStatus.CONFLICT) {
        // 409 Version Conflict，重新读取并重试
        retryUpdate("123");
    }
}
```

### 4）外部版本号（External Versioning）

```json
// 使用外部系统的版本号（如 MySQL 的 updated_at 时间戳）
// 只有当 ES 存储的版本 < 外部版本时，才接受更新
PUT /hotel/_doc/123?version=1706000000&version_type=external
{ "price": 250 }
// 如果 ES 当前 version < 1706000000 → 接受更新
// 如果 ES 当前 version >= 1706000000 → 409 Conflict

// 用途：DB → ES 同步时，用 DB 的时间戳作为版本号，保证数据最终一致
```

### 5）Reindex / Bulk 时的版本冲突处理

```json
// Reindex 时忽略版本冲突（允许目标索引已有更新的版本）
POST /_reindex
{
  "source": { "index": "hotel_v1" },
  "dest": {
    "index": "hotel_v2",
    "op_type": "create"   // 只创建，不覆盖已存在的文档（冲突时跳过）
    // 或不设 op_type，用 version_type: external
  },
  "conflicts": "proceed"  // 遇到冲突时跳过，继续 Reindex（不中断）
}
// 返回结果中的 version_conflicts 字段显示跳过数量
```

## 延伸追问

- **Q：`_version` 和 `_seq_no` 有什么区别？为什么改用 `_seq_no`？**
  → `_version` 是文档级别的计数器（每次更新 +1），跨分片的版本语义不清晰，且存在分片故障转移时的歧义。`_seq_no + _primary_term` 是分片级别的严格有序序列，结合 primary_term 能准确处理主分片切换的情况，版本语义更明确。ES 6.7+ 开始推荐用 `_seq_no`。
- **Q：ES 的 OCC 和数据库乐观锁的区别？**
  → 思路相同（先读版本，条件更新），但实现层面：数据库乐观锁通常用 `WHERE version=old_version` 的 SQL；ES 用 HTTP 参数 `if_seq_no + if_primary_term`。失败时 ES 返回 HTTP 409，业务层需要捕获并重试。
- **Q：高并发下 OCC 重试多次失败怎么办？**
  → 设置最大重试次数（如 3 次），超过后返回服务忙。也可以用指数退避（每次重试 sleep 时间翻倍）。如果业务本质上是"最后写赢"（不关心版本冲突），则不需要 OCC，直接覆盖写即可。

## 我的记法

- **OCC**：读 → 记录 `_seq_no + _primary_term` → 条件更新 → 409 重试
- `_seq_no` 是分片内的操作序号，`_primary_term` 是主分片任期号
- ES 6.7+ 推荐用 `if_seq_no + if_primary_term`，不用旧的 `_version`
- Reindex 冲突：`"conflicts": "proceed"` 跳过冲突继续
- 一句话：**「ES 乐观锁 = if_seq_no + if_primary_term，冲突返回 409 重读重试」**

## 状态
- [ ] 已背速记
- [ ] 能写读 → 条件更新 → 重试的完整流程
- [ ] 能解释 _seq_no 和 _primary_term 的含义
