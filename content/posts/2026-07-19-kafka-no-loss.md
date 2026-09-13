---
title: Kafka 不丢不重的实践清单
date: 2026-07-19
tags: [Kafka, 分布式, 消息队列]
summary: 从生产者、Broker 到消费者，把"消息不丢"和"消息不重"拆成可以逐条检查的清单，并说明为什么端到端恰好一次往往要落到业务幂等上。
---

## 先说结论

消息系统的可靠性可以拆成两个独立问题：

- **不丢**：靠重试 + 确认机制 + 持久化副本保证
- **不重**：靠幂等消费保证，Kafka 自身只能做到分区内的幂等

真正落地的方案，几乎都是"至少一次投递 + 业务侧幂等"。

## 生产者侧

关键就三个参数：

```properties
acks=all
retries=2147483647
enable.idempotence=true
max.in.flight.requests.per.connection=5
```

- `acks=all` 要求 ISR 全部确认，配合 `min.insync.replicas=2` 才有意义
- `enable.idempotence=true` 会开启生产者幂等，保证单分区内重试不产生重复
- 开了幂等之后 `max.in.flight` 可以放到 5，但**不能超过 5**

发送结果一定要处理，别只 `send()` 不 `get()`：

```java
producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        // 落库重试表 / 告警，绝不能吞掉
        log.error("send failed, key={}", record.key(), exception);
    }
});
```

> 最常见的"丢消息"其实是业务代码里 `try { send } catch (Exception ignored) {}`。

## Broker 侧

```properties
default.replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
log.flush.interval.messages=10000
```

`unclean.leader.election.enable=false` 是底线：宁可分区不可用，也不让落后的副本当 Leader。

另外注意磁盘水位线，写满时 Broker 会拒绝写入：

```properties
log.retention.bytes=107374182400
log.retention.hours=168
```

## 消费者侧

消费端是重复消息的主要来源，因为**位移提交和业务处理不在同一个事务里**。

```properties
enable.auto.commit=false
isolation.level=read_committed
max.poll.records=200
```

手动提交时的顺序很关键：

```text
1. 拉取消息
2. 业务处理（写库）
3. 处理成功 → commitSync，失败 → 不提交并抛出
```

如果先提交再处理，进程崩溃就会丢消息；如果处理后提交失败，就会重复消费。既然重复不可避免，就必须做幂等。

## 幂等消费的三种做法

| 方案 | 适用场景 | 代价 |
| --- | --- | --- |
| 唯一索引 + 插入忽略 | 单表写入，有天然业务主键 | 需要设计业务主键 |
| 去重表 | 跨表操作 | 多一次写，需要定期清理 |
| Redis SETNX | 允许极小概率失效 | 存在缓存与库不一致窗口 |

推荐优先选唯一索引，它由数据库保证，不依赖应用逻辑正确。

```sql
-- 以订单号 + 事件类型作为业务唯一键
CREATE UNIQUE INDEX uk_order_event ON order_event (order_no, event_type);
```

```java
// 插入冲突即视为重复消息，直接跳过
try {
    orderEventMapper.insert(event);
} catch (DuplicateKeyException e) {
    log.warn("duplicate message, orderNo={}, type={}", event.getOrderNo(), event.getType());
    return;
}
```

## 消费积压的应急顺序

1. 先确认是消费慢还是分区不均衡（看 `LAG` 的分布）
2. 消费慢 → 检查是否有同步 RPC、慢 SQL，或 `max.poll.interval.ms` 过小导致反复 rebalance
3. 分区不均衡 → 检查 key 的分布，避免热点 key
4. 都不是 → 临时扩消费者实例（不超过分区数）或扩容分区

## 小结

一句话总结这套组合拳：**生产端不丢，消费端幂等，监控端有滞后告警**。

把这三件事做完，消息可靠性的问题就基本收敛了。
