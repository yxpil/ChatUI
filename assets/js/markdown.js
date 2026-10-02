/* ===========================================================
   markdown.js · Markdown / README 渲染 + 代码高亮 + 一键复制
   =========================================================== */
(function (global) {
  'use strict';

  const MD = {};

  const hasMarked = typeof marked !== 'undefined';
  const hasPurify = typeof DOMPurify !== 'undefined';
  const hasHljs = typeof hljs !== 'undefined';
  const hasKatex = typeof katex !== 'undefined';

  if (hasMarked) {
    marked.setOptions({ gfm: true, breaks: true, pedantic: false, smartLists: true, silent: true });
  }
  if (hasHljs) {
    try { hljs.configure({ ignoreUnescapedHTML: true, throwOnError: false }); } catch (e) { }
  }

  const PURIFY_CFG = {
    ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled', 'data-lang'],
    ADD_TAGS: ['details', 'summary', 'kbd', 'mark'],
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick']
  };

  const LANG_ALIAS = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby', sh: 'bash',
    shell: 'bash', zsh: 'bash', yml: 'yaml', md: 'markdown', htm: 'html',
    'c++': 'cpp', cs: 'csharp', kt: 'kotlin', rs: 'rust', golang: 'go',
    dockerfile: 'dockerfile', text: 'plaintext', txt: 'plaintext'
  };

  const EXT_MAP = {
    javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh',
    json: 'json', html: 'html', css: 'css', scss: 'scss', xml: 'xml', yaml: 'yml',
    markdown: 'md', java: 'java', cpp: 'cpp', c: 'c', csharp: 'cs', go: 'go',
    rust: 'rs', php: 'php', ruby: 'rb', kotlin: 'kt', swift: 'swift', sql: 'sql',
    plaintext: 'txt', diff: 'diff', ini: 'ini', toml: 'toml', dockerfile: 'dockerfile'
  };

  function normalizeLang(raw) {
    let l = String(raw || '').trim().split(/[\s:]/)[0].toLowerCase();
    if (l.charAt(0) === '{') l = l.slice(1);
    if (l === '') return '';
    return LANG_ALIAS[l] || l;
  }

  /* ---------- 渲染 ---------- */
  MD.render = function (text) {
    const src = String(text == null ? '' : text);
    if (!src) return '';
    let html;
    if (hasMarked) {
      try { html = marked.parse(src); }
      catch (e) { html = '<p>' + U.escapeHtml(src).replace(/\n/g, '<br>') + '</p>'; }
    } else {
      html = '<p>' + U.escapeHtml(src).replace(/\n/g, '<br>') + '</p>';
    }
    if (hasPurify) {
      try { html = DOMPurify.sanitize(html, PURIFY_CFG); } catch (e) { }
    }
    return html;
  };

  /**
   * 渲染到容器并做增强（代码高亮、复制按钮、表格包裹、公式）
   * @param {HTMLElement} root
   * @param {string} text markdown 源码
   * @param {object} opts { streaming:boolean, enhance:boolean }
   */
  MD.renderTo = function (root, text, opts) {
    opts = opts || {};
    root.innerHTML = MD.render(text);
    if (opts.enhance !== false) MD.enhance(root, opts);
    return root;
  };

  /* ---------- 增强 ---------- */
  MD.enhance = function (root, opts) {
    opts = opts || {};
    const streaming = !!opts.streaming;
    // 链接
    U.$$('a[href]', root).forEach(function (a) {
      const href = a.getAttribute('href') || '';
      if (/^javascript:/i.test(href)) { a.removeAttribute('href'); return; }
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
    // 表格包裹
    U.$$('table', root).forEach(function (t) {
      if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('table-wrap')) return;
      const w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
    // 代码块
    const codeBlocks = U.$$('pre > code', root);
    const totalLen = (root.textContent || '').length;
    const skipHighlight = streaming && totalLen > 40000;
    codeBlocks.forEach(function (code, idx) {
      const isLast = idx === codeBlocks.length - 1;
      const pre = code.parentNode;
      if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('code-block')) {
        // 已处理过
        if (!skipHighlight && !code.dataset.hl) {
          try { MD.highlight(code); } catch (e) { }
        }
        return;
      }
      let lang = '';
      const cls = code.className || '';
      const m = cls.match(/language-([\w+#-]+)/);
      if (m) lang = normalizeLang(m[1]);
      if (!lang) {
        const dm = cls.match(/lang-([\w+#-]+)/);
        if (dm) lang = normalizeLang(dm[1]);
      }
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      wrap.dataset.lang = lang || 'text';

      const head = document.createElement('div');
      head.className = 'code-head';

      const langEl = document.createElement('span');
      langEl.className = 'lang';
      langEl.textContent = lang || 'text';
      head.appendChild(langEl);

      const lineCount = (code.textContent || '').split('\n').length;
      const lineEl = document.createElement('span');
      lineEl.className = 'lines';
      lineEl.textContent = lineCount + ' 行';
      head.appendChild(lineEl);

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      head.appendChild(spacer);

      const btnCopy = document.createElement('button');
      btnCopy.className = 'cbtn';
      btnCopy.type = 'button';
      btnCopy.innerHTML = '<svg class="ic"><use href="#i-copy"/></svg><span>复制</span>';
      btnCopy.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const raw = code.textContent || '';
        U.copy(raw).then(function (ok) {
          if (!ok) return;
          btnCopy.classList.add('copied');
          btnCopy.innerHTML = '<svg class="ic"><use href="#i-check"/></svg><span>已复制</span>';
          setTimeout(function () {
            btnCopy.innerHTML = '<svg class="ic"><use href="#i-copy"/></svg><span>复制</span>';
          }, 1600);
        });
      });
      head.appendChild(btnCopy);

      const btnDl = document.createElement('button');
      btnDl.className = 'cbtn';
      btnDl.type = 'button';
      btnDl.title = '下载代码文件';
      btnDl.innerHTML = '<svg class="ic"><use href="#i-download"/></svg>';
      btnDl.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const ext = EXT_MAP[lang] || 'txt';
        const body = code.textContent || '';
        U.download('code-' + Date.now() + '.' + ext, body, 'text/plain;charset=utf-8');
      });
      head.appendChild(btnDl);

      if (lineCount > 28) {
        const btnFold = document.createElement('button');
        btnFold.className = 'cbtn';
        btnFold.type = 'button';
        btnFold.innerHTML = '<span>展开</span>';
        btnFold.addEventListener('click', function (ev) {
          ev.stopPropagation();
          const closed = wrap.classList.toggle('collapsed');
          btnFold.firstChild.textContent = closed ? '展开' : '收起';
        });
        head.appendChild(btnFold);
        if (!streaming || !isLast) wrap.classList.add('collapsed');
      }

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head);
      wrap.appendChild(pre);

      if (!skipHighlight) {
        try { MD.highlight(code, lang); } catch (e) { }
      }
    });

    // 行内公式（$...$ 自定义处理，避免把金额识别成公式）
    if (hasKatex) {
      try {
        if (typeof renderMathInElement === 'function') {
          renderMathInElement(root, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false }
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
            throwOnError: false,
            errorColor: '#cc0000'
          });
        }
        MD.renderDollarMath(root);
      } catch (e) { }
    }
  };

  MD.highlight = function (codeEl, lang) {
    if (!hasHljs) return;
    if (codeEl.dataset.hl === '1') return;
    const raw = codeEl.textContent || '';
    try {
      if (lang && hljs.getLanguage(lang)) {
        codeEl.innerHTML = hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value;
      } else if (!lang && raw.length < 20000) {
        const r = hljs.highlightAuto(raw);
        if (r.relevance > 6) codeEl.innerHTML = r.value;
      }
      codeEl.dataset.hl = '1';
    } catch (e) { }
  };

  /** 只渲染形如数学公式的 $...$，跳过货币/普通文本 */
  MD.renderDollarMath = function (root) {
    if (!hasKatex) return;
    const SKIP = { CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, SVG: 1 };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (p.classList && p.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
        return (node.nodeValue && node.nodeValue.indexOf('$') >= 0) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const re = /\$([^$\n]{1,300}?)\$/g;
    nodes.forEach(function (node) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m, changed = false;
      while ((m = re.exec(text))) {
        if (!MD.looksLikeMath(m[1])) continue;
        changed = true;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        try {
          katex.render(m[1], span, { throwOnError: false, displayMode: false });
          frag.appendChild(span);
        } catch (e) {
          frag.appendChild(document.createTextNode(m[0]));
        }
        last = m.index + m[0].length;
      }
      if (!changed) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  };

  MD.looksLikeMath = function (s) {
    if (!s) return false;
    if (/[\u4e00-\u9fff\u3000-\u303f]/.test(s)) return false;          // 含中文 → 不是公式
    if (!/[a-zA-Z0-9\\]/.test(s)) return false;
    if (/^\s*\d[\d,.]*\s*$/.test(s)) return false;                      // 纯数字
    return /\\[a-zA-Z]+|[\^_{}]|=|<|>|\\frac|\\sum|\\int|\\sqrt|\\lim|\\alpha|\\beta|\\pi|\\times|\\cdot/.test(s);
  };

  /** 纯文本渲染（用于用户消息等不需要 markdown 的场景） */
  MD.plainToHtml = function (text) {
    return U.escapeHtml(text).replace(/\n/g, '<br>');
  };

  global.MD = MD;
})(window);
