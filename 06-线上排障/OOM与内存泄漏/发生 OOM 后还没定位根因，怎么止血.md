---
tags: [P1, Java方向, 生疏]
相关: [[02-Java后端核心/JVM与GC/OOM 排查路径]]
---

# 发生 OOM 后还没定位根因，怎么止血

## 一句话速记

OOM 后的止血优先级：**保现场 → 恢复服务 → 再排查**。保现场：OOM 时 dump 自动生成（`-XX:+HeapDumpOnOutOfMemoryError`），确保不要丢失。恢复服务：重启（k8s 自动 / 手动），如果重启后立刻又 OOM → 临时加 `-Xmx` 或限流。排查：用 dump 文件离线分析。**绝对不要**在生产机器上现场分析大 dump（会再次 OOM）。

## 通俗解释（5 分钟版）

```
OOM 发生时的决策树：

OOM 发生了
│
├─ 有没有 HeapDumpOnOutOfMemoryError？
│   ├─ 有 → dump 文件已在磁盘，直接重启
│   └─ 没有 → 紧急手动 jmap -dump:live（有 STW 但 OOM 时服务已经不行了）
│
├─ 重启能恢复吗？
│   ├─ 能，且不立刻 OOM → 先恢复服务，离线分析 dump
│   ├─ 能，但 10 分钟后又 OOM → 临时加 -Xmx 或限流争取时间
│   └─ 不能，重启就 OOM → 大概率 -Xmx 设太小或启动时就有大对象
│
└─ dump 文件在哪？多大？
    ├─ 小于磁盘剩余空间 → 保留，离线分析
    └─ 大于磁盘剩余空间 → 紧急扩容磁盘或 scp 到其他机器
```

## 关键细节

### 第一优先级：保现场（别让证据消失）

```bash
# 1. OOM 自动 dump（提前配好，事后再配没用）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/%p-%t.hprof    # %p=pid, %t=时间戳
-XX:+ExitOnOutOfMemoryError                # k8s 环境建议开，让 pod 重启

# 2. 如果没配自动 dump → 手动保现场
#    但 OOM 时 jmap 可能也失败（JVM 连 jmap 连接的内存都不够了）
#    优先收集轻量信息：
jstack <pid> > /tmp/stack_$(date +%s).txt        # 线程快照，轻量
jmap -histo <pid> > /tmp/histo_$(date +%s).txt   # 类统计，轻量
jcmd <pid> VM.native_memory summary > /tmp/nmt.txt  # 堆外内存

# 3. 最后再尝试 dump
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
# 如果 jmap 失败 → 用 gcore + jmap 转换：
gcore -o /tmp/core <pid>          # Linux 生成 core dump
jmap -dump:format=b,file=/tmp/heap.hprof /usr/bin/java /tmp/core
```

### 第二优先级：恢复服务（别让用户一直等着）

```
决策矩阵：

重启后状态              原因判断                      对策
──────────────────────────────────────────────────────────────
重启后恢复正常          泄漏型 OOM                    等下次 OOM，分析 dump
                       （对象慢慢涨到 OOM）

重启后立刻 OOM          -Xmx 太小                    临时加 -Xmx 50-100%
（< 2 分钟）            启动加载了巨大对象             查启动流程

重启后 5-30 分钟 OOM    高并发下对象创建太快           限流 + 加 -Xmx
                                                     排查热点路径的对象创建

重启后恢复，但           泄漏继续                      分析本次 dump，修复后
过几天又 OOM                                          重新发布
```

**临时止血操作**：

```bash
# k8s 环境：加内存
kubectl edit deploy <service>
# resources.limits.memory: 4Gi → 8Gi
# JAVA_OPTS: -Xmx3g → -Xmx6g

# 非 k8s：重启前改启动脚本
JAVA_OPTS="$JAVA_OPTS -Xmx6g -Xms6g"

# 限流（如果确定是高并发导致）
# Nginx/Sentinel 层临时限流，给服务争取空间
```

### 第三优先级：离线分析（不要再搞挂生产）

```
分析 dump 的注意事项：

1. 不要在线上机器分析！
   MAT 打开 4G dump 自身需要 6-8G 堆 → 分析机器至少要 2× dump 大小的内存
   MAT 启动参数：-Xmx8g（如果 dump 是 4G）

2. 如果 dump 太大开不了：
   - 用 jhat 做轻量浏览（功能弱，但 1G dump 可以开）
   - 用 MAT 的 headless 模式做自动分析：
     ./ParseHeapDump.sh heap.hprof org.eclipse.mat.api:suspects
     ./ParseHeapDump.sh heap.hprof org.eclipse.mat.api:overview
     → 生成 HTML 报告（zip）

3. 如果 dump 太多需要对比：
   - MAT: File → Open Heap Dump → Compare Basket
   - 对比「刚启动」vs「OOM 前」→ 看哪些对象在涨
```

### 常见止血错误

```
错误做法                                    正确做法
──────────────────────────────────────────────────────────────
OOM 后不保留 dump 直接重启                   先 jmap -dump 或确认自动 dump 已生成
在线上机器开 MAT 分析 dump                   下载到本地或专用分析机
OOM 后手动 System.gc() 试图 "释放内存"       GC 解决不了泄漏，只会浪费时间
OOM 后反复重启，不分析根因                   OOM 不会自己好，不修代码还会再来
没有监控，OOM 靠用户投诉才发现               OOM 前有预警信号（Old > 85%）→ 提前知道
```

## 延伸追问

- **Q：如果 OOM 时连 jmap 都连不上（JVM hang 了）怎么办？**
  → 用 OS 级工具：`gcore <pid>` 生成 core dump，然后 `jmap -dump` 从 core 转 hprof。这是最后的保底手段，文件会很大（等于进程内存占用），但至少有证据。
- **Q：OOM 后重启太快（k8s 立刻重启 pod），自动 dump 还没写完怎么办？**
  → 设 `-XX:+ExitOnOutOfMemoryError` 让 JVM 在 dump 写完后再退出。另外 dump 写到 SSD 会更快，或用 `-XX:HeapDumpPath` 指向 tmpfs。
- **Q：线上服务 OOM 了，但用户无感知（因为有多副本），我还要马上处理吗？**
  → 要。OOM 通常不是单机偶发——如果是代码泄漏，所有副本都会在差不多的时间 OOM。一个副本 OOM 就是整体灾难的倒计时。

## 我的记法

- **止血三步骤**：保现场（dump 别丢）→ 恢复服务（重启/加内存）→ 离线分析（别搞挂生产）
- **重启后判断**：立刻 OOM → 堆太小；过一阵 OOM → 泄漏；能撑几天 → 慢泄漏
- **不要做的事**：线上开 MAT、不保留 dump 就重启、反复重启不求根因
- 一句话：**「OOM 了别慌，先确认 dump 在不在，再重启恢复服务，最后离线慢慢分析」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
