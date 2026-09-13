---
title: G1 调参实战：从 200ms 停顿到 40ms
date: 2026-08-24
tags: [Java, JVM, 性能]
summary: 一次把服务端 G1 的 Young GC 停顿从 200ms 压到 40ms 的过程：先看日志，再定 Region 大小，最后才动参数。
---

## 先别急着调参

线上服务报 P99 抖动，GC 日志最能说明问题。先让 JVM 把话说清楚：

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

拿到日志后，用这三步定位：

1. **看频率**：Young GC 多久一次？如果几秒一次，说明新生代太小或晋升太快
2. **看停顿**：单次停顿是多少？是否伴随 Mixed GC
3. **看回收效果**：每次回收后堆占用降了多少？降不下去说明有对象在反复存活

我们这次的现象是：Young GC 平均 180–220ms，每 6 秒一次，堆 16G，`MaxGCPauseMillis` 默认 200ms。

## 第一步：确认 Region 大小

G1 把堆切成大小相等的 Region，Region 大小由 `-XX:G1HeapRegionSize` 决定，未显式设置时 JVM 按堆大小推算：

| 堆大小 | 默认 Region |
| --- | --- |
| 1G – 2G | 1M |
| 2G – 4G | 2M |
| 4G – 8G | 4M |
| 8G – 16G | 8M |
| 16G – 32G | 16M |
| 32G – 64G | 32M |

16G 堆对应 8M Region，意味着 2000 个 Region。Region 越多，G1 的 Remembered Set 和并发标记的簿记开销越大。

## 第二步：让停顿目标真正生效

G1 的 `MaxGCPauseMillis` 是**软目标**，JVM 会通过调整年轻代大小来逼近它。但有两个坑：

```text
-XX:MaxGCPauseMillis=200     # 软目标，不是硬上限
-XX:G1NewSizePercent=5       # 年轻代下限，默认 5%
-XX:G1MaxNewSizePercent=60   # 年轻代上限，默认 60%
```

- 如果停顿目标设得太小（比如 20ms），G1 会把年轻代压得很小，导致 GC 频率暴涨，吞吐反而下降
- 如果 `G1MaxNewSizePercent` 太小，年轻代长不大，回收效率上不去

我们先把目标设成 60ms，同时提高年轻代上限：

```bash
-XX:MaxGCPauseMillis=60
-XX:G1NewSizePercent=10
-XX:G1MaxNewSizePercent=70
```

## 第三步：处理晋升压力

如果对象在新生代活过 15 次回收就被晋升，而实际存活时间更长，会导致老年代快速膨胀、Mixed GC 频繁。

```bash
-XX:MaxTenuringThreshold=15
-XX:TargetSurvivorRatio=60
-Xmn 或 -XX:NewRatio    # G1 下不要用，会覆盖自适应策略
```

同时打开并行引用处理，减少并发标记阶段的 STW：

```bash
-XX:+ParallelRefProcEnabled
-XX:+PerfDisableSharedMem
```

## 最终参数与结果

```bash
XX:+UseG1GC
-Xms16g -Xmx16g
-XX:MaxGCPauseMillis=60
-XX:G1HeapRegionSize=16m
-XX:G1NewSizePercent=10
-XX:G1MaxNewSizePercent=70
-XX:InitiatingHeapOccupancyPercent=40
-XX:+ParallelRefProcEnabled
-XX:+AlwaysPreTouch
```

调整后的观测结果：

| 指标 | 调整前 | 调整后 |
| --- | --- | --- |
| Young GC 平均停顿 | 200ms | 38ms |
| Young GC 频率 | 6s/次 | 3.5s/次 |
| Mixed GC 频率 | 2 分钟/次 | 8 分钟/次 |
| 服务 P99 | 320ms | 95ms |

## 小结

三个经验：

- **先量化再动手**。GC 日志不骗人，凭感觉调参只会把问题挪个地方
- **停顿目标和年轻代大小是耦合的**，改一个必须看另一个
- **G1 下不要用 `-Xmn`**，它会直接压死自适应策略

下一篇准备写 Concurrent Mark 阶段被老年代占满时的排查思路，那部分坑更深。
