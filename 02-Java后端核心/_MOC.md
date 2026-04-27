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

_待补清单_
- G1 和 ZGC 怎么选 / 各自适合什么场景
- ZGC 的染色指针解决了什么
- Full GC 的触发条件
- 逃逸分析和栈上分配
- CPU 100% 完整排查命令序列（top -Hp / jstack / arthas）
- JIT 编译线程烧 CPU 怎么处理
- OOM 排查路径（堆内 / 堆外 / Metaspace / DirectBuffer）

### 并发编程
_"场景 → 方案 → 坑点"三段要练熟_

_待补清单_
- synchronized 锁升级全过程
- AQS 的核心思想 / ReentrantLock vs synchronized
- ConcurrentHashMap 1.7 vs 1.8
- ThreadLocal 内存泄漏与 InheritableThreadLocal / TransmittableThreadLocal
- CompletableFuture 默认线程池的坑
- 线程池隔离策略 / 拒绝策略怎么选
- 分布式锁：Redis vs ZK vs 数据库
- Redlock 算法的争议

### Spring 与 Dubbo
_框架扩展点深度 · 你在大模型应用平台里用过 SPI_

_待补清单_
- Spring 三级缓存解决循环依赖
- 构造器注入 / @Async 代理对象的循环依赖难题
- Spring 事务失效的典型场景
- Dubbo 完整调用链（代理 → 集群容错 → 负载均衡 → 路由 → 序列化 → 线程分发）
- Dubbo Provider 线程池打满的现象
- Dubbo 超时是从哪一刻开始算的
- SPI 在你项目里的实际用法

---

## 本模块 P0/P1 生疏题

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "02-Java后端核心"
WHERE (contains(tags, "P0") OR contains(tags, "P1")) AND contains(tags, "生疏")
SORT file.mtime ASC
```
