# Java 基础概览

## Java 的优点

- 摆脱硬件平台约束，实现了"一次编写，到处运行"的思想
- 提供相对安全的内存管理和访问机制，避免绝大部分内存泄漏、指针越界问题
- 实现了热点代码检测、运行时编译及优化，使得应用能随运行时间增长而获得更高的性能
- 有一套完整的应用程序接口，以及无数来自商业机构、开源社区的第三方类库

## JDK 和 JRE 区别

| | 包含内容 | 用途 |
|---|---|---|
| **JDK**（Java Development Kit）| Java 语言 + JVM + Java 类库 | 支持 Java 程序**开发**的最小环境 |
| **JRE**（Java Runtime Environment）| Java SE API 子集 + JVM | 支持 Java 程序**运行**的标准环境 |

## Java 发展史

| 版本 | 发布时间 | 关键特性 |
|---|---|---|
| JDK 5 | 2004-09-30 | 自动装箱、泛型、动态注解、枚举、可变长参数、foreach、JUC 并发包、新 JMM |
| JDK 7 | 2009-02-19（里程碑）| 工程代号 Dolphin，多次延期 |
| JDK 8 | 2014-03-18 | Lambda、Stream、Jigsaw 再次跳票推迟至 JDK 9 |
| JDK 9 | 2017-09-21 | Jigsaw 模块化（经历 IBM/RedHat 等厂商多轮博弈）、JS Shell、JHSDB、HTTP/2 客户端 API，共 91 个 JEP |
| JDK 10 | 2018-03-20 | 内部重构：统一源仓库、统一 GC 接口、引入 Graal JIT 编译器 |
| JDK 11 | 2018-09-25 | LTS 版本，17 个 JEP，ZGC 首次亮相 |
| JDK 12 | 2019-03-20 | Switch 表达式、JMH，RedHat 主导的 Shenandoah GC（被 OracleJDK 剔除）|

### Jigsaw 背后的"宫斗"

Jigsaw（Java 模块化）是 Java 史上最大的坑之一：

- 本应在 JDK 8 发布，实际推迟到 JDK 9
- IBM、RedHat 等 13 家厂商在 JCP 执委会上联手否决 Oracle 的 Jigsaw 提案，推动 OSGi 成为事实标准
- Oracle 公开信威胁"独立发展带 Jigsaw 的 Java 版本"，Java 面临 Python 2/3 式分裂危机
- 经过 6 轮投票，Java 没有分裂，JDK 9 最终携 Jigsaw 发布

### Shenandoah vs ZGC

- JDK 11：Oracle 发布 ZGC
- JDK 12：RedHat 主导的 Shenandoah GC 进入 OpenJDK，但 OracleJDK 12 通过条件编译将其强行剔除
- Shenandoah 成为历史上唯一进入 OpenJDK 发布清单、却在 OracleJDK 中无法使用的功能

---

> 原博客发布日期：2023-06-27
