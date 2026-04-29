---
tags: [P1, 通用, 生疏]
---

# 大量 TIME_WAIT / CLOSE_WAIT 的排查

## 一句话速记

**TIME_WAIT** 和 **CLOSE_WAIT** 代表 TCP 关闭的不同阶段，根因完全不同：**TIME_WAIT 多** → 你的服务是主动关闭方，短连接太多（连接用完没复用、没配连接池），调内核参数或改长连接；**CLOSE_WAIT 多** → 你的服务是被动关闭方，但应用层没调 `close()`（socket 泄漏），在 `finally` 里加 close 或排查连接池泄漏。

## 通俗解释（5 分钟版）

```
TCP 四次挥手，谁先关、谁后关决定了状态：

主动关闭方：          被动关闭方：
FIN →                 ← ACK
                      ← FIN          ← 此时被动方是 CLOSE_WAIT
ACK →                                ← 等应用层调 close() 才发 FIN
                                      （如果不调 close，永远卡在这里）
TIME_WAIT（等 2MSL）
  ↓ 60 秒后消失

TIME_WAIT 多  = 你主动关连接太频繁（短连接场景）
CLOSE_WAIT 多  = 对方关了，但你的代码忘了 close()（socket 泄漏）
```

## 关键细节

### 查看命令

```bash
# 统计各状态数量
ss -tan | awk '{print $1}' | sort | uniq -c

# 只看 TIME_WAIT
ss -tan state time-wait | wc -l

# 只看 CLOSE_WAIT
ss -tan state close-wait | wc -l

# 查看 CLOSE_WAIT 的具体连接信息
ss -tanp state close-wait
# -p 显示进程，可以看到是哪个进程没 close
```

### TIME_WAIT 多

**什么是 TIME_WAIT**：
```
主动关闭方在发送最后一个 ACK 后进入 TIME_WAIT
目的：① 确保最后的 ACK 被对方收到（丢了会重传）；
      ② 让网络中残留的旧数据包过期（2MSL ≈ 60s）
TIME_WAIT 是正常状态，但太多会导致端口耗尽
```

**TIME_WAIT 有多少算多？**：
```bash
# 端口范围默认 32768-60999 ≈ 28000 个可用端口
cat /proc/sys/net/ipv4/ip_local_port_range

# TIME_WAIT 接近可用端口数 → 端口耗尽 → 无法建新连接
# 一般 TIME_WAIT > 10000 就要关注，> 20000 要处理
```

**根因和解决方案**：

```bash
# 根因 1：短连接（每次请求建新连接，用完就关）
# 场景：HTTP/1.0 或没配连接池的 HTTP 客户端
# 解法：
# a) 用 HTTP 连接池（HttpClient PoolingHttpClientConnectionManager）
# b) 改用 HTTP/1.1 或 HTTP/2（默认长连接）
# c) Redis/MySQL 连接池

# 根因 2：反向代理/网关 → 后端短连接
# Nginx 示例：
proxy_http_version 1.1;                    # 改用 HTTP/1.1
proxy_set_header Connection "";            # 清空 Connection: close

# 根因 3：内核参数调优（治标不治本，但能缓解）
# 快速回收 TIME_WAIT
echo 1 > /proc/sys/net/ipv4/tcp_tw_reuse          # 复用 TIME_WAIT 连接（客户端侧）
# 注意：tcp_tw_recycle 在 NAT 环境有问题，已被内核移除（4.12+）

# 减小 TIME_WAIT 时间（从 60s → 30s）
# 需要改内核源码或某些云厂商定制内核支持

# 扩大端口范围
echo 1024 65535 > /proc/sys/net/ipv4/ip_local_port_range

# 启用 tcp_timestamps（配合 tw_reuse）
echo 1 > /proc/sys/net/ipv4/tcp_timestamps
```

**TIME_WAIT 排查优先级**：
```
1. 先确认是不是短连接导致的 → 改长连接（治本）
2. 如果必须短连接 → 调 tcp_tw_reuse + 扩大端口范围（缓解）
3. 不要随便调低 TIME_WAIT 时间（可能丢数据）
```

### CLOSE_WAIT 多

**什么是 CLOSE_WAIT**：
```
被动关闭方收到对端的 FIN 后进入 CLOSE_WAIT
此时连接处于半关闭：对方已经不会再发数据了，但你还能发

关键：进入 CLOSE_WAIT 后，应用必须调 close() 才能进入 LAST_ACK → 最终释放
      如果应用不调 close()，连接永远卡在 CLOSE_WAIT，直到进程退出！
```

**CLOSE_WAIT 多是泄漏信号**：

```bash
# CLOSE_WAIT 数量持续增长 → 100% 是应用 bug（socket 没 close）
# 每个 CLOSE_WAIT 连接占用文件描述符和内存
# 累积到文件描述符上限 → 无法接受新连接（Too many open files）

# 排查步骤：
# 1. 看 CLOSE_WAIT 连接的远程地址
ss -tanp state close-wait | awk '{print $5}' | sort | uniq -c | sort -rn
# 如果都是同一个远程 IP:Port → 某个固定的下游服务，排查调用该服务的代码

# 2. 看进程的 fd 数量
ls -la /proc/<pid>/fd | wc -l
lsof -p <pid> | grep "can't identify protocol" | wc -l  # socket fd 数量
```

**常见泄漏场景**：

```java
// ❌ 场景 1：异常时没关连接
try {
    URL url = new URL("http://downstream/api");
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    // 处理响应...
    conn.disconnect();
} catch (Exception e) {
    log.error("call failed", e);
    // BUG：异常时 conn.disconnect() 没执行！
    // 如果这里异常发生在 connect 之前，conn 不是 null 但没 close
}

// ✅ 正确：finally 中 close
HttpURLConnection conn = null;
try {
    conn = (HttpURLConnection) url.openConnection();
    // ...
} catch (Exception e) {
    log.error("call failed", e);
} finally {
    if (conn != null) {
        conn.disconnect();
    }
}

// ❌ 场景 2：连接池泄漏
// HttpClient 的 response 没消费完就返回了
CloseableHttpResponse response = httpClient.execute(request);
String body = EntityUtils.toString(response.getEntity());
return body;  // BUG：response 没 close！
// HttpClient 连接池以为这个连接还在用，不会回收
// 对端超时关闭 → 连接池里的连接变成 CLOSE_WAIT

// ✅ 正确：try-with-resources
try (CloseableHttpResponse response = httpClient.execute(request)) {
    return EntityUtils.toString(response.getEntity());
}

// ❌ 场景 3：InputStream/OutputStream 没 close
InputStream is = socket.getInputStream();
// ...读数据...
// BUG：没 close，即使 socket 后来关了，流可能还持有引用
```

**CLOSE_WAIT 告警阈值**：

```
< 10       正常
10-100     关注（可能是正常的半关闭，可能是泄漏初期）
> 100      确认泄漏！找到增加趋势和对应的代码
> 1000     严重泄漏！文件描述符快不够了
```

### TIME_WAIT vs CLOSE_WAIT 对比

```
维度              TIME_WAIT                  CLOSE_WAIT
──────────────────────────────────────────────────────────
谁的状态          主动关闭方                  被动关闭方
正常/异常         正常状态（每个主动关闭       正常应短暂存在
                  的连接都要经过）
多了说明什么      短连接太多                  应用没 close（泄漏）
持续时间          2MSL（约 60s）自动消失      永久（直到进程退出或 close）
能否自动恢复      能（超时自动消失）           不能（必须应用 close）
排查方向          连接复用/长连接              找没 close 的代码
严重程度          端口耗尽时影响建新连接        文件描述符泄漏，不修会雪崩
```

## 延伸追问

- **Q：Nginx 代理场景下，TIME_WAIT 在 Nginx 机器还是后端机器？**
  → Nginx 主动关闭到客户端的连接 → TIME_WAIT 在 Nginx 上。Nginx 作为客户端连后端 → Nginx 和后端都可能有 TIME_WAIT（取决于谁先关）。开启 `keepalive` 可以大幅减少。
- **Q：CLOSE_WAIT 连接能通过重启恢复吗？**
  → 能。重启进程后所有 socket 被 OS 回收。但重启只治标，不修代码还会再出现。应该在重启前用 `ss -tanp` 抓一下 CLOSE_WAIT 的远程地址，帮助定位泄漏代码。
- **Q：为什么 `tcp_tw_recycle` 被 Linux 内核移除了？**
  → 在 NAT 环境下，不同客户端可能共享同一个公网 IP，tcp_tw_recycle 用 timestamp 判断连接是否可回收，但 NAT 后不同客户端的 timestamp 不一致，导致合法 SYN 被丢弃。所以 4.12 内核后直接移除了这个选项。

## 我的记法

- **TIME_WAIT 多** → 你主动关太多了 → 短连接改长连接/连接池
- **CLOSE_WAIT 多** → 对方关了但你没 close → socket 泄漏，查 finally 里的 close
- **TIME_WAIT 能自愈**（60s 自动消失），**CLOSE_WAIT 不能**（永远卡着直到进程退出）
- 一句话：**「TIME_WAIT 多看连接复用，CLOSE_WAIT 多找漏 close」**

## 状态
- [ ] 已背速记
- [ ] 能讲通俗版
- [ ] 能答追问
