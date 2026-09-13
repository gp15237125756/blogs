---
title: Agent的ReAct,Plan-And-Execute模式
date: 2026-09-13
tags: [ReAct, Plan-And-Execute]
summary: Agent。
---

## 背景

Agent相比LLM，可以操作各种工具。Agent的种类很多，有编程Agent，PPT制作Agent等，会议纪要助手Agent等等。

## 分析

ReAct模式：Reasoning and action,即思考和执行
具体分为：提交任务-思考-判断是否使用工具-行动-观察结果-思考-判断是否使用工具-行动-观察结果....直到得到最终结果
Plan-And-Execute模式： 用户提交任务-Agent主程序-Plan模型-执行Agent-Agent主程序 - Re-Plan模型-执行Agent

## 结论

Agent通过ReAct或Plan-And-Execute，给大模型增加了四肢，可以完成具体任务。
