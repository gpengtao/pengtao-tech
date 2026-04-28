---
tags: [P1, Java方向, 生疏]
相关: [[02-Java后端核心/_MOC]]
---

# SPI 在你项目里的实际用法

## 一句话速记

**SPI（Service Provider Interface）= 接口定义与实现分离的插件机制**。Java 原生 SPI 通过 `ServiceLoader` + `META-INF/services/` 文件扫描实现类；**Dubbo SPI** 在此基础上增加了**按名称加载（非全量实例化）、AOP 包装（Wrapper）、自适应扩展（@Adaptive）、条件激活（@Activate）**，实现了生产级的插件系统。**应用场景**：框架扩展点（序列化/负载均衡/协议）、大模型应用平台里的自定义 LLM Provider、自定义 Filter 链。

## 通俗解释（5 分钟版）

**SPI 解决什么问题**：

```
框架开发者定义接口：
  interface LoadBalance { select(List<Invoker> invokers, ...); }

实现者（或用户）提供实现：
  class RandomLoadBalance implements LoadBalance { ... }
  class RoundRobinLoadBalance implements LoadBalance { ... }

框架在运行时动态发现实现：
  不需要硬编码 new RandomLoadBalance()
  通过约定的扫描路径发现所有实现 → 按配置选用
```

**Java 原生 SPI vs Dubbo SPI**：

```
Java SPI（ServiceLoader）：
  文件位置：META-INF/services/接口全限定名
  内容：实现类全限定名（每行一个）
  加载：ServiceLoader.load(接口.class) → 迭代所有实现
  缺点：全量实例化（不管用不用，所有实现都 new），无名称，无 AOP

Dubbo SPI（ExtensionLoader）：
  文件位置：META-INF/dubbo/接口全限定名
  内容：key=实现类全限定名（有名称）
  按名称加载：ExtensionLoader.getExtension("random")，只 new 这一个
  AOP 包装：Wrapper 类自动包裹，实现拦截器模式
  自适应：@Adaptive，运行时根据 URL 参数动态选实现
  条件激活：@Activate，Filter 链按条件组装
```

## 关键细节

### 1）Java 原生 SPI 示例

```java
// 接口定义
public interface MessageSender {
    void send(String message);
}

// 实现类
public class EmailSender implements MessageSender {
    public void send(String msg) { /* email 发送 */ }
}

// 文件：META-INF/services/com.example.MessageSender
// 内容：
com.example.EmailSender
com.example.SmsSender

// 使用
ServiceLoader<MessageSender> loader = ServiceLoader.load(MessageSender.class);
for (MessageSender sender : loader) {
    sender.send("hello");  // 会遍历所有实现类
}
```

**Java SPI 的缺点**：遍历所有实现，不能按需加载；没有依赖注入；线程不安全。

### 2）Dubbo SPI 核心特性

**a) 按名称加载（ExtensionLoader）**：

```java
// META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
random=org.apache.dubbo.rpc.cluster.loadbalance.RandomLoadBalance
roundrobin=org.apache.dubbo.rpc.cluster.loadbalance.RoundRobinLoadBalance
leastactive=org.apache.dubbo.rpc.cluster.loadbalance.LeastActiveLoadBalance

// 使用
ExtensionLoader<LoadBalance> loader = ExtensionLoader.getExtensionLoader(LoadBalance.class);
LoadBalance lb = loader.getExtension("random");  // 只加载 RandomLoadBalance
```

**b) @Adaptive 自适应扩展**：

```java
// URL 参数驱动，运行时动态选择实现
@SPI("random")  // 默认实现是 random
public interface LoadBalance {
    @Adaptive("loadbalance")  // 从 URL 的 loadbalance 参数取值
    <T> Invoker<T> select(List<Invoker<T>> invokers, URL url, Invocation invocation);
}

// Consumer 在 URL 里带参数：
// dubbo://xxx?loadbalance=roundrobin
// → 运行时动态选择 RoundRobinLoadBalance
```

**c) Wrapper AOP 机制**：

```java
// Wrapper 类构造器接受接口类型，自动检测为 Wrapper
class ProtocolListenerWrapper implements Protocol {
    private final Protocol protocol;  // 构造器注入，自动识别为 Wrapper
    
    ProtocolListenerWrapper(Protocol protocol) {
        this.protocol = protocol;
    }
    
    @Override
    public <T> Exporter<T> export(Invoker<T> invoker) {
        // 前置逻辑（监听者通知）
        Exporter<T> exporter = protocol.export(invoker);  // 委托
        // 后置逻辑
        return exporter;
    }
}

// Dubbo 自动检测到这个 Wrapper，把它包在真实实现外面
// 调用链：ProtocolListenerWrapper → ProtocolFilterWrapper → DubboProtocol
```

**d) @Activate 条件激活**：

```java
// Filter 按组/条件激活
@Activate(group = CommonConstants.CONSUMER)  // 只在 Consumer 侧激活
public class ConsumerContextFilter implements Filter { ... }

@Activate(group = CommonConstants.PROVIDER, order = -1000)  // Provider 侧，高优先级
public class ExceptionFilter implements Filter { ... }

// Dubbo 启动时根据 group 自动组装 Filter 链
// 不需要手动指定用哪些 Filter
```

### 3）项目中 SPI 的实际应用场景

**场景 1：大模型应用平台的 LLM Provider 扩展**

```java
// 接口定义
@SPI("openai")
public interface LLMProvider {
    CompletableFuture<String> chat(ChatRequest request);
}

// META-INF/dubbo/com.example.llm.LLMProvider
openai=com.example.llm.OpenAIProvider
anthropic=com.example.llm.AnthropicProvider
qwen=com.example.llm.QwenProvider

// 使用（按名称加载）
String providerName = config.getProvider();  // 从配置读取
LLMProvider provider = loader.getExtension(providerName);
```

**场景 2：自定义 Dubbo Filter（鉴权/监控/限流）**

```java
@Activate(group = {CONSUMER, PROVIDER})  // 双侧都激活
public class TraceFilter implements Filter {
    
    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) throws RpcException {
        String traceId = RpcContext.getContext().getAttachment("traceId");
        if (traceId == null) {
            traceId = UUID.randomUUID().toString();
        }
        MDC.put("traceId", traceId);
        
        try {
            return invoker.invoke(invocation);
        } finally {
            MDC.remove("traceId");
        }
    }
}

// META-INF/dubbo/org.apache.dubbo.rpc.Filter
trace=com.example.filter.TraceFilter
```

**场景 3：自定义序列化**

```java
// META-INF/dubbo/org.apache.dubbo.common.serialize.Serialization
my-protobuf=com.example.MyProtobufSerialization

// Dubbo 启动时扫描，用户配置 <dubbo:protocol serialization="my-protobuf"/>
```

### 4）Java SPI vs Dubbo SPI vs Spring SPI

```
                Java SPI            Dubbo SPI           Spring SPI
──────────────────────────────────────────────────────────────────────────
扫描路径        META-INF/services/  META-INF/dubbo/      spring.factories
按名称加载      ❌                  ✅                   ❌（全量）
AOP 包装        ❌                  ✅（Wrapper）         ❌（需手动 BPP）
自适应扩展      ❌                  ✅（@Adaptive）       ❌
条件激活        ❌                  ✅（@Activate）       ✅（@Conditional）
依赖注入        ❌                  ✅                    ✅（Spring 容器）
使用场景        JDK 标准库扩展      Dubbo 内部扩展点      Spring Boot 自动配置
```

### 5）SPI 的注意事项

```
注意点                                     说明
──────────────────────────────────────────────────────────────
类加载器问题                               ServiceLoader 使用 context classloader
                                           OSGi / 多 ClassLoader 环境需注意
线程安全（Java SPI）                        ServiceLoader 本身非线程安全
全量实例化（Java SPI）                      每次 load() 都创建新的 Loader，多次调用浪费
Dubbo SPI 缓存                             ExtensionLoader 单例 + 扩展实例缓存
自定义 SPI 文件必须在 classpath 下          Jar 包里的 META-INF/xxx 会被扫描到
```

## 延伸追问

- **Q：Spring Boot 的 AutoConfiguration 用的是什么机制？**
  → Spring Boot 2.x 用的是 `spring.factories`（类似 SPI），3.x 改为 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`。原理和 SPI 相同，但扫描的是 Spring 自定义格式，由 `SpringFactoriesLoader` 加载。
- **Q：Dubbo SPI 和 Java SPI 在类加载上有什么区别？**
  → Java SPI 的 `ServiceLoader` 使用 `Thread.currentThread().getContextClassLoader()`，而 Dubbo 的 `ExtensionLoader` 默认使用被扩展接口的 ClassLoader——这在 OSGi 或自定义类加载器环境下有重要区别。Dubbo 3.x 引入了 `ScopeModel` 进一步隔离类加载器。
- **Q：如何在大模型应用平台项目里应用 SPI 思想？**
  → 把可变的部分（LLM Provider、向量数据库、Reranker 模型、评测器）定义成接口，实现用 SPI 或 Spring `@Conditional` 按配置加载。这样新增 Provider 只需加 jar 包 + 配置，不需要修改核心代码——开闭原则的典型应用。

## 我的记法

- **Java SPI = ServiceLoader + META-INF/services**：简单但全量加载
- **Dubbo SPI = 按名称 + Wrapper AOP + @Adaptive + @Activate**：完整插件系统
- 核心特性记忆：**"按名称、有 AOP、可自适应、条件激活"**
- 实战场景：自定义 Dubbo Filter（埋点/鉴权）/ LLM Provider 扩展
- 一句话：**「SPI = 接口与实现解耦的插件机制，Dubbo SPI 是 Java SPI 的生产级增强」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能写出一个自定义 Dubbo Filter 的完整代码
