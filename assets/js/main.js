/**
 * 站点交互脚本（零依赖）
 * 包含：主题切换、移动端菜单、阅读进度、回到顶部、代码复制、目录高亮、全站搜索
 */
(function () {
  'use strict';

  var root = document.documentElement;

  /* 站点根路径：脚本位于 <base>assets/js/main.js */
  var scriptEl = document.querySelector('script[src*="assets/js/main.js"]');
  var BASE = '';
  if (scriptEl) {
    BASE = scriptEl.getAttribute('src').replace(/assets\/js\/main\.js.*$/, '');
  }

  /* ---------------- 主题切换 ---------------- */

  var THEME_KEY = 'blog-theme';

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  var themeToggle = document.querySelector('.js-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  /* 未手动设置过主题时，跟随系统变化 */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function (e) {
      var stored = null;
      try {
        stored = localStorage.getItem(THEME_KEY);
      } catch (err) {
        stored = null;
      }
      if (!stored) {
        root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSchemeChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onSchemeChange);
    }
  }

  /* ---------------- 移动端菜单 ---------------- */

  var header = document.querySelector('.site-header');
  var navToggle = document.querySelector('.nav-toggle');

  function closeNav() {
    if (!header) return;
    header.classList.remove('nav-open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && header) {
    navToggle.addEventListener('click', function () {
      var open = header.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  document.addEventListener('click', function (event) {
    if (!header || !header.classList.contains('nav-open')) return;
    if (!header.contains(event.target)) closeNav();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeNav();
  });

  /* ---------------- 阅读进度 & 回到顶部 ---------------- */

  var progressBar = document.getElementById('reading-progress');
  var backToTop = document.querySelector('.js-back-to-top');
  var postBody = document.getElementById('post-body');

  if (progressBar && postBody) progressBar.hidden = false;

  function onScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;

    if (progressBar && postBody && !progressBar.hidden) {
      var start = postBody.offsetTop;
      var total = postBody.offsetHeight - window.innerHeight * 0.6;
      var ratio = total > 0 ? (scrollTop - start + window.innerHeight * 0.4) / total : 0;
      ratio = Math.min(1, Math.max(0, ratio));
      progressBar.style.width = (ratio * 100).toFixed(2) + '%';
    }

    if (backToTop) backToTop.hidden = scrollTop < 480;
  }

  var ticking = false;
  window.addEventListener(
    'scroll',
    function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
    },
    { passive: true }
  );
  onScroll();

  if (backToTop) {
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------------- 代码块复制 ---------------- */

  document.querySelectorAll('.code-block').forEach(function (block) {
    var code = block.querySelector('code');
    if (!code) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    block.appendChild(btn);

    btn.addEventListener('click', function () {
      var text = code.innerText;
      var done = function () {
        btn.textContent = '已复制';
        btn.classList.add('is-done');
        setTimeout(function () {
          btn.textContent = '复制';
          btn.classList.remove('is-done');
        }, 1600);
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {});
        return;
      }

      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        /* 忽略 */
      }
      document.body.removeChild(area);
    });
  });

  /* ---------------- 目录高亮 ---------------- */

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  if (tocLinks.length) {
    var headings = tocLinks
      .map(function (link) {
        return document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
      })
      .filter(Boolean);

    var setActive = function (id) {
      tocLinks.forEach(function (link) {
        link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
      });
    };

    if ('IntersectionObserver' in window && headings.length) {
      var visible = new Set();
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          });
          if (visible.size) {
            var first = headings.filter(function (h) {
              return visible.has(h);
            })[0];
            if (first) setActive(first.id);
          }
        },
        { rootMargin: '-80px 0px -70% 0px', threshold: [0, 1] }
      );
      headings.forEach(function (h) {
        observer.observe(h);
      });
    }
  }

  /* ---------------- 全站搜索 ---------------- */

  var modal = document.getElementById('search-modal');
  if (!modal) return;

  var input = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');
  var hintEl = document.getElementById('search-hint');
  var indexData = null;
  var loading = false;
  var activeIndex = -1;
  var currentItems = [];
  var lastFocused = null;

  function loadIndex() {
    if (indexData || loading) return Promise.resolve(indexData);
    loading = true;
    return fetch(BASE + 'search-index.json')
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (data) {
        indexData = Array.isArray(data) ? data : [];
        return indexData;
      })
      .catch(function () {
        indexData = [];
        return indexData;
      })
      .then(function (data) {
        loading = false;
        return data;
      });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, terms) {
    var safe = escapeHtml(text);
    terms.forEach(function (term) {
      if (!term) return;
      safe = safe.replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    });
    return safe;
  }

  function excerpt(item, terms) {
    var text = item.text || item.summary || '';
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length; i += 1) {
      pos = lower.indexOf(terms[i].toLowerCase());
      if (pos > -1) break;
    }
    if (pos < 0) return text.slice(0, 110) + (text.length > 110 ? '…' : '');
    var start = Math.max(0, pos - 40);
    return (start > 0 ? '…' : '') + text.slice(start, start + 130) + '…';
  }

  function render(query) {
    var terms = query.trim().split(/\s+/).filter(Boolean);
    activeIndex = -1;

    if (!terms.length) {
      currentItems = [];
      resultsEl.innerHTML = '';
      hintEl.textContent = '输入关键词开始搜索';
      hintEl.hidden = false;
      return;
    }

    var data = indexData || [];
    currentItems = data.filter(function (item) {
      var haystack = (item.title + ' ' + (item.tags || []).join(' ') + ' ' + (item.text || '')).toLowerCase();
      return terms.every(function (term) {
        return haystack.indexOf(term.toLowerCase()) > -1;
      });
    });

    if (!currentItems.length) {
      resultsEl.innerHTML = '';
      hintEl.textContent = '没有找到匹配「' + query.trim() + '」的文章';
      hintEl.hidden = false;
      return;
    }

    hintEl.hidden = true;
    resultsEl.innerHTML = currentItems
      .map(function (item, index) {
        return (
          '<li data-index="' + index + '"><a href="' + BASE + item.url + '">' +
          '<span class="res-title">' + highlight(item.title, terms) + '</span>' +
          '<span class="res-meta"><span>' + escapeHtml(item.date || '') + '</span>' +
          '<span>' + escapeHtml((item.tags || []).map(function (t) { return '#' + t; }).join(' ')) + '</span></span>' +
          '<span class="res-excerpt">' + highlight(excerpt(item, terms), terms) + '</span>' +
          '</a></li>'
        );
      })
      .join('');
  }

  function openSearch() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('search-open');
    loadIndex().then(function () {
      input.value = '';
      render('');
      input.focus();
    });
  }

  function closeSearch() {
    modal.hidden = true;
    document.body.classList.remove('search-open');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  document.querySelectorAll('.js-search-open').forEach(function (btn) {
    btn.addEventListener('click', openSearch);
  });
  modal.querySelector('.js-search-close').addEventListener('click', closeSearch);

  input.addEventListener('input', function () {
    render(input.value);
  });

  document.addEventListener('keydown', function (event) {
    var isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) ||
      document.activeElement.isContentEditable;

    if ((event.key === '/' || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) && !isTyping) {
      event.preventDefault();
      openSearch();
      return;
    }

    if (modal.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (!currentItems.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      var delta = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + currentItems.length) % currentItems.length;
      Array.prototype.forEach.call(resultsEl.children, function (li, i) {
        li.classList.toggle('is-active', i === activeIndex);
      });
      var active = resultsEl.children[activeIndex];
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      window.location.href = BASE + currentItems[activeIndex].url;
    }
  });

  /* 页脚年份 */
  var yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
