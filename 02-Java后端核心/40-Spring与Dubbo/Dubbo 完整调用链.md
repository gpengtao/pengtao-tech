---
tags: [P0, Java方向, 生疏]
相关: "[[02-Java后端核心/index]]"
---
# Dubbo 完整调用链（代理→集群→负载均衡→路由→序列化→线程分发）

## 一句话速记

**Dubbo Consumer 发起调用的完整路径**：**Proxy（透明代理）→ Registry（服务发现）→ Cluster（集群容错：FailOver/FailFast 等）→ LoadBalance（负载均衡：Random/RoundRobin 等）→ Router（路由规则过滤）→ Filter 链（监控/限流/鉴权）→ Protocol（Dubbo 协议编解码）→ Serialization（Hessian2/Protobuf）→ NettyClient（网络传输）**；Provider 端：**NettyServer → Dispatcher（线程分发）→ 业务线程池 → Filter 链 → Invoker（真正执行）**。

## 通俗解释（5 分钟版）

**Consumer 侧（调用方）**：

```
业务代码：OrderService orderService = ...
orderService.createOrder(req);  // 看起来是本地调用

↓ 实际是透明代理
Proxy#invoke() 
  ↓
Directory → 从注册中心获取可用 Provider 列表（缓存在本地）
  ↓
Router → 路由规则过滤（标签路由、条件路由、灰度）
  ↓
LoadBalance → 从过滤后的列表选一台（随机/轮询/最少活跃）
  ↓
Cluster → 集群容错策略（FailOver 失败重试/FailFast 快速失败）
  ↓
Filter Chain（Consumer 侧，如监控/熔断/限流）
  ↓
Protocol#refer() → 编码 Request（方法名、参数、附件）
  ↓
Serialization → 序列化参数（Hessian2/Protobuf/Kryo）
  ↓
Transport → Netty Client 发送（TCP 长连接）
```

**Provider 侧（服务提供方）**：

```
NettyServer → 接收请求
  ↓
Dispatcher（线程分发策略）
  → All（默认，全部到业务线程池）
  → Direct（IO 线程直接处理，慎用）
  → Message（只把 request 分发到业务线程池）
  ↓
ThreadPool（业务线程池，默认 fixed=200）
  ↓
Filter Chain（Provider 侧，如鉴权/日志/限流）
  ↓
Invoker → 反射调用实现类方法
  ↓
序列化结果 → NettyServer 返回
```

## 关键细节

### 1）Cluster 容错策略

```
策略                  行为                              适用场景
────────────────────────────────────────────────────────────────
FailOver（默认）       失败重试其他节点（默认 2 次）     读操作（幂等）
FailFast              失败立即抛异常，不重试             写操作（非幂等，如下单）
FailSafe              失败静默（记录日志），不影响主流程  旁路逻辑（日志上报）
FailBack              失败后台定时重试                   非关键定时任务
Forking              并行调用多台，任意一台返回则成功    性能要求极高（浪费资源）
Broadcast             广播所有 Provider（全部成功才OK） 缓存刷新、配置同步
```

**FailOver 的重试注意事项**：
```
重试会发到不同的 Provider！
如果操作是非幂等的（插入、扣款），重试可能导致重复操作！
→ 重要写操作用 FailFast，或确保接口幂等
→ retries=0 可以关闭重试：@DubboReference(retries=0)
```

### 2）负载均衡策略

```
策略                  算法                              特点
────────────────────────────────────────────────────────────────
RandomLoadBalance     随机（按权重）                    均匀，适合多数场景
RoundRobinLoadBalance 轮询（按权重）                    均匀，预测性好
LeastActiveLoadBalance 最少活跃请求数                   把请求给最"空闲"的节点
ShortestResponseLoadBalance 最短响应时间               性能感知，适合异构节点
ConsistentHashLoadBalance 一致性哈希                   同参数请求到同节点（有状态）
```

### 3）Dispatcher（线程分发）——Provider 侧关键

```
Handler 类型          说明                    适用
────────────────────────────────────────────────────────────────
AllDispatcher（默认）  所有事件（连接/请求/心跳）全到业务池  通用
DirectDispatcher      IO 线程直接处理         慎用！轻量任务
MessageOnlyDispatcher  只有 request 消息到业务池  减少业务线程切换开销
ExecutionDispatcher    只有 request 到线程池，响应在 IO 处理  连接多时用
```

**Provider 线程池打满的关键**：默认是 `AllDispatcher` + `FixedThreadPool(200)`。IO 线程（Netty EventLoop）负责网络读写，业务线程池负责业务逻辑——线程池满了就会拒绝，表现为 Consumer 超时。

### 4）序列化对比

```
序列化方式            特点                              推荐场景
──────────────────────────────────────────────────────────────
Hessian2（默认）      Java 原生，跨语言支持有限         Java-to-Java
Protobuf              跨语言，体积小，性能好            多语言互通
Kryo                  Java 专用，速度极快               Java-to-Java 高性能
JSON                  可读性好，体积大，性能差           调试
```

**序列化坑**：
- `int[]` 反序列化成 `long[]`（Hessian2 类型推断）
- 泛型类型擦除后反序列化丢失类型
- 循环引用导致栈溢出

### 5）Dubbo 协议 vs Spring Cloud HTTP 对比

```
维度              Dubbo（默认 dubbo 协议）   Spring Cloud（HTTP REST）
──────────────────────────────────────────────────────────────────
传输              TCP 长连接（Netty）         HTTP（短连接或 keep-alive）
编解码            Dubbo 自定义协议帧          HTTP/1.1 文本协议
序列化            Hessian2/Protobuf           JSON
性能              快（小包场景 3-10x）        慢（HTTP header 开销）
可读性            差（二进制）                好（可 curl 调试）
跨语言            有限                        通用
```

### 6）Consumer 端超时的位置

```
Consumer 调用 → 发出请求 → 等待响应
                              ↑
                        这里等待 timeout（默认 1000ms）
                        
超时发生在：Consumer 等待 Provider 响应超过 timeout
Provider 可能：
  - 还在执行（线程池处理中）
  - 线程池满了，任务在队列里等（超时而 Provider 未感知）
  - 网络问题
  
重要：Provider 超时后继续执行，Consumer 已经超时返回错误了！
→ 可能导致"Provider 完成了操作，Consumer 却认为失败"
→ 这是分布式调用中幂等性的重要来源
```

## 延伸追问

- **Q：Dubbo 的超时是从哪一刻开始计算的？**
  → 从 Consumer 发出请求的那一刻开始，不是 Provider 接收到的时刻。包含了网络传输时间。所以 Consumer 超时 ≠ Provider 业务超时，见下一篇笔记。
- **Q：Dubbo 的注册中心挂了，Consumer 还能调用吗？**
  → 能——Consumer 本地缓存了 Provider 列表（内存缓存 + 文件缓存）。注册中心挂了只影响服务动态上下线，不影响已有的调用。Provider 的文件缓存在 `~/.dubbo/` 目录。
- **Q：Dubbo 3.x 和 2.x 有哪些重要变化？**
  → ① **Triple 协议**（基于 gRPC/HTTP2，支持流式调用）成为默认推荐 ② **Proxyless Mesh**（无 SideCar 的 Service Mesh 集成）③ **应用级服务发现**（按应用注册，不按接口）④ 更好的云原生支持（Kubernetes）。

## 我的记法

- **Consumer 侧路径**：代理 → 路由 → 负载均衡 → 集群容错 → Filter → 序列化 → Netty
- **Provider 侧路径**：Netty → Dispatcher（线程分发）→ 业务线程池 → Filter → 反射执行
- **FailOver = 读用，FailFast = 写用**（幂等判断）
- **Dispatcher 默认 All**：IO + 业务都走业务线程池（200 线程），满了就拒绝
- 超时从 Consumer 发请求时开始算，Provider 超时继续执行（幂等问题）
- 一句话：**「Dubbo 调用链是多层 SPI 扩展叠加——每层都能替换，核心是 Cluster+LB+线程分发」**

## 状态
- [ ] 已背速记（Consumer/Provider 各自路径）
- [ ] 能讲通俗版
- [ ] 能答 Dispatcher 和超时追问
