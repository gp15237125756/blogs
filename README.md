# Odette 的博客

一个**零依赖**的静态个人博客：用 Markdown 写文章，用 Node.js 脚本生成静态 HTML，托管在 Gitee Pages。

不需要 `npm install`，没有框架，没有构建插件。整个生成器只有一个文件：`scripts/build.mjs`。

## 特性

- **Markdown 写作**：支持标题、列表、表格、引用、代码块、图片、行内 HTML
- **零依赖构建**：只用 Node.js 内置模块，克隆下来就能跑
- **响应式设计**：手机、平板、桌面自适应
- **深浅色主题**：跟随系统，也可手动切换并记住选择
- **站内搜索**：基于构建时生成的 JSON 索引，纯前端匹配
- **文章目录**：自动提取二级 / 三级标题并高亮当前小节
- **阅读体验**：阅读进度条、代码一键复制、回到顶部、上一篇 / 下一篇
- **SEO 友好**：自动生成 RSS、Sitemap、robots.txt、canonical 与 Open Graph 标签

## 快速开始

需要 Node.js 18 或更高版本。

```bash
# 新建一篇文章，自动生成文件名和 front matter
node scripts/new-post.mjs "G1 调参实战" --tags Java,JVM

# 构建站点（输出到仓库根目录）
node scripts/build.mjs

# 本地预览 http://localhost:4000
node scripts/serve.mjs
```

如果你习惯用 npm 脚本：

```bash
npm run new -- "文章标题"
npm run build
npm run serve
```

## 目录结构

```
blog/
├─ content/
│  ├─ posts/           # 文章源文件（Markdown）
│  └─ about.md         # 关于页内容
├─ templates/          # HTML 模板
│  ├─ layout.html      # 页面骨架（头部、导航、页脚、搜索框）
│  ├─ index.html       # 首页
│  ├─ post.html        # 文章页
│  └─ page.html        # 通用页面（归档 / 标签 / 关于）
├─ scripts/
│  ├─ build.mjs        # 生成器：Markdown → HTML
│  ├─ new-post.mjs     # 新建文章
│  └─ serve.mjs        # 本地预览服务器
├─ assets/             # 静态资源（CSS / JS / 图片）
├─ site.config.json    # 站点配置
│
│  ↓ 以下为构建产物，会被提交到仓库
├─ index.html          # 首页
├─ posts/*.html        # 文章页
├─ archive.html        # 归档
├─ tags.html           # 标签
├─ about.html          # 关于
├─ 404.html            # 404 页面
├─ feed.xml            # RSS 订阅
├─ sitemap.xml         # 站点地图
├─ search-index.json   # 搜索索引
└─ robots.txt
```

构建产物必须提交，因为 Gitee Pages 直接托管静态文件，不会替你执行构建。

## 写一篇新文章

在 `content/posts/` 下新建 `.md` 文件，开头是 front matter：

```markdown
---
title: 文章标题
date: 2026-09-13
tags: [Java, JVM]
summary: 一段摘要，会显示在首页卡片和搜索结果里。
---

## 正文标题

这里写正文。
```

可用字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 文章标题 |
| `date` | 是 | 发布日期，格式 `YYYY-MM-DD`，决定排序与归档 |
| `tags` | 否 | 标签，写成 `[A, B]` 或换行 `- A` |
| `summary` | 否 | 摘要，不填则自动截取正文前 120 字 |
| `slug` | 否 | 输出文件名，默认取 Markdown 文件名（去掉日期前缀） |
| `draft` | 否 | 设为 `true` 时构建会跳过；加 `--drafts` 可强制包含 |

### Markdown 支持范围

```text
标题         # ~ ######，## 和 ### 会进入文章目录
强调         **粗体**  *斜体*  ~~删除线~~
代码         行内 `code`、围栏代码块 ```java
链接         [文字](链接)、<https://example.com> 自动链接
图片         ![说明](图片地址)
列表         - 无序、1. 有序，支持一层嵌套
引用         > 引用内容
表格         标准 GFM 表格
其它         --- 分隔线、直接书写 HTML
```

加粗、列表这类内容建议保留空格，例如 `**重点**`、`- 项目`，避免解析歧义。

## 站点配置

编辑 `site.config.json`：

```json
{
  "title": "Odette 的博客",
  "tagline": "后端开发 / Java / 分布式",
  "author": "Odette",
  "description": "站点描述，用于 SEO 和 RSS",
  "url": "https://odetteisgorgeous.gitee.io/blogs",
  "repo": "https://gitee.com/odetteisgorgeous/blogs",
  "email": "your@email.com",
  "lang": "zh-CN",
  "heroTitle": "首页大标题",
  "heroSub": "首页副标题",
  "homePostCount": 6
}
```

改完执行 `node scripts/build.mjs` 重新生成即可。`url` 必须与实际访问地址一致，否则 RSS 和 Sitemap 里的链接会出错。

## 部署到 Gitee Pages

仓库地址：`git@gitee.com:odetteisgorgeous/blogs.git`

```bash
# 首次推送
git remote add origin git@gitee.com:odetteisgorgeous/blogs.git
git push -u origin master

# 之后每次更新
node scripts/build.mjs
git add -A
git commit -m "post: 新文章标题"
git push
```

推送到仓库后，在 Gitee 仓库页面进入 **服务 → Gitee Pages**，选择：

- 部署分支：`master`
- 部署目录：`/`

点击启动后，站点地址为 `https://odetteisgorgeous.gitee.io/blogs`。

> 两点提醒：
>
> 1. Gitee Pages 需要账号完成实名认证，且该服务对个人用户的开通政策时有调整，若无法开通，可把同一份产物部署到 GitHub Pages、Vercel 或 Cloudflare Pages，改动量为零。
> 2. 每次推送新内容后，需要回到 Pages 页面点击一次**更新**，静态文件才会重新发布。

### 用 GitHub Pages 作为备选

推一份到 GitHub，然后在仓库 **Settings → Pages** 中选择分支和 `/` 目录即可。因为是纯静态产物，任何静态托管平台都能直接用。

## 常见问题

**构建后本地打开 `index.html` 是空白或样式丢失？**

请用 `node scripts/serve.mjs` 起本地服务，直接双击文件会因浏览器安全策略限制导致部分功能（搜索）不可用。

**文章没有出现在首页？**

检查 front matter 里 `draft` 是否为 `true`，以及 `date` 格式是否为 `YYYY-MM-DD`。

**中文标题为什么生成的锚点是中文？**

锚点直接使用标题文字，浏览器与搜索引擎都能正确处理，也便于手动复制分享。若需要英文锚点，把标题改为英文或调整 `slugify` 逻辑。

**想换配色？**

修改 `assets/css/style.css` 顶部的 CSS 变量即可，浅色与深色主题各有一组。

## License

代码采用 [MIT](./LICENSE) 许可，文章内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可。
