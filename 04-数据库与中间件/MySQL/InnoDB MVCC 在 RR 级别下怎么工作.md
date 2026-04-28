---
tags: [P0, 数据库, 生疏]
相关: [[04-数据库与中间件/_MOC]]
---

# InnoDB MVCC 在 RR 级别下怎么工作

## 一句话速记

**MVCC（多版本并发控制）= 快照读 + Undo Log 版本链**。在 RR（可重复读）级别，事务开始时创建一个**一致性视图（Read View）**，记录当前活跃事务 ID 列表；后续所有快照读都通过该视图判断哪个版本可见——事务内读到的数据始终一致，不受其他事务提交影响。核心：**每行记录都有隐藏列 `trx_id`（最后修改该行的事务）和 `roll_pointer`（指向 Undo Log 版本链）**。

## 通俗解释（5 分钟版）

**类比**：图书馆的书有多个版本（Undo Log 版本链）。你借书的那一刻拿到一张"书单"（Read View），标记哪些版本是"你借书时已经存在的"——之后不管别人怎么修改、添加新版本，你看到的都是你书单上的版本。

**关键数据结构**：

```
每行记录的隐藏列（InnoDB 内部）：
  DB_TRX_ID     → 最后修改该行的事务 ID（6 bytes）
  DB_ROLL_PTR   → 指向 Undo Log 的指针（7 bytes）
  DB_ROW_ID     → 隐式主键（没有主键时用）

Read View 的核心字段：
  m_ids[]       → 创建 Read View 时，所有活跃事务的 ID 列表
  min_trx_id    → m_ids 中最小的事务 ID
  max_trx_id    → 当前系统中下一个要分配的事务 ID（当前最大+1）
  creator_trx_id→ 创建这个 Read View 的事务 ID
```

## 关键细节

### 1）Read View 的创建时机

```
RC（Read Committed，读提交）：
  每次 SELECT 都创建新的 Read View
  → 能看到其他事务已提交的最新数据（不可重复读）

RR（Repeatable Read，可重复读）：
  事务内第一次 SELECT 时创建 Read View，之后复用
  → 事务内始终看到同一快照（可重复读）

SERIALIZABLE：
  SELECT 变成 SELECT ... LOCK IN SHARE MODE（加锁读，没有快照读）
```

### 2）版本可见性判断规则

```
对于某一行记录，其 trx_id 设为 T：

情况 1：T == creator_trx_id → 自己修改的，可见 ✓

情况 2：T < min_trx_id → 该版本在 Read View 创建前已提交，可见 ✓

情况 3：T >= max_trx_id → 该版本在 Read View 创建后才开始，不可见 ✗
  → 沿 roll_pointer 找 Undo Log 旧版本

情况 4：min_trx_id ≤ T < max_trx_id：
  - T 在 m_ids[] 中 → 创建 Read View 时该事务还活跃，不可见 ✗
    → 沿 roll_pointer 找旧版本
  - T 不在 m_ids[] 中 → 创建 Read View 前已提交，可见 ✓
```

### 3）版本链示意图

```
当前行最新版本（物理存储）：
  trx_id=200, name="Bob" → roll_ptr ──→ Undo Log v2
                                          trx_id=100, name="Alice" → roll_ptr ──→ Undo Log v1
                                                                                    trx_id=50, name="Tom"

场景：事务 A（trx_id=150）开始前，事务 100 已提交；
      事务 B（trx_id=200）在事务 A 进行中修改了行并提交。

事务 A 的 Read View：
  min_trx_id=150（A 自己），max_trx_id=201
  m_ids=[150]（只有自己活跃）

A 读这行时：
  看最新版本 trx_id=200 → 200 >= max_trx_id? No
  200 在 m_ids? No → 不在列表，且 200 > min_trx_id
  实际判断：200 >= max_trx_id(201)? No
            200 在 m_ids? No → 200 已提交且在 A 之前提交?
  
  更准确：200 < 201(max_trx_id)，且 200 不在 m_ids=[150]
  → 可见！事务 A 可以看到 trx_id=200 的版本（name="Bob"）
  
  如果事务 B 在 Read View 创建之后才开始（trx_id=250）：
  250 >= 201(max_trx_id) → 不可见，找旧版本
```

### 4）快照读 vs 当前读

```
快照读（普通 SELECT）：
  使用 MVCC + Read View，不加锁，读历史版本
  SELECT * FROM users WHERE id = 1;

当前读（Locking Read）：
  读取最新版本（跳过 MVCC），加锁
  SELECT * FROM users WHERE id = 1 FOR UPDATE;     -- X 锁
  SELECT * FROM users WHERE id = 1 LOCK IN SHARE MODE;  -- S 锁
  UPDATE / DELETE / INSERT 本身都是当前读
```

**这是 RR 下幻读问题的根源**：

```
事务 A 快照读（不加锁）→ 看到 Read View 的快照，不会幻读
事务 A 当前读（FOR UPDATE）→ 读最新版本 → 可能看到别的事务插入的行
→ 这就是 RR 下仍然存在幻读的情况（需要 Gap Lock 防止）
```

### 5）RC vs RR 的行为差异（面试常考）

```sql
-- 初始：id=1, name="Alice"

-- 事务 A（RR）开始
BEGIN;
SELECT name FROM t WHERE id=1;  -- 第一次 SELECT，创建 Read View → "Alice"

-- 事务 B 修改并提交
BEGIN;
UPDATE t SET name="Bob" WHERE id=1;
COMMIT;

-- 事务 A 再次 SELECT
SELECT name FROM t WHERE id=1;
-- RR：仍然看到 "Alice"（复用第一次的 Read View）
-- RC：看到 "Bob"（每次 SELECT 都创建新 Read View）
```

## 延伸追问

- **Q：MVCC 怎么解决幻读（及其局限性）？**
  → MVCC 通过快照读解决了"普通 SELECT 的幻读"——事务内始终看到第一次 SELECT 时的快照。但对**当前读**（FOR UPDATE / UPDATE）无法解决，需要 Gap Lock（间隙锁）配合。所以 RR 级别并非完全消除幻读，而是普通 SELECT 不幻读，当前读靠 Gap Lock。
- **Q：Undo Log 版本链什么时候被清除？**
  → 当所有活跃事务的 Read View 都不再需要某个历史版本时，purge 线程会清除对应的 Undo Log。如果有长事务长期不提交，大量 Undo Log 无法清除，导致 Undo Log 膨胀（MySQL Undo Tablespace 增大）——这是长事务的主要危害之一。
- **Q：`trx_id` 是递增的吗？事务开始就分配吗？**
  → 不是事务开始就分配——只有第一次修改数据时才分配 `trx_id`（只读事务可以不分配，节省全局计数器竞争）。`trx_id` 全局单调递增，但不连续（有跳跃），可以用来判断事务的先后顺序。

## 我的记法

- **MVCC 三件套**：隐藏列（trx_id + roll_ptr）+ Undo Log 版本链 + Read View
- **RR vs RC 区别**：Read View 创建时机——RR 事务内第一次 SELECT 创建并复用，RC 每次 SELECT 都创建
- **版本可见规则**：`trx_id < min` 可见；`trx_id >= max` 不可见；在 `m_ids[]` 中不可见
- **快照读 vs 当前读**：普通 SELECT = 快照读，FOR UPDATE = 当前读（绕过 MVCC）
- 一句话：**「MVCC 是用版本链 + Read View 实现的时间机器，让每个事务看到一致快照」**

## 状态
- [ ] 已背速记
- [ ] 能讲 Read View 的四种判断情况
- [ ] 能解释 RC 和 RR 的行为差异
