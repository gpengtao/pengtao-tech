---
tags: [MOC, Java方向]
priority: P1
---

# 02 · Java 后端核心 · 内容地图

> **定位**：语言、并发、框架与中间件在工程中的典型问题与排障。
> 训练方式：原理 + **可落地的案例**（脱敏项目经验或公开场景）比纯背诵更有用。

---

## 子模块导航

### JVM 与 GC
_Java 高频考点 · 配 1～2 个「大对象 / 长计算 / 压测」相关的案例更扎实_

- 🆕 [[02-Java后端核心/JVM与GC/G1 和 ZGC 怎么选]] #P0 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/ZGC 的染色指针解决了什么]] #P1 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/Full GC 的触发条件]] #P0 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/逃逸分析和栈上分配]] #P1 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/CPU 100% 完整排查命令序列]] #P0 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/JIT 编译线程烧 CPU 怎么处理]] #P1 #生疏
- 🆕 [[02-Java后端核心/JVM与GC/OOM 排查路径]] #P0 #生疏

### 并发编程
_"场景 → 方案 → 坑点"三段要练熟_

- 🆕 [[02-Java后端核心/并发编程/synchronized 锁升级全过程]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/AQS 的核心思想与 ReentrantLock]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/ConcurrentHashMap 1.7 vs 1.8]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/ThreadLocal 内存泄漏与 TTL]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/CompletableFuture 默认线程池的坑]] #P1 #生疏
- 🆕 [[02-Java后端核心/并发编程/线程池隔离策略与拒绝策略]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/分布式锁 Redis vs ZK vs 数据库]] #P0 #生疏
- 🆕 [[02-Java后端核心/并发编程/Redlock 算法的争议]] #P1 #生疏

### Spring 与 Dubbo
_框架扩展点深度 · 你在大模型应用平台里用过 SPI_

- 🆕 [[02-Java后端核心/Spring与Dubbo/Spring 三级缓存解决循环依赖]] #P0 #生疏
- 🆕 [[02-Java后端核心/Spring与Dubbo/构造器注入和 @Async 代理的循环依赖难题]] #P1 #生疏
- 🆕 [[02-Java后端核心/Spring与Dubbo/Spring 事务失效的典型场景]] #P0 #生疏
- 🆕 [[02-Java后端核心/Spring与Dubbo/Dubbo 完整调用链]] #P0 #生疏
- 🆕 [[02-Java后端核心/Spring与Dubbo/Dubbo Provider 线程池打满与超时]] #P0 #生疏
- 🆕 [[02-Java后端核心/Spring与Dubbo/SPI 在项目里的实际用法]] #P1 #生疏

---

## 本模块 P0/P1 生疏题

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "02-Java后端核心"
WHERE (contains(tags, "P0") OR contains(tags, "P1")) AND contains(tags, "生疏")
SORT file.mtime ASC
```
