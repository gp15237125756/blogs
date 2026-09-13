---
title: ShardingSphere-JDBC 分库分表踩坑记录
date: 2026-05-16
tags: [分库分表, ShardingSphere, 数据库]
summary: 分片键选择、跨分片查询、分布式主键、事务边界——记录一次从单库迁移到 4 库 8 表的完整过程和五个真实踩过的坑。
---

## 背景

订单表 3 亿行，单表索引已经压不住。目标拆成 4 库 × 8 表，使用 ShardingSphere-JDBC 5.4，业务代码尽量零改动。

## 坑一：分片键选错，热点集中

最初按 `create_time` 分片，结果所有写请求都落在最新那个分片上——新数据的时间总是当前时间。

分片键的选择顺序应该是：

1. **查询条件里必带的字段**（避免跨分片广播）
2. **分布均匀的字段**（避免热点）
3. **不随时间倾斜的字段**

最终改成 `user_id` 取模，写入彻底打散。

```yaml
spring:
  shardingsphere:
    rules:
      sharding:
        tables:
          t_order:
            actual-data-nodes: ds$->{0..3}.t_order_$->{0..7}
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: db-inline
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: table-inline
        sharding-algorithms:
          db-inline:
            type: INLINE
            props:
              algorithm-expression: ds$->{user_id % 4}
          table-inline:
            type: INLINE
            props:
              algorithm-expression: t_order_$->{user_id % 8}
```

## 坑二：跨分片分页

`LIMIT 100000, 20` 在分片环境下会被改写成每个分片 `LIMIT 0, 100020`，内存和网络开销直接爆炸。

三种处理方式：

| 方案 | 说明 | 适用 |
| --- | --- | --- |
| 禁止深分页 | 限制最大翻页数 | 后台管理系统 |
| 二次查询法 | 用偏移量反查最小 ID | 需要精确分页 |
| 游标分页 | `WHERE id > last_id ORDER BY id LIMIT 20` | 推荐，性能最好 |

我们最后把前台接口全改成游标分页，问题消失。

## 坑三：分布式主键与索引膨胀

用 UUID 做主键，B+ 树随机插入，页分裂严重。改用雪花算法：

```java
// 雪花 ID 单调递增，且不含业务信息
long id = snowflake.nextId();
```

注意雪花算法依赖机器时钟，务必开启时钟回拨保护，否则会生成重复 ID。

## 坑四：跨库 JOIN 与分布式事务

分片后 `JOIN` 只能在同一个分片内进行。跨库查询有三种选择：

1. **冗余字段**：把常用的关联字段冗余到订单表（我们选了这条）
2. **应用层组装**：先查主表再批量查从表
3. **广播表**：把配置类小表在每个库都放一份

事务方面，跨库写必须用 `@ShardingSphereTransactionType(TransactionType.BASE)` 或走本地消息表。**能在一个分片内完成的事务，就不要跨分片**。

## 坑五：上线顺序

迁移过程按这个顺序走，每一步都可回滚：

```text
1. 双写（旧表 + 新分片表），以旧表为准
2. 全量迁移历史数据 + 校验行数与抽样比对
3. 读切分片表，观察一周
4. 停止双写，旧表保留只读
5. 清理旧表
```

第 2 步的数据校验一定要做，我们当时发现 12 万行数据因为时间字段格式问题漏迁，靠抽样比对捞回来的。

## 小结

- 分片键决定架构上限，选错了后面所有优化都是补丁
- 分片后**没有免费的 JOIN 和事务**，必须在设计阶段就把访问路径想清楚
- 迁移一定要可回滚，双写期越长越安全

分库分表是最后的手段。如果单表两千万行以内、加索引就能解决，别急着拆。
