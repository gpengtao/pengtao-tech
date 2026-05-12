---
tags: [P1, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---
# JIT 编译线程烧 CPU 怎么处理

## 一句话速记

**JIT 编译线程（C1/C2 CompilerThread）高 CPU 分两种情况**：① **启动/部署后的正常热身**——JVM 在 JIT 编译热点方法，持续几分钟后自然下降，**不用处理**；② **持续异常高（不下降）**——通常是"**Deoptimization 反复触发**"（方法被编译后因类型假设失效而回退，再触发重新编译），或者代码量太大导致编译积压。**核心应对**：区分正常热身 vs 异常，异常时查 `-XX:+PrintCompilation` 日志找循环编译的方法。

## 通俗解释（5 分钟版）

**JIT 是什么**：
- Java 启动时先解释执行（慢），热点方法才被 JIT 编译成机器码（快）
- C1（-client）：快速编译，优化保守
- C2（-server）：慢速编译，激进优化（内联、逃逸分析、循环展开）
- **服务端默认两者都用（分层编译 Tiered Compilation）**

**JIT 高 CPU 的两个阶段**：

```
服务刚启动/发布：
  JVM 解释执行所有方法
  热点方法触发 C1 编译 → C2 编译
  CPU 高 10-60 分钟 → 自然下降
  ← 这是正常现象，无需处理
  
服务运行一段时间后 CPU 仍高：
  某些方法被反复编译（Deopt → Recompile 循环）
  ← 这才是问题
```

**Deoptimization 是什么**：
- C2 做激进优化时会做"假设"（如：某字段类型总是 X）
- 后来假设失效（传入了新的子类）→ **Deopt（去优化）**：回退到解释执行
- 下次再热 → 重新触发 JIT 编译
- 这个循环如果频繁，C2 线程持续高 CPU

## 关键细节

### 1）区分正常热身 vs 异常

```bash
# 方法一：观察时间趋势
# 正常热身：部署后 CPU 高，10-60 分钟后降到正常水平
# 异常：运行数小时后 CPU 仍高，或 CPU 周期性升高

# 方法二：看 C2 线程是否持续 top
top -Hp <pid>  # 看 C2 CompilerThread 是否长期第一位

# 方法三：看编译日志
-XX:+PrintCompilation -XX:+TraceDeoptimization
# 如果日志里某个方法反复出现（编译 → 去优化 → 编译）→ 异常
```

### 2）触发 Deopt 的常见原因

```
原因                        说明
────────────────────────────────────────────────────────
多态调用（bimorphic +）     C2 内联了某个类型的调用，后来出现更多子类
假设字段不变（final优化）   字段被反射修改（如 unsafe.putField）
类被重新加载（热部署）      Arthas redefine、JVMTI、OSGi
rare cast（稀有类型转换）   实际传入的对象类型与预测不一致
数组越界预测失败             ArrayIndexOutOfBoundsException 路径被触发
```

### 3）常用 JVM 参数

```bash
# 打印编译事件（注意：输出量大，生产慎用）
-XX:+PrintCompilation

# 打印去优化事件
-XX:+TraceDeoptimization

# 限制 JIT 编译线程数（牺牲编译速度换 CPU 平稳）
-XX:CICompilerCount=2    # 默认值随 CPU 核数变化（通常 3-6）

# 禁用 C2（只用 C1，峰值 CPU 更平稳，但运行时性能略低）
-XX:TieredStopAtLevel=3  # 只编译到 C1 tier 3，不进 C2

# 提前预热（不推荐生产使用，有副作用）
-XX:CompileThreshold=100  # 方法执行 100 次就触发 JIT（默认 10000）
```

### 4）生产常见处理方案

**方案一：正常热身 → 用预热脚本/流量预热**

```bash
# 部署后先用低流量 / 内部 curl 预热
# 让 JIT 编译完成后再接流量
# 典型方案：金丝雀发布，先灰度 1 台，观察 CPU 平稳后再扩全量
```

**方案二：Deopt 循环 → 找到根因方法修复**

```bash
# 开启 PrintCompilation 找循环方法
grep "made not entrant\|deoptimized" compilation.log | sort | uniq -c | sort -rn | head -20

# 找到方法后分析：
# - 是否有多态调用可以改成 final/interface？
# - 是否用了反射/字节码操作修改字段？
# - 是否是 Arthas redefine 导致类频繁重加载？
```

**方案三：限制 JIT 线程 CPU**

```bash
# 降低 JIT 线程数，让编译变慢但不抢业务 CPU
-XX:CICompilerCount=2

# 或用 cgroup CPU 配额（容器场景）限制 JVM 整体 CPU
```

**方案四：GraalVM Native Image（彻底消灭 JIT 热身）**

- AOT 编译，启动即是最终性能
- 适合 Serverless / FaaS 场景

### 5）Arthas 查看编译状态

```bash
# 查看某个方法是否被 JIT 编译
classloader -l         # 看类加载情况
jad <ClassName>        # 反编译，可以看到字节码
sm <ClassName> <method> # 查方法签名

# 查看编译队列情况（间接）
perfcounter -d | grep ci  # 查看编译计数器
```

### 6）JIT 编译 CPU 高与 GC CPU 高的区分

```
现象                                  判断方法
─────────────────────────────────────────────────────────
C2 CompilerThread 高 CPU              JIT 编译问题
VM Thread / GC Thread 高 CPU         GC 问题
业务线程 RUNNABLE 高 CPU              死循环/高并发问题

关键命令：
top -Hp <pid> 后看线程名
jstat -gcutil <pid> 1000 看 FGC 是否增长
```

## 延伸追问

- **Q：JIT 编译有没有办法提前做（不要等热身期）？**
  → ① 利用 JVM 的 Startup Profiling：JDK 10+ 支持 AOT class init（`-Xshare`）② Spring AOT（Spring Boot 3）在打包时提前完成部分代码生成 ③ GraalVM Native Image 彻底 AOT ④ 预热脚本（启动后灌入模拟流量触发 JIT）。
- **Q：`-XX:TieredStopAtLevel=3` 有什么代价？**
  → 只编译到 C1 level 3（快速编译），不做 C2 的激进优化（逃逸分析、循环展开等）。峰值 CPU 更平稳，但稳态性能比完整 C2 低约 20-30%。适合**延迟敏感但可以牺牲吞吐**的服务。
- **Q：类热部署为什么会导致 JIT Deopt？**
  → Arthas `redefine` / JVMTI 修改类字节码后，JVM 会把基于旧类优化的编译代码全部设为 not entrant，下次调用触发重新编译。频繁热部署（CI/CD 频繁推送）或调试时频繁 `redefine` 可能导致 C2 持续高 CPU。

## 我的记法

- JIT 高 CPU 两种情况：**启动热身（正常等）** vs **Deopt 循环（需修复）**
- 判断方法：`top -Hp` 看 C2 线程是否**持续**第一，+ `PrintCompilation` 看是否某方法反复编译
- Deopt 原因：多态 / 反射改字段 / 热部署 / 稀有类型转换
- 应急手段：减少 `CICompilerCount` / 流量预热
- 一句话：**「JIT 高 CPU 先看持续时间——启动后自然消退是正常，持续飙高找循环 Deopt」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
