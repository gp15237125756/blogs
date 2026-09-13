#!/usr/bin/env node
/**
 * 新建文章
 *
 * 用法：
 *   node scripts/new-post.mjs "文章标题"
 *   node scripts/new-post.mjs "文章标题" --tags Java,JVM --slug g1-tuning --draft
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');

const argv = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(arg);
  }
}

const title = positional.join(' ').trim();

if (!title) {
  console.error('用法：node scripts/new-post.mjs "文章标题" [--tags Java,JVM] [--slug english-slug] [--draft]');
  process.exit(1);
}

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const slug = String(flags.slug || '').trim() || slugify(title) || `post-${date.replace(/-/g, '')}`;
const tags = flags.tags && typeof flags.tags === 'string' ? flags.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
const isDraft = Boolean(flags.draft);

const filename = `${date}-${slug}.md`;
const target = path.join(POSTS_DIR, filename);

if (fs.existsSync(target)) {
  console.error(`文件已存在：${path.relative(ROOT, target)}`);
  process.exit(1);
}

const content = `---
title: ${title}
date: ${date}
tags: [${tags.join(', ')}]
summary: 用一句话说明这篇文章解决什么问题。
${isDraft ? 'draft: true\n' : ''}---

## 背景

先说清楚问题的上下文：什么场景、什么现象、有哪些约束。

## 分析

把推理过程写下来，关键命令和代码放进围栏代码块：

\`\`\`bash
# 示例命令
echo "hello"
\`\`\`

## 结论

给出可执行的结论，以及这个结论在什么前提下成立。
`;

fs.mkdirSync(POSTS_DIR, { recursive: true });
fs.writeFileSync(target, content, 'utf8');

console.log(`已创建：${path.relative(ROOT, target)}`);
console.log('下一步：');
console.log('  1. 编辑文章内容');
console.log('  2. node scripts/build.mjs');
console.log('  3. 本地预览：node scripts/serve.mjs');
