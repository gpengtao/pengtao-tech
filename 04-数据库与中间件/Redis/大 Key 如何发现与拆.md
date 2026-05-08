---
tags: [P1, Redis, 生疏]
相关: "[[04-数据库与中间件/index]]"
---

# 大 Key 如何发现 / 如何拆

## 一句话速记

**大 Key** = 单个 Key 的 Value 体积过大（String > 10KB，集合类型元素数 > 5000 或总大小 > 10MB）。危害：**阻塞 Redis**（单线程，del/序列化大对象耗时长）、**内存倾斜**（Cluster 某节点过大）、**网络带宽打满**。发现：`redis-cli --bigkeys` 或 RDB 分析；拆解：**垂直拆分**（按字段）、**水平拆分**（按 ID 哈希）；删除大 Key 用 `UNLINK`（异步删除）。

## 关键细节

### 1）大 Key 的危害

```
Redis 是单线程处理命令：
  GET 一个 100MB 的 String → 需要几十毫秒序列化 + 传输
  → 这段时间其他命令全部阻塞
  → 表现：Redis 延迟毛刺（P99 暴增）

DEL 大 Key 会阻塞（同步删除整个对象）：
  DEL key（10w 个 hash field）→ 阻塞 Redis 几百毫秒 → 线上故障

Redis Cluster 内存倾斜：
  某个 slot 的 Key 很大 → 该节点内存远高于其他节点
  → 触发扩容或 OOM
```

### 2）发现大 Key

**方法 1：redis-cli --bigkeys（在线，影响性能）**

```bash
redis-cli -h host -p 6379 --bigkeys
# 输出每种类型的最大 key：
# Biggest string found so far '"session:user:123"' with 1.2 MB

# 使用 -i 参数限制扫描速度（减少对主库影响）
redis-cli -h host -p 6379 --bigkeys -i 0.01  # 每 100 个 key 之间 sleep 10ms
```

**方法 2：RDB 文件离线分析（推荐生产使用）**

```bash
# 使用 rdb-tools 或 redis-rdb-tools 分析 RDB 快照
# 不影响线上 Redis
pip install rdbtools

# 生成内存报告
rdb --command memory /path/to/dump.rdb -f memory.csv

# 查看大于 1KB 的 key
awk -F',' '$4 > 1000' memory.csv | sort -t',' -k4 -rn | head -20
```

**方法 3：SCAN + MEMORY USAGE（精确但慢）**

```bash
# SCAN 遍历所有 key，用 MEMORY USAGE 获取每个 key 的内存
redis-cli SCAN 0 COUNT 100 | while read cursor keys; do
    for key in $keys; do
        size=$(redis-cli MEMORY USAGE "$key")
        echo "$size $key"
    done
done | sort -rn | head -20

# MEMORY USAGE key [SAMPLES n]：返回 key 占用的内存（bytes）
```

**方法 4：监控系统报警（Prometheus + Grafana）**

```
redis_key_size > 10MB 触发告警
或监控 Redis 响应时间毛刺（P99 > 10ms）配合 slowlog 定位
```

### 3）拆分大 Key

**String 类型大 Value（如 JSON 对象）**：

```python
# 原始：一个 key 存用户所有信息（100+ 字段，几十KB）
redis.set("user:1001", json.dumps(huge_user_dict))  # ❌ 大 Key

# 拆法 1：Hash 替代 String（精细化字段访问）
redis.hset("user:1001", mapping={
    "name": "Alice",
    "age": "30",
    "profile": json.dumps(profile),  # 子对象仍用 JSON
})
# 按需 HGET，不用一次加载所有字段

# 拆法 2：只缓存热字段，冷字段不缓存（DB 按需查）
hot_fields = {"name", "avatar", "vip_level"}
redis.set("user:1001", json.dumps({k: v for k, v in user.items() if k in hot_fields}))
```

**Hash/Set/ZSet 元素太多（超 5000）**：

```python
# 原始：一个 Hash 存 10w 个商品的库存
redis.hset("product_stock", mapping={f"product:{i}": random.randint(0, 100) for i in range(100000)})
# ❌ 元素 10w，hash 很大

# 拆法：水平拆分（按 Key 哈希分多个 Redis Key）
SHARD_COUNT = 100  # 分 100 个 hash

def get_shard(product_id: str) -> str:
    shard = hash(product_id) % SHARD_COUNT
    return f"product_stock:{shard}"

# 写
redis.hset(get_shard("product:123"), "product:123", stock)

# 读
redis.hget(get_shard("product:123"), "product:123")

# 每个 hash 只有 1000 个元素，大小合理
```

**List 消息队列太长（大量堆积）**：

```python
# 原始：List 用作消息队列，堆积了 100w 条消息
LPUSH task_queue msg1 msg2 ...  # ❌ List 太长

# 解法：换用 MQ（Kafka/RocketMQ），Redis List 只存最近 N 条
# 或者设置 LTRIM 保留最近数据：
redis.ltrim("hot_news", 0, 999)  # 只保留最新 1000 条

# 如果一定要用 Redis，水平分片：
shard = time.time_ns() % 10
redis.lpush(f"task_queue:{shard}", message)  # 分 10 个队列
```

### 4）删除大 Key（避免阻塞）

```bash
# ❌ 直接 DEL 大 Key（同步，阻塞）
DEL huge_hash_key  # 100w 元素 → 阻塞 Redis 数秒

# ✅ UNLINK（异步删除，Redis 4.0+）
UNLINK huge_hash_key
# Redis 立即返回，后台线程逐步释放内存
# 等价于 DEL 但不阻塞

# ✅ 渐进式删除（对超大 Hash/Set/ZSet，更安全）
# 每次删 100 个元素，循环直到清空
while redis.hlen("huge_hash") > 0:
    # 取出 100 个 field
    fields = [item[0] for item in redis.hscan_iter("huge_hash", count=100)][:100]
    if fields:
        redis.hdel("huge_hash", *fields)
    time.sleep(0.01)  # 10ms 间隔，避免阻塞
```

## 延伸追问

- **Q：Redis 的 SCAN 命令为什么比 KEYS 好？**
  → `KEYS pattern` 一次性遍历所有 key，在大量 key 时会阻塞 Redis（单线程）；`SCAN cursor COUNT hint` 是增量遍历（游标），每次返回少量结果，不阻塞。代价：可能重复返回某些 key，需要应用层去重；遍历过程中 key 可能被修改（不保证完整性）。
- **Q：Redis Cluster 模式下，大 Key 分布在哪个节点？**
  → Redis Cluster 用 CRC16(key) % 16384 算 slot，slot 分布在各节点。大 Key 固定在一个节点，无法自动分散——这就是 Cluster 内存倾斜的根源。只能应用层拆分 Key（把一个大 Key 拆成多个，分散到不同 slot）。
- **Q：什么是热 Key，和大 Key 的区别？**
  → **大 Key**：单个 key 的 value 体积大，问题在内存和 I/O；**热 Key**：单个 key 被极高频访问（如每秒 10w 次），问题在 Redis CPU 和单点流量（单个节点承担所有流量）。热 Key 的 value 可能很小，但访问频次极高。热 Key 的解法：本地缓存（每台机器缓存副本），或 Redis Cluster 读副本。

## 我的记法

- **大 Key 标准**：String > 10KB，集合 > 5000 元素 或 > 10MB
- **发现**：`--bigkeys`（在线）、RDB 分析（离线推荐）
- **拆分**：垂直（按字段拆 Hash）、水平（按 hash 分 N 个 key）
- **删除**：`UNLINK`（异步）或渐进式 HSCAN + 批量 HDEL
- 一句话：**「大 Key 阻塞 Redis 单线程，拆分靠分片，删除靠 UNLINK」**

## 状态
- [ ] 已背速记
- [ ] 能写 Hash 水平分片的路由代码
- [ ] 能解释 UNLINK vs DEL
