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
_排障重难点 · 配 1~2 个「最难定位」的真实案例_

_待补清单_
- 堆内 OOM 的典型形态（Heap Space / GC Overhead Limit / Metaspace）
- 堆外内存泄漏排查（NMT / pmap / DirectBuffer）
- MAT 的 Dominator Tree / Leak Suspect 视图
- jmap / jstat / jstack / arthas 命令手册
- OOM 之前的预警指标
- 发生 OOM 后还没定位根因，怎么止血

### 慢查询与性能
_「系统变慢但接口 DB 响应正常」是典型排障题_

_待补清单_
- 网络 / 应用 / DB / 下游四层慢的分层排查
- 全链路追踪（SkyWalking / Zipkin / CAT）
- HikariCP 连接池耗尽的现象与 leakDetectionThreshold
- GC 导致整体慢的关键指标（GC 日志看什么）
- CPU 100% 排查命令序列
- 大量 TIME_WAIT / CLOSE_WAIT 的排查

### 全链路排查
_「表象 → 根因 → 预防」的归因套路可放此模块（若个人有方法论笔记可双链）_

_待补清单_
- 三层归因方法论（表象 / 第二根因 / 第一根因 / 超前 2 年）
- 如何从报警开始反推到代码行
- 日志规范与 TraceID 串联
- 一次完整的生产故障复盘（STAR：现象/工具/根因/修复/预防）

---

## 本模块动态视图

```dataview
TABLE file.mtime AS "最近更新", tags AS "标签"
FROM "06-线上排障"
WHERE contains(tags, "生疏") OR contains(tags, "未动")
SORT file.mtime ASC
```
