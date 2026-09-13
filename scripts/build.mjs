#!/usr/bin/env node
/**
 * 零依赖静态博客生成器
 *
 * 输入：content/posts/*.md、content/about.md、templates/*.html、site.config.json、assets/**
 * 输出：index.html、posts/*.html、archive.html、tags.html、about.html、404.html
 *       feed.xml、sitemap.xml、search-index.json
 *
 * 用法：
 *   node scripts/build.mjs            正式构建（跳过 draft: true 的文章）
 *   node scripts/build.mjs --drafts   连草稿一起构建
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INCLUDE_DRAFTS = process.argv.includes('--drafts');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE_URL = String(config.url || '').replace(/\/+$/, '');

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
};
const template = (name) => read(path.join(ROOT, 'templates', name));

/* ==========================================================================
   通用工具
   ========================================================================== */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const stripTags = (html) => String(html).replace(/<[^>]*>/g, '');

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function readingTime(text) {
  const plain = stripTags(text);
  const cjk = (plain.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (plain.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
  const minutes = Math.max(1, Math.round(cjk / 350 + words / 180));
  return `${minutes} 分钟阅读`;
}

function excerptFrom(html, length = 120) {
  const plain = stripTags(html).replace(/\s+/g, ' ').trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

function unquote(value) {
  const v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/* ==========================================================================
   Front Matter（极简 YAML 子集）
   ========================================================================== */

function parseFrontMatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw.trim() };

  const data = {};
  let currentKey = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem && currentKey && Array.isArray(data[currentKey])) {
      data[currentKey].push(unquote(listItem[1]));
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;

    currentKey = kv[1];
    const value = kv[2].trim();

    if (value === '') {
      data[currentKey] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((v) => unquote(v))
        .filter(Boolean);
    } else if (value === 'true' || value === 'false') {
      data[currentKey] = value === 'true';
    } else {
      data[currentKey] = unquote(value);
    }
  }

  return { data, body: raw.slice(match[0].length).trim() };
}

/* ==========================================================================
   Markdown 渲染（常用子集）
   支持：标题、段落、粗体/斜体/删除线、行内代码、代码块、链接、图片、
        有序/无序列表（一层嵌套）、引用、表格、分隔线、裸链接、行内 HTML
   ========================================================================== */

function renderInline(text) {
  const codes = [];
  let out = escapeHtml(text);

  // 行内代码先占位，避免内部内容被后续规则误伤
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // 图片
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) =>
      `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy" decoding="async" />`
  );

  // 链接
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, label, href, title) => {
      const external = /^https?:\/\//i.test(href);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${attrs}${titleAttr}>${label}</a>`;
    }
  );

  // 自动链接：<https://example.com> 或 <me@example.com>
  out = out.replace(
    /&lt;(https?:\/\/[^\s&]+)&gt;/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  out = out.replace(/&lt;(mailto:)?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)&gt;/g, (_, scheme, address) => {
    const href = scheme ? `mailto:${address}` : `mailto:${address}`;
    return `<a href="${href}">${address}</a>`;
  });

  // 强调
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 裸链接
  out = out.replace(
    /(^|[\s(（])(https?:\/\/[^\s<)）]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
  );

  // 还原行内代码
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);

  return out;
}

function plainInline(text) {
  return stripTags(renderInline(text)).replace(/\s+/g, ' ').trim();
}

function codeBlock(code, lang) {
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<div class="code-block"${langAttr}><pre><code${cls}>${escapeHtml(code)}</code></pre></div>`;
}

const RE_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s*>/;
const RE_HTML_BLOCK = /^\s*<([a-zA-Z][\w-]*)(\s|>|\/)/;

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isBlockStart(line, nextLine) {
  if (!line.trim()) return true;
  if (RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line)) return true;
  if (RE_QUOTE.test(line) || RE_LIST_ITEM.test(line)) return true;
  if (RE_HTML_BLOCK.test(line)) return true;
  if (line.includes('|') && nextLine && isTableSeparator(nextLine)) return true;
  return false;
}

function renderList(lines, startIdx) {
  const first = RE_LIST_ITEM.exec(lines[startIdx]);
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const items = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const item = RE_LIST_ITEM.exec(line);

    if (item) {
      const indent = item[1].length;
      if (indent < baseIndent) break;

      if (indent > baseIndent && items.length) {
        const nested = renderList(lines, i);
        items[items.length - 1].children += nested.html;
        i = nested.next;
        continue;
      }

      if (indent === baseIndent && /^\d/.test(item[2]) !== ordered) break;

      items.push({ text: item[3], children: '' });
      i += 1;
      continue;
    }

    if (!line.trim()) {
      const next = lines[i + 1];
      if (!next || (!RE_LIST_ITEM.test(next) && !/^\s+\S/.test(next))) break;
      i += 1;
      continue;
    }

    // 列表项的续行
    if (items.length && /^\s+/.test(line)) {
      items[items.length - 1].text += ` ${line.trim()}`;
      i += 1;
      continue;
    }

    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>${items
    .map((item) => `<li>${renderInline(item.text)}${item.children}</li>`)
    .join('')}</${tag}>`;

  return { html, next: i };
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  const toc = [];
  const usedIds = new Map();

  const uniqueId = (text) => {
    const base = slugify(text) || 'section';
    const seen = usedIds.get(base) || 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 代码块
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || '';
      const buf = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      html.push(codeBlock(buf.join('\n'), lang));
      continue;
    }

    // 标题
    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const id = uniqueId(plainInline(text));
      if (level === 2 || level === 3) toc.push({ level, id, text: plainInline(text) });
      html.push(
        `<h${level} id="${id}">${renderInline(text)}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${level}>`
      );
      i += 1;
      continue;
    }

    // 分隔线
    if (RE_HR.test(line)) {
      html.push('<hr />');
      i += 1;
      continue;
    }

    // 引用
    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>\n${renderMarkdown(buf.join('\n')).html}\n</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const head = header.map((c) => `<th>${renderInline(c)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
        .join('');
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    // 列表
    if (RE_LIST_ITEM.test(line)) {
      const list = renderList(lines, i);
      html.push(list.html);
      i = list.next;
      continue;
    }

    // 原始 HTML 块
    if (RE_HTML_BLOCK.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) {
        buf.push(lines[i]);
        i += 1;
      }
      html.push(buf.join('\n'));
      continue;
    }

    // 段落
    const buf = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    html.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }

  return { html: html.join('\n'), toc };
}

/* ==========================================================================
   模板渲染
   ========================================================================== */

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

const LAYOUT = template('layout.html');
const TPL_INDEX = template('index.html');
const TPL_POST = template('post.html');
const TPL_PAGE = template('page.html');

function pageShell({ content, pageTitle, description, relPath, active, ogType }) {
  const depth = relPath.split('/').length - 1;
  const base = depth > 0 ? '../'.repeat(depth) : '';
  const canonical = SITE_URL ? `${SITE_URL}/${relPath}` : relPath;

  return fillTemplate(LAYOUT, {
    lang: config.lang || 'zh-CN',
    siteTitle: config.title,
    tagline: config.tagline || '',
    author: config.author || '',
    brandMark: (config.title || 'O').trim().charAt(0).toUpperCase(),
    pageTitle,
    description,
    canonical,
    ogType: ogType || 'website',
    base,
    navHome: active === 'home' ? ' is-active' : '',
    navArchive: active === 'archive' ? ' is-active' : '',
    navTags: active === 'tags' ? ' is-active' : '',
    navAbout: active === 'about' ? ' is-active' : '',
    repoUrl: config.repo || '#',
    email: config.email || '',
    content,
  });
}

function postCard(post, base = '') {
  const tags = post.tags
    .map((tag) => `<li><a class="tag" href="${base}tags.html#tag-${slugify(tag)}">#${escapeHtml(tag)}</a></li>`)
    .join('');

  return `      <article class="post-card">
        <div class="card-meta">
          <time datetime="${post.dateISO}">${post.dateText}</time>
          <span aria-hidden="true">·</span>
          <span>${post.readingTime}</span>
        </div>
        <h3 class="card-title"><a href="${base}${post.url}">${escapeHtml(post.title)}</a></h3>
        <p class="card-summary">${escapeHtml(post.summary)}</p>
        ${tags ? `<ul class="card-tags">${tags}</ul>` : ''}
      </article>`;
}

function tocHtml(toc) {
  if (!toc.length) return '';
  const items = toc
    .map((item) => `          <li class="toc-lv${item.level}"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`)
    .join('\n');
  return `      <nav class="toc" aria-label="文章目录">
        <p class="toc-title">目录</p>
        <ul>
${items}
        </ul>
      </nav>`;
}

/* ==========================================================================
   读取文章
   ========================================================================== */

const postsDir = path.join(ROOT, 'content', 'posts');
const postFiles = fs.existsSync(postsDir)
  ? fs.readdirSync(postsDir).filter((f) => f.endsWith('.md') || f.endsWith('.markdown'))
  : [];

const allPosts = [];
const slugSeen = new Map();

for (const file of postFiles) {
  const raw = read(path.join(postsDir, file));
  const { data, body } = parseFrontMatter(raw);
  const defaultSlug = file.replace(/\.(md|markdown)$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const slug = String(data.slug || defaultSlug);

  if (slugSeen.has(slug)) {
    console.warn(`[warn] 文章 slug 重复：${slug}（${file} 与 ${slugSeen.get(slug)}）`);
  }
  slugSeen.set(slug, file);

  const rendered = renderMarkdown(body);
  const date = data.date ? String(data.date) : '';
  const tags = Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [];

  allPosts.push({
    file,
    slug,
    url: `posts/${slug}.html`,
    title: String(data.title || slug),
    date,
    dateISO: date.slice(0, 10),
    dateText: formatDate(date),
    tags,
    draft: data.draft === true,
    summary: String(data.summary || data.description || excerptFrom(rendered.html)),
    content: rendered.html,
    toc: rendered.toc,
    plain: stripTags(rendered.html).replace(/\s+/g, ' ').trim(),
    readingTime: readingTime(rendered.html),
  });
}

const posts = allPosts
  .filter((post) => INCLUDE_DRAFTS || !post.draft)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'zh'));

const written = [];

/* ==========================================================================
   文章详情页
   ========================================================================== */

posts.forEach((post, index) => {
  const newer = posts[index - 1];
  const older = posts[index + 1];

  const navParts = [];
  if (newer) {
    navParts.push(
      `          <a class="nav-prev" href="../${newer.url}"><span class="nav-label">← 上一篇</span>${escapeHtml(newer.title)}</a>`
    );
  }
  if (older) {
    navParts.push(
      `          <a class="nav-next" href="../${older.url}"><span class="nav-label">下一篇 →</span>${escapeHtml(older.title)}</a>`
    );
  }

  const content = fillTemplate(TPL_POST, {
    title: escapeHtml(post.title),
    summary: escapeHtml(post.summary),
    dateISO: post.dateISO,
    dateText: post.dateText,
    readingTime: post.readingTime,
    author: config.author || '',
    tagsHtml: post.tags
      .map((tag) => `          <li><a class="tag" href="../tags.html#tag-${slugify(tag)}">#${escapeHtml(tag)}</a></li>`)
      .join('\n'),
    content: post.content,
    tocHtml: tocHtml(post.toc),
    prevNextHtml: navParts.join('\n'),
  });

  const html = pageShell({
    content,
    pageTitle: `${post.title} · ${config.title}`,
    description: post.summary,
    relPath: post.url,
    active: 'home',
    ogType: 'article',
  });

  write(path.join(ROOT, post.url), html);
  written.push(post.url);
});

/* ==========================================================================
   首页
   ========================================================================== */

const homeCount = Number(config.homePostCount) || posts.length;
const homePosts = posts.slice(0, homeCount);

const indexContent = fillTemplate(TPL_INDEX, {
  base: '',
  author: config.author || '',
  heroTitle: escapeHtml(config.heroTitle || config.title),
  heroSub: escapeHtml(config.heroSub || config.description || ''),
  postCount: posts.length,
  postsHtml: homePosts.map((post) => postCard(post)).join('\n'),
});

write(
  path.join(ROOT, 'index.html'),
  pageShell({
    content: indexContent,
    pageTitle: `${config.title} · ${config.tagline || ''}`.replace(/ · $/, ''),
    description: config.description || '',
    relPath: 'index.html',
    active: 'home',
  })
);
written.push('index.html');

/* ==========================================================================
   归档页
   ========================================================================== */

const byYear = new Map();
for (const post of posts) {
  const year = (post.dateISO || '').slice(0, 4) || '未标注年份';
  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push(post);
}

const archiveBody = [...byYear.entries()]
  .map(
    ([year, list]) => `      <h2 class="archive-year">${escapeHtml(year)}</h2>
      <ul class="archive-list">
${list
  .map(
    (post) => `        <li>
          <time datetime="${post.dateISO}">${post.dateText || '—'}</time>
          <a href="${post.url}">${escapeHtml(post.title)}</a>
          <span class="count">${post.tags.map((t) => '#' + escapeHtml(t)).join(' ')}</span>
        </li>`
  )
  .join('\n')}
      </ul>`
  )
  .join('\n');

write(
  path.join(ROOT, 'archive.html'),
  pageShell({
    content: fillTemplate(TPL_PAGE, {
      title: '文章归档',
      description: `共 ${posts.length} 篇文章，按年份倒序排列。`,
      content: archiveBody || '<p class="muted">还没有文章。</p>',
    }),
    pageTitle: `文章归档 · ${config.title}`,
    description: `${config.title} 的全部文章归档，共 ${posts.length} 篇。`,
    relPath: 'archive.html',
    active: 'archive',
  })
);
written.push('archive.html');

/* ==========================================================================
   标签页
   ========================================================================== */

const tagMap = new Map();
for (const post of posts) {
  for (const tag of post.tags) {
    if (!tagMap.has(tag)) tagMap.set(tag, []);
    tagMap.get(tag).push(post);
  }
}

const sortedTags = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh'));

const tagCloud = sortedTags
  .map(([tag, list]) => `        <a class="tag" href="#tag-${slugify(tag)}">#${escapeHtml(tag)} · ${list.length}</a>`)
  .join('\n');

const tagSections = sortedTags
  .map(
    ([tag, list]) => `      <section class="tag-section" id="tag-${slugify(tag)}">
        <h2>#${escapeHtml(tag)} <span class="count">${list.length} 篇</span></h2>
        <ul class="archive-list">
${list
  .map(
    (post) => `          <li>
            <time datetime="${post.dateISO}">${post.dateText}</time>
            <a href="${post.url}">${escapeHtml(post.title)}</a>
          </li>`
  )
  .join('\n')}
        </ul>
      </section>`
  )
  .join('\n');

write(
  path.join(ROOT, 'tags.html'),
  pageShell({
    content: fillTemplate(TPL_PAGE, {
      title: '标签',
      description: `按主题浏览文章，共 ${sortedTags.length} 个标签。`,
      content: sortedTags.length
        ? `      <div class="tag-cloud">\n${tagCloud}\n      </div>\n${tagSections}`
        : '<p class="muted">还没有标签。</p>',
    }),
    pageTitle: `标签 · ${config.title}`,
    description: `${config.title} 的标签索引。`,
    relPath: 'tags.html',
    active: 'tags',
  })
);
written.push('tags.html');

/* ==========================================================================
   关于页
   ========================================================================== */

const aboutPath = path.join(ROOT, 'content', 'about.md');
const aboutMd = fs.existsSync(aboutPath) ? read(aboutPath) : '';
const aboutRender = renderMarkdown(aboutMd);

write(
  path.join(ROOT, 'about.html'),
  pageShell({
    content: fillTemplate(TPL_PAGE, {
      title: '关于',
      description: `关于 ${config.author || config.title}`,
      content: `<img class="about-avatar" src="assets/img/avatar.svg" alt="${escapeHtml(
        config.author || ''
      )} 的头像" width="116" height="116" />\n${aboutRender.html}`,
    }),
    pageTitle: `关于 · ${config.title}`,
    description: `关于 ${config.author || config.title}。`,
    relPath: 'about.html',
    active: 'about',
  })
);
written.push('about.html');

/* ==========================================================================
   404
   ========================================================================== */

write(
  path.join(ROOT, '404.html'),
  pageShell({
    content: `  <div class="wrap notfound">
    <p class="notfound-code">404</p>
    <h1>这个页面走丢了</h1>
    <p class="muted">链接可能已经失效，或者你输入了一个不存在的地址。</p>
    <p><a class="btn btn-primary" href="index.html">回到首页</a></p>
  </div>`,
    pageTitle: `页面未找到 · ${config.title}`,
    description: '页面未找到',
    relPath: '404.html',
    active: '',
  })
);
written.push('404.html');

/* ==========================================================================
   RSS 订阅
   ========================================================================== */

const feedDate = posts[0] ? new Date(`${posts[0].dateISO}T00:00:00Z`) : new Date();

const feedItems = posts
  .slice(0, 20)
  .map(
    (post) => `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${SITE_URL}/${post.url}</link>
      <guid isPermaLink="true">${SITE_URL}/${post.url}</guid>
      <pubDate>${new Date(`${post.dateISO}T00:00:00Z`).toUTCString()}</pubDate>
${post.tags.map((tag) => `      <category>${escapeHtml(tag)}</category>`).join('\n')}
      <description>${escapeHtml(post.summary)}</description>
    </item>`
  )
  .join('\n');

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(config.title)}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeHtml(config.description || '')}</description>
    <language>${config.lang || 'zh-CN'}</language>
    <lastBuildDate>${feedDate.toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${feedItems}
  </channel>
</rss>
`;

write(path.join(ROOT, 'feed.xml'), feed);
written.push('feed.xml');

/* ==========================================================================
   Sitemap
   ========================================================================== */

const sitemapUrls = ['index.html', 'archive.html', 'tags.html', 'about.html', ...posts.map((p) => p.url)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map((url) => {
    const post = posts.find((p) => p.url === url);
    return `  <url>
    <loc>${SITE_URL}/${url}</loc>${post ? `\n    <lastmod>${post.dateISO}</lastmod>` : ''}
  </url>`;
  })
  .join('\n')}
</urlset>
`;

write(path.join(ROOT, 'sitemap.xml'), sitemap);
written.push('sitemap.xml');

/* ==========================================================================
   站内搜索索引
   ========================================================================== */

const searchIndex = posts.map((post) => ({
  title: post.title,
  url: post.url,
  date: post.dateText,
  tags: post.tags,
  summary: post.summary,
  text: post.plain.slice(0, 4000),
}));

write(path.join(ROOT, 'search-index.json'), `${JSON.stringify(searchIndex, null, 2)}\n`);
written.push('search-index.json');

/* ==========================================================================
   robots.txt
   ========================================================================== */

write(
  path.join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
);
written.push('robots.txt');

console.log(`[build] 完成，共生成 ${written.length} 个文件，文章 ${posts.length} 篇${INCLUDE_DRAFTS ? '（含草稿）' : ''}`);
for (const file of written) console.log(`  · ${file}`);
