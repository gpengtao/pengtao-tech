---
tags: [MOC, 通用]
priority: P1
---

# 06 · 线上排障 · 内容地图

> **定位**：每道排障题都要走完"现象 → 工具 → 假设 → 验证 → 根因 → 修复 → 长期预防"七步。
> 用 [[_模板/故障复盘笔记]] 模板。

---

## 子模块导航

### OOM 与内存泄漏

- [[06-线上排障/OOM与内存泄漏/堆内 OOM 的典型形态（Heap Space GC Overhead Limit Metaspace）|堆内 OOM 的典型形态]]
- [[06-线上排障/OOM与内存泄漏/堆外内存泄漏排查（NMT pmap DirectBuffer）|堆外内存泄漏排查]]
- [[06-线上排障/OOM与内存泄漏/MAT 的 Dominator Tree Leak Suspect 视图|MAT 的 Dominator Tree / Leak Suspect 视图]]
- [[06-线上排障/OOM与内存泄漏/jmap jstat jstack arthas 命令手册|jmap / jstat / jstack / arthas 命令手册]]
- [[06-线上排障/OOM与内存泄漏/OOM 之前的预警指标|OOM 之前的预警指标]]
- [[06-线上排障/OOM与内存泄漏/发生 OOM 后还没定位根因，怎么止血|发生 OOM 后还没定位根因，怎么止血]]

### 慢查询与性能

- [[06-线上排障/慢查询与性能/网络 应用 DB 下游四层慢的分层排查|网络 / 应用 / DB / 下游四层慢的分层排查]]
- [[06-线上排障/慢查询与性能/全链路追踪（SkyWalking Zipkin CAT）|全链路追踪（SkyWalking / Zipkin / CAT）]]
- [[06-线上排障/慢查询与性能/HikariCP 连接池耗尽的现象与 leakDetectionThreshold|HikariCP 连接池耗尽的现象与 leakDetectionThreshold]]
- [[06-线上排障/慢查询与性能/GC 导致整体慢的关键指标（GC 日志看什么）|GC 导致整体慢的关键指标]]
- [[06-线上排障/慢查询与性能/CPU 100% 排查命令序列|CPU 100% 排查命令序列]]
- [[06-线上排障/慢查询与性能/大量 TIME_WAIT CLOSE_WAIT 的排查|大量 TIME_WAIT / CLOSE_WAIT 的排查]]

### 全链路排查

- [[06-线上排障/全链路排查/三层归因方法论（表象 第二根因 第一根因 超前 2 年）|三层归因方法论]]
- [[06-线上排障/全链路排查/如何从报警开始反推到代码行|如何从报警开始反推到代码行]]
- [[06-线上排障/全链路排查/日志规范与 TraceID 串联|日志规范与 TraceID 串联]]
- [[06-线上排障/全链路排查/一次完整的生产故障复盘（STAR 现象 工具 根因 修复 预防）|一次完整的生产故障复盘]]

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "06-线上排障"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
