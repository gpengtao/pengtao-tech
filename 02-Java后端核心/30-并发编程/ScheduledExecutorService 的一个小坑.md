# ScheduledExecutorService 的一个小坑

## 先看一段代码

```java
@Test
public void test_schedule() throws IOException {
    ScheduledExecutorService executor = Executors.newScheduledThreadPool(1);

    AtomicInteger integer = new AtomicInteger(0);
    executor.scheduleAtFixedRate(() -> {
        System.out.println(integer.incrementAndGet());

        if (integer.intValue() == 3) {
            throw new RuntimeException();
        }
    }, 0, 1, TimeUnit.SECONDS);

    System.in.read();
}
```

执行结果：

```
1
2
3
```

执行到第 3 次之后，程序不再输出任何内容，定时任务悄然停止。

## 两个问题

**1. RuntimeException 不会有任何感知**

没有 try-catch 打印栈信息，也没有记录日志，整个异常就这么消失了。不要指望 JVM 会自动打印线程里的异常栈——Java 的线程没干这个事。

**2. RuntimeException 会导致定时任务永久停止**

`scheduleAtFixedRate` 的官方注释：

> If any execution of the task encounters an exception, subsequent executions are suppressed. Otherwise, the task will only terminate via cancellation or termination of the executor.

即：**只要任意一次执行抛出异常，后续所有调度都会被静默取消**，且没有任何错误提示。

## 正确的写法

写在线程中运行的 `Runnable`，上来先 `try-catch` **一切**：

```java
executor.scheduleAtFixedRate(new Runnable() {
    @Override
    public void run() {
        try {
            // 业务逻辑
        } catch (Throwable t) {
            log.error("定时任务执行异常", t);
        }
    }
}, 0, 1, TimeUnit.SECONDS);
```

> **注意：** 要 catch `Throwable`，不能只 catch `RuntimeException`——非运行时异常同样会让线程静默死掉，而且没有任何感知。

---

> 原博客发布日期：2019-03-27
