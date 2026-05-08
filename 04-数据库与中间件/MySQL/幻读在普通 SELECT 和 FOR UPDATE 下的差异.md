---
tags: [P0, 数据库, 生疏]
相关: "[[04-数据库与中间件/index]]"
---

# 幻读在普通 SELECT 和 `SELECT ... FOR UPDATE` 下的差异

## 一句话速记

**幻读** = 同一事务内，两次查询相同条件时，第二次返回了第一次没有的行。在 RR 级别下：**普通 SELECT（快照读）= 不会幻读**（MVCC 保证读的是第一次 SELECT 时的快照）；**`SELECT ... FOR UPDATE`（当前读）= 可能幻读**（读最新版本，其他事务插入并提交的行会出现）。防止当前读幻读的机制是 **Gap Lock（间隙锁）**。

## 通俗解释

**普通 SELECT 的快照读——不幻读**：

```sql
-- RR 级别
-- 初始：orders 表只有 id=1,2,3

-- 事务 A
BEGIN;
SELECT * FROM orders WHERE amount > 100;  -- 返回 3 行，创建 Read View

-- 事务 B 插入新行并提交
INSERT INTO orders(id, amount) VALUES(4, 200);
COMMIT;

-- 事务 A 再次查询（同条件）
SELECT * FROM orders WHERE amount > 100;
-- 结果：仍然 3 行！（Read View 过滤了 trx_id > max_trx_id 的新行）
-- 没有幻读 ✓
```

**FOR UPDATE 的当前读——会幻读**：

```sql
-- 事务 A（RR 级别）
BEGIN;
SELECT * FROM orders WHERE amount > 100 FOR UPDATE;  -- 返回 3 行，加锁

-- 注意：此时 FOR UPDATE 锁的是已存在的行（假设范围内没有间隙锁）

-- 事务 B 插入新行并提交（如果没有间隙锁就能成功）
INSERT INTO orders(id, amount) VALUES(4, 200);
COMMIT;

-- 事务 A 再次 FOR UPDATE
SELECT * FROM orders WHERE amount > 100 FOR UPDATE;
-- 结果：4 行！多了 id=4（当前读，看最新数据）
-- 这是幻读 ✗
```

## 关键细节

### 1）Gap Lock 如何阻止幻读

```
InnoDB 在 RR 级别，当 FOR UPDATE 查询时自动加 Gap Lock（间隙锁）：

示例：orders 表有 amount = 100, 150, 200

SELECT * FROM orders WHERE amount BETWEEN 100 AND 300 FOR UPDATE;

加锁范围：
  - Record Lock：锁定 amount=100, 150, 200 三行
  - Gap Lock：锁定 (100, 150), (150, 200), (200, +∞) 等间隙
  
  → 事务 B 想插入 amount=180（在 150~200 间隙里）→ 被阻塞！
  → 等事务 A 提交/回滚才能插入
  → 消除了当前读的幻读
```

**Next-Key Lock = Record Lock + Gap Lock 的组合**：

```
InnoDB 默认加 Next-Key Lock（锁住记录本身 + 左开右闭区间）
例：有记录 id=3,5,7
FOR UPDATE WHERE id > 3 → Next-Key Lock: (3, 5], (5, 7], (7, +∞)
  - 锁住 id=5, 7（Record Lock）
  - 锁住 (3,5), (5,7), (7,+∞)（Gap Lock）
  - 阻止任何在这些区间插入的操作
```

### 2）Gap Lock 的代价——死锁风险

```sql
-- 死锁场景：两个事务各自持有间隙锁，等对方

-- 事务 A：INSERT INTO t(id) VALUES(4);  → 需要 (3,5) 的 Gap Lock
-- 事务 B：INSERT INTO t(id) VALUES(4);  → 也需要 (3,5) 的 Gap Lock

-- A 等 B 释放 Gap Lock，B 等 A 释放 Gap Lock → 死锁
-- InnoDB 检测到后，选一个 victim 回滚，另一个成功
```

### 3）RC 级别关闭了 Gap Lock

```
在 RC（Read Committed）级别：
  - 没有 Gap Lock（只有 Record Lock）
  - SELECT ... FOR UPDATE 可能幻读（其他事务可以插入间隙）
  - 但没有了间隙锁，死锁概率大大降低
  - 很多互联网公司（包括 Qunar）将隔离级别设为 RC，用业务逻辑处理幻读

RC 的额外特性：
  - 语句级别（而非事务级别）的快照（每次 SELECT 都看最新已提交）
  - 更新后即时发布，不等事务结束
  - Binlog 必须使用 ROW 格式（SBR 在 RC 下可能主从不一致）
```

### 4）怎么彻底防止幻读（RC 场景）

```
方案 1：业务层幂等（推荐）
  - 不依赖数据库防幻读
  - 唯一键兜底（INSERT 前不 SELECT，直接 INSERT，失败即重复）

方案 2：SELECT ... FOR UPDATE（RR 级别）
  - 加间隙锁防止插入
  - 适合：先查后写的写操作（如：扣库存）

方案 3：SERIALIZABLE
  - 所有 SELECT 变成 LOCK IN SHARE MODE
  - 彻底无幻读，但并发极低

方案 4：乐观锁（version 字段）
  - 不加悲观锁，更新时 WHERE version=old_version
  - 适合写冲突少的场景
```

### 5）面试场景题：扣减库存防超卖

```sql
-- ❌ 错误写法（快照读，不防并发）
BEGIN;
SELECT stock FROM products WHERE id=1;  -- 快照读，stock=10
-- 判断 stock > 0
UPDATE products SET stock=stock-1 WHERE id=1;
COMMIT;
-- 问题：多个事务同时 SELECT 看到 stock=10，都 UPDATE，stock 变成 10-N

-- ✅ 正确写法 1：乐观锁
UPDATE products SET stock=stock-1 WHERE id=1 AND stock > 0;
-- 检查 affected_rows，0 表示超卖，业务层重试或报错

-- ✅ 正确写法 2：SELECT FOR UPDATE（悲观锁）
BEGIN;
SELECT stock FROM products WHERE id=1 FOR UPDATE;  -- 当前读+排它锁
-- 此时其他事务的 FOR UPDATE 会阻塞
IF stock > 0:
  UPDATE products SET stock=stock-1 WHERE id=1;
COMMIT;
```

## 延伸追问

- **Q：Gap Lock 在唯一索引的等值查询下会退化吗？**
  → 会。`WHERE id=5 FOR UPDATE`，id 是唯一索引，找到了记录 → 退化为 Record Lock（因为唯一索引保证不会有重复，间隙不需要锁）。如果没找到记录（如 id=5 不存在），则锁间隙（防止其他事务插入 id=5）。
- **Q：RR 级别下，普通 SELECT 永远不会幻读，那有什么问题吗？**
  → 有。事务内混用快照读和当前读时，快照可能与实际数据不一致。例如：A 快照读看不到 B 插入的行，但 A 的 `UPDATE ... WHERE ...` 是当前读，可能意外更新了 B 插入的行，之后再快照读却能看到这行（因为 A 自己修改了它，trx_id 变成 A 的了）。这是 RR 下的一个"陷阱"。
- **Q：什么是"一致性非锁定读"？**
  → 就是快照读的官方名称。InnoDB 默认用一致性非锁定读，不加锁，读 Undo Log 历史版本，提升并发度。与之对应的是"一致性锁定读"（FOR UPDATE / LOCK IN SHARE MODE）。

## 我的记法

- **快照读（普通 SELECT）+ RR = 不幻读**（MVCC 的快照）
- **当前读（FOR UPDATE）= 可能幻读**（需要 Gap Lock 防止）
- **Gap Lock = 锁间隙，防止其他事务在这个范围内插入**
- RC 无 Gap Lock，死锁少，互联网常用，但快照读会读到最新提交
- 防超卖：`UPDATE ... WHERE stock > 0` 乐观锁最简洁
- 一句话：**「普通 SELECT 靠 MVCC 防幻读，FOR UPDATE 靠 Gap Lock 防幻读」**

## 状态
- [ ] 已背速记
- [ ] 能解释快照读 vs 当前读
- [ ] 能写防超卖的正确 SQL
