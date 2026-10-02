/* ===========================================================
   util.js · 通用工具函数（全局挂载到 window.U）
   =========================================================== */
(function (global) {
  'use strict';

  const U = {};

  /* ---------- DOM ---------- */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  U.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'data' && typeof v === 'object') { for (const d in v) n.dataset[d] = v[d]; }
        else n.setAttribute(k, v);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  };

  /* ---------- 图标 ----------
     全部图标以 SVG 雪碧图（index.html 中的 <symbol id="i-xxx">）形式提供，
     界面里不再出现 emoji，保证跨平台字形一致、可随主题换色。 */
  U.icon = function (name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls || 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  };

  /* 状态图标：成功 / 失败 / 警告 / 提示 */
  U.statusIcon = function (type) {
    const map = { ok: 'i-check-circle', err: 'i-alert', warn: 'i-alert', info: 'i-info' };
    return map[type] ? U.icon(map[type]) : null;
  };

  /** 内联图标 + 文案的一行提示 */
  U.iconLine = function (iconName, text, cls) {
    const n = U.el('span', { class: cls || 'icon-line' }, [U.icon(iconName)]);
    n.appendChild(U.el('span', { text: text }));
    return n;
  };

  /* ---------- 基础 ---------- */
  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.escapeRegExp = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  U.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  U.deepClone = function (o) {
    try { return structuredClone(o); } catch (e) { return JSON.parse(JSON.stringify(o)); }
  };

  U.sleep = function (ms) { return new Promise(r => setTimeout(r, ms)); };

  U.debounce = function (fn, wait) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), wait);
    };
  };

  U.throttle = function (fn, wait) {
    let last = 0, timer = null, lastArgs = null;
    return function () {
      const now = Date.now(), remain = wait - (now - last);
      lastArgs = arguments;
      const self = this;
      if (remain <= 0) { last = now; fn.apply(self, lastArgs); }
      else if (!timer) {
        timer = setTimeout(function () { last = Date.now(); timer = null; fn.apply(self, lastArgs); }, remain);
      }
    };
  };

  /* ---------- 时间 / 数字 ---------- */
  U.formatTime = function (ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  };

  U.formatDateTime = function (ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  U.relativeTime = function (ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return U.formatDateTime(ts).slice(0, 10);
  };

  /**
   * 粗略估算 token 数：中日韩字符约 1.5 字/token，拉丁文本约 4 字符/token
   */
  U.estimateTokens = function (text) {
    if (!text) return 0;
    const s = String(text);
    let cjk = 0, other = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) cjk++;
      else other++;
    }
    return Math.ceil(cjk / 1.5 + other / 4);
  };

  U.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  /* ---------- 剪贴板 ---------- */
  U.copy = async function (text) {
    text = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && global.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('no clipboard api');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        U.toast('复制失败，请手动选择文本复制', 'err');
        return false;
      }
    }
  };

  /* ---------- 提示 ---------- */
  U.toast = function (msg, type, ms) {
    const wrap = U.$('#toastWrap');
    if (!wrap) return;
    const t = U.el('div', { class: 'toast' + (type ? ' ' + type : '') });
    const ic = U.statusIcon(type);
    if (ic) t.appendChild(ic);
    t.appendChild(U.el('span', { class: 'toast-msg', text: msg }));
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 260);
    }, ms || 1900);
  };

  /* ---------- 文件 ---------- */
  U.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 400);
  };

  U.readAsText = function (file) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsText(file, 'utf-8');
    });
  };

  U.readAsDataURL = function (file) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  };

  /** 图片压缩，避免 localStorage 爆容量 */
  U.compressImage = function (file, maxSide, quality) {
    maxSide = maxSide || 1280;
    quality = quality || 0.82;
    return U.readAsDataURL(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () {
          let w = img.naturalWidth, h = img.naturalHeight;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          if (scale === 1 && dataUrl.length < 300000) return resolve({ dataUrl: dataUrl, w: w, h: h });
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve({ dataUrl: cv.toDataURL('image/jpeg', quality), w: w, h: h }); }
          catch (e) { resolve({ dataUrl: dataUrl, w: img.naturalWidth, h: img.naturalHeight }); }
        };
        img.onerror = function () { resolve({ dataUrl: dataUrl, w: 0, h: 0 }); };
        img.src = dataUrl;
      });
    });
  };

  /* ---------- 事件总线 ---------- */
  U.bus = (function () {
    const map = {};
    return {
      on: function (evt, fn) { (map[evt] = map[evt] || []).push(fn); return () => this.off(evt, fn); },
      off: function (evt, fn) { map[evt] = (map[evt] || []).filter(f => f !== fn); },
      emit: function (evt, data) { (map[evt] || []).slice().forEach(f => { try { f(data); } catch (e) { console.error(e); } }); }
    };
  })();

  /* ---------- 解析 AI 返回的 JSON（容错） ---------- */
  U.parseJSONLoose = function (text) {
    if (!text) return null;
    let s = String(text).trim();
    // 去掉 ```json ... ``` 包裹
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* continue */ }
    // 提取第一个 { ... } 或 [ ... ]
    const start = s.search(/[[{]/);
    if (start >= 0) {
      const open = s[start], close = open === '{' ? '}' : ']';
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === open) depth++;
          else if (c === close) {
            depth--;
            if (depth === 0) {
              try { return JSON.parse(s.slice(start, i + 1)); } catch (e2) { return null; }
            }
          }
        }
      }
    }
    return null;
  };

  global.U = U;
})(window);
