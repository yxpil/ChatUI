/* ===========================================================
   memory.js · 记忆系统
   1) 长期记忆库（手动 / 自动抽取），按相关度检索后注入系统提示
   2) 上下文窗口管理：裁剪 或 滚动摘要压缩
   =========================================================== */
(function (global) {
  'use strict';

  const Memory = {};

  /* ---------- 中文友好分词 ---------- */
  function tokenize(text) {
    const s = String(text || '').toLowerCase();
    const out = Object.create(null);
    const latin = s.match(/[a-z0-9_\-.+#]{2,}/g) || [];
    latin.forEach(function (w) { out[w] = 1; });
    const cjkRuns = s.match(/[\u4e00-\u9fff]+/g) || [];
    cjkRuns.forEach(function (run) {
      if (run.length === 1) { out[run] = 1; return; }
      for (let i = 0; i < run.length - 1; i++) out[run.slice(i, i + 2)] = 1;
    });
    return Object.keys(out);
  }
  Memory.tokenize = tokenize;

  /* ---------- 相关度检索 ---------- */
  Memory.retrieve = function (query, topK, maxChars) {
    const list = Store.memories || [];
    if (!list.length) return [];
    topK = topK || Store.settings.memoryTopK || 6;
    maxChars = maxChars || Store.settings.memoryMaxChars || 2000;
    const words = tokenize(query);
    const scored = list.map(function (m) {
      const c = String(m.content || '').toLowerCase();
      let score = 0;
      let hit = 0;
      for (let i = 0; i < words.length; i++) {
        if (words[i].length > 1 && c.indexOf(words[i]) >= 0) hit++;
      }
      score += Math.min(hit, 8) * 3;
      if (m.pinned) score += 2.5;
      if (m.tags && m.tags.length) {
        m.tags.forEach(function (t) {
          if (c.indexOf(String(t).toLowerCase()) >= 0) score += 0.2;
          if (query && String(query).toLowerCase().indexOf(String(t).toLowerCase()) >= 0) score += 1.5;
        });
      }
      const days = (Date.now() - (m.updatedAt || m.createdAt || 0)) / 86400000;
      score += Math.max(0, 1.2 - days / 45);
      if (m.source === 'auto') score -= 0.3;
      return { m: m, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    const picked = [];
    let chars = 0;
    const minScore = 0.5;   // 相关度过低的不注入，避免污染上下文
    for (let i = 0; i < scored.length && picked.length < topK; i++) {
      const s = scored[i];
      if (scored.length > 3 && s.score < minScore && !s.m.pinned) continue;
      if (chars + s.m.content.length > maxChars) continue;
      picked.push(s.m);
      chars += s.m.content.length;
    }
    return picked;
  };

  Memory.markUsed = function (ids) {
    if (!ids || !ids.length) return;
    let changed = false;
    Store.memories.forEach(function (m) {
      if (ids.indexOf(m.id) >= 0) { m.useCount = (m.useCount || 0) + 1; m.lastUsedAt = Date.now(); changed = true; }
    });
    if (changed) Store.saveMemories();
  };

  /* ---------- 构造系统提示 ---------- */
  Memory.buildSystemContent = function (conv, userText) {
    const parts = [];
    let base = conv && conv.systemPrompt != null && conv.systemPrompt !== '' ? conv.systemPrompt : Store.settings.systemPrompt;
    let assistant = null;
    if (conv && conv.assistantId) assistant = Store.getAssistant(conv.assistantId);
    if (assistant) {
      base = (assistant.systemPrompt || '') + (base ? '\n\n' + base : '');
      // 助手可自带记忆开关
      if (assistant.memoryEnabled === false) {
        return { content: base.trim(), memoryIds: [] };
      }
    }

    if (base && base.trim()) parts.push(base.trim());

    // 早前对话摘要
    if (conv && conv.summary) {
      parts.push('## 早前对话摘要\n' + conv.summary);
    }

    // 长期记忆
    let memoryIds = [];
    if (Store.settings.memoryEnabled) {
      const mems = Memory.retrieve(userText || '');
      if (mems.length) {
        memoryIds = mems.map(m => m.id);
        const lines = mems.map(function (m) {
          const tag = (m.tags && m.tags.length) ? '（' + m.tags.join('/') + '）' : '';
          return '- ' + m.content.replace(/\n/g, ' ').trim() + tag;
        });
        parts.push(
          '## 关于用户的长期记忆\n' +
          '以下是与用户相关的已知信息，请在合适的时候自然运用，不要生硬复述，也不要声称"我记住了"：\n' +
          lines.join('\n')
        );
      }
    }
    if (!parts.length) return { content: '', memoryIds: memoryIds };
    return { content: parts.join('\n\n'), memoryIds: memoryIds };
  };

  /* ---------- 上下文窗口管理 ---------- */
  /**
   * 组装最终发送给模型的消息数组
   * @returns {{messages:Array, trimmed:number, summaryUsed:boolean, estTokens:number}}
   */
  Memory.buildContext = function (conv, userText) {
    const visible = (conv.messages || []).filter(m => !m.hidden);
    const sys = Memory.buildSystemContent(conv, userText);
    const budget = (Store.settings.maxContextTokens || 32000) * 0.85;

    const out = [];
    if (sys.content) out.push({ role: 'system', content: sys.content });

    const sysTokens = U.estimateTokens(sys.content);
    let used = sysTokens;

    const covered = Math.max(0, Math.min(conv.summaryCovers || 0, visible.length));
    const body = visible.slice(covered);

    // 先整体试算
    let total = used;
    body.forEach(function (m) {
      total += U.estimateTokens(m.content || '') + 6;
      if (m.images) total += m.images.length * 260;
    });

    let trimmed = 0;
    let start = 0;
    if (total > budget) {
      // 从最早的消息开始丢弃，保留最近内容
      let remain = budget;
      for (let i = body.length - 1; i >= 0; i--) {
        const m = body[i];
        const t = U.estimateTokens(m.content || '') + 6 + (m.images ? m.images.length * 260 : 0);
        if (remain - t < 0 && i < body.length - 1) { start = i + 1; break; }
        remain -= t;
        start = i;
      }
      trimmed = start;
    }

    body.slice(start).forEach(function (m) {
      out.push(m);
    });

    let estTokens = U.estimateTokens(sys.content);
    out.forEach(function (m, i) {
      if (i === 0 && m.role === 'system') return;
      estTokens += U.estimateTokens(m.content || '') + 6;
    });

    return {
      messages: API.toOpenAIMessages(out),
      rawMessages: out,
      systemContent: sys.content,
      memoryIds: sys.memoryIds,
      trimmed: trimmed,
      summaryUsed: covered > 0 || !!conv.summary,
      estTokens: estTokens
    };
  };

  /* ---------- 滚动摘要压缩 ---------- */
  Memory.summarize = async function (conv, provider, model, opts) {
    opts = opts || {};
    const visible = (conv.messages || []).filter(m => !m.hidden);
    const keepTail = opts.keepTail || 8;
    const covered = Math.max(0, Math.min(conv.summaryCovers || 0, visible.length));
    const end = Math.max(covered, visible.length - keepTail);
    if (end <= covered) throw new Error('当前对话还不够长，无需压缩');

    const chunk = visible.slice(covered, end);
    const text = chunk.map(function (m) {
      const who = m.role === 'user' ? '用户' : (m.role === 'assistant' ? '助手' : m.role);
      return who + '：' + String(m.content || '').replace(/\n{2,}/g, '\n').slice(0, 2000);
    }).join('\n\n');

    const prev = conv.summary ? '已有摘要：\n' + conv.summary + '\n\n' : '';
    const r = await API.chatOnce({
      provider: provider, model: model, temperature: 0.2, maxTokens: 700, timeoutMs: 60000,
      messages: [
        {
          role: 'system',
          content: '你是对话摘要器。把下面的对话压缩成一段结构化中文摘要，保留：用户的目标与需求、已达成的结论与决定、关键事实与偏好、进行中的待办、重要的代码/文件名/参数。不要评论，不要遗漏结论。控制在 400 字以内。'
        },
        { role: 'user', content: prev + '待压缩的对话片段：\n\n' + text }
      ]
    });
    const summary = (r.content || '').trim();
    if (!summary) throw new Error('摘要生成失败');
    conv.summary = (conv.summary ? conv.summary + '\n\n【后续补充】\n' : '') + summary;
    conv.summaryCovers = end;
    conv.updatedAt = Date.now();
    Store.saveConversation(conv);
    return { summary: conv.summary, covers: end, count: chunk.length };
  };

  /* ---------- 自动记忆抽取 ---------- */
  const EXTRACT_PROMPT =
    '你是一个记忆抽取器。阅读下面的对话，抽取出「值得长期记住的、关于用户本身的稳定信息」，例如：' +
    '用户的身份/职业/技术栈、长期偏好、项目背景、明确要求过的输出风格、重要的个人事实。\n' +
    '要求：\n' +
    '1. 只抽取稳定、可复用的事实，不要抽取一次性的任务内容或对话过程。\n' +
    '2. 每条不超过 60 字，用第三人称陈述（"用户……"）。\n' +
    '3. 最多 3 条；如果没有任何值得记录的内容，返回空数组。\n' +
    '4. 只输出 JSON 数组，例如：["用户是前端工程师，主要写 React", "用户偏好中文回答"]. 不要输出其他任何文字。';

  Memory.autoExtract = async function (conv, provider, model, force) {
    const visible = (conv.messages || []).filter(m => !m.hidden);
    const lastAt = conv.lastExtractCount || 0;
    if (!force && visible.length - lastAt < 4) return [];
    const totalMessages = visible.filter(m => m.role === 'user').length;
    if (!force && totalMessages < 2) return [];

    const chunk = visible.slice(Math.max(0, visible.length - 12));
    const text = chunk.map(function (m) {
      const who = m.role === 'user' ? '用户' : (m.role === 'assistant' ? '助手' : m.role);
      return who + '：' + String(m.content || '').slice(0, 1200);
    }).join('\n');

    const r = await API.chatOnce({
      provider: provider, model: model, temperature: 0.1, maxTokens: 300, timeoutMs: 45000,
      messages: [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content: text }]
    });

    let arr = U.parseJSONLoose(r.content);
    if (!arr) return [];
    if (!Array.isArray(arr)) {
      if (arr && Array.isArray(arr.memories)) arr = arr.memories;
      else if (arr && Array.isArray(arr.facts)) arr = arr.facts;
      else if (typeof arr === 'string') arr = [arr];
      else return [];
    }
    const added = [];
    arr.slice(0, 3).forEach(function (item) {
      const content = typeof item === 'string' ? item : (item && (item.content || item.text || item.fact)) || '';
      const tags = (item && Array.isArray(item.tags)) ? item.tags : [];
      const m = Store.addMemory(content, 'auto', tags);
      if (m) added.push(m);
    });
    conv.lastExtractCount = visible.length;
    Store.saveConversation(conv);
    return added;
  };

  /* =========================================================
     导入 / 导出
     ========================================================= */

  function sortForExport(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /** Markdown：人类可读，且可再次导入 */
  Memory.toMarkdown = function (list) {
    const items = sortForExport(list);
    const lines = [];
    lines.push('# ChatUI 长期记忆');
    lines.push('');
    lines.push('> 导出时间：' + U.formatDateTime(Date.now()));
    lines.push('> 记忆条数：' + items.length);
    lines.push('> 说明：本文件可直接在 ChatUI「记忆 → 导入记忆」中重新导入，也可粘贴到任何笔记软件。');
    lines.push('');
    lines.push('---');
    lines.push('');
    items.forEach(function (m) {
      const tags = (m.tags || []).map(function (t) { return '#' + String(t).replace(/\s+/g, '-'); }).join(' ');
      lines.push('- ' + (m.pinned ? '★ ' : '') + String(m.content || '').replace(/\n+/g, ' ').trim() + (tags ? ' ' + tags : ''));
    });
    lines.push('');
    return lines.join('\n');
  };

  /** 纯文本：每行一条，最适合复制粘贴到别处 */
  Memory.toText = function (list) {
    return sortForExport(list).map(function (m) {
      const tags = (m.tags || []).map(function (t) { return '#' + String(t).replace(/\s+/g, '-'); }).join(' ');
      return (m.pinned ? '★ ' : '') + String(m.content || '').replace(/\n+/g, ' ').trim() + (tags ? ' ' + tags : '');
    }).join('\n') + '\n';
  };

  /** CSV：带 BOM，Excel / WPS 直接打开不乱码 */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  Memory.toCSV = function (list) {
    const items = sortForExport(list);
    const rows = [['内容', '标签', '来源', '置顶', '创建时间', '使用次数', '最后引用时间']];
    items.forEach(function (m) {
      rows.push([
        m.content || '',
        (m.tags || []).join('|'),
        m.source === 'auto' ? '自动提取' : '手动添加',
        m.pinned ? '是' : '否',
        U.formatDateTime(m.createdAt || Date.now()),
        m.useCount || 0,
        m.lastUsedAt ? U.formatDateTime(m.lastUsedAt) : ''
      ]);
    });
    return '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  };

  /** JSON：完整字段，可无损还原（含置顶 / 标签 / 来源） */
  Memory.toJSON = function (list) {
    const items = sortForExport(list);
    return JSON.stringify({
      app: 'ChatUI', type: 'memories', version: 1,
      exportedAt: Date.now(), count: items.length,
      memories: items.map(function (m) {
        return {
          content: m.content, tags: m.tags || [], pinned: !!m.pinned,
          source: m.source || 'manual',
          createdAt: m.createdAt || Date.now(), updatedAt: m.updatedAt || m.createdAt || Date.now()
        };
      })
    }, null, 2);
  };

  const FORMATS = {
    json: { ext: 'json', mime: 'application/json;charset=utf-8', build: Memory.toJSON, label: 'JSON（可完整还原）' },
    md: { ext: 'md', mime: 'text/markdown;charset=utf-8', build: Memory.toMarkdown, label: 'Markdown（可读，可再导入）' },
    txt: { ext: 'txt', mime: 'text/plain;charset=utf-8', build: Memory.toText, label: '纯文本（每行一条）' },
    csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', build: Memory.toCSV, label: 'CSV（Excel 可直接打开）' }
  };

  /**
   * 生成导出内容
   * @returns {{filename:string, content:string, mime:string, count:number, format:string}}
   */
  Memory.exportAs = function (format, list) {
    format = FORMATS[format] ? format : 'json';
    const items = sortForExport(list || Store.listMemories());
    const f = FORMATS[format];
    return {
      format: format,
      filename: 'chatui-memories-' + stamp() + '.' + f.ext,
      content: f.build(items),
      mime: f.mime,
      count: items.length
    };
  };

  Memory.formats = function () {
    return Object.keys(FORMATS).map(function (k) {
      return { key: k, label: FORMATS[k].label, ext: FORMATS[k].ext };
    });
  };

  /* ---------- 导入解析 ---------- */
  function cleanContent(s) {
    return String(s == null ? '' : s)
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*(?:★|⭐|📌)\s*/, '')
      .replace(/^\*\*(.*?)\*\*$/, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractTags(s) {
    const tags = [];
    const rest = String(s).replace(/(?:^|\s)#([a-zA-Z\u4e00-\u9fff][\w\u4e00-\u9fff\-]{0,15})/g, function (m, t) {
      tags.push(t);
      return ' ';
    });
    return { text: rest, tags: tags };
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.replace(/^\ufeff/, '').trim(); }); });
  }

  /**
   * 解析导入文件，返回待写入的记忆数组
   * 支持：ChatUI 记忆 JSON / 全量备份 JSON / Markdown / 纯文本（每行一条）/ CSV
   */
  Memory.parseImport = function (text, filename) {
    const raw = String(text == null ? '' : text).replace(/^\ufeff/, '');
    const t = raw.trim();
    const out = [];
    if (!t) return out;
    const name = String(filename || '');
    const looksJSON = /\.json$/i.test(name) || t.charAt(0) === '{' || t.charAt(0) === '[';

    if (looksJSON) {
      const data = U.parseJSONLoose(t);
      if (data) {
        let arr = data;
        if (!Array.isArray(arr)) arr = arr.memories || arr.data || arr.items || arr.list || [];
        if (Array.isArray(arr)) {
          arr.forEach(function (it) {
            if (typeof it === 'string') {
              const c = cleanContent(it);
              if (c) out.push({ content: c, tags: [] });
              return;
            }
            if (!it || typeof it !== 'object') return;
            const c = cleanContent(it.content || it.text || it.memory || it.fact || it.value || '');
            if (!c) return;
            let tags = it.tags;
            if (typeof tags === 'string') tags = tags.split(/[|,，、]/);
            if (!Array.isArray(tags)) tags = [];
            out.push({
              content: c,
              tags: tags.map(x => String(x).trim()).filter(Boolean),
              pinned: !!it.pinned,
              source: it.source === 'auto' ? 'auto' : 'manual',
              createdAt: typeof it.createdAt === 'number' ? it.createdAt : undefined
            });
          });
          return out;
        }
      }
      // JSON 解析失败时继续按文本处理
    }

    if (/\.csv$/i.test(name)) {
      const rows = parseCSVRows(raw);
      let start = 0;
      if (rows.length && /内容|content|记忆/i.test(rows[0][0] || '')) start = 1;
      for (let i = start; i < rows.length; i++) {
        const r = rows[i];
        const c = cleanContent(r[0] || '');
        if (!c) continue;
        const tags = (r[1] || '').split(/[|,，、\/]/).map(x => x.trim()).filter(Boolean);
        out.push({ content: c, tags: tags, pinned: /^(是|true|yes|1)$/i.test(r[3] || '') });
      }
      return out;
    }

    // Markdown / 纯文本：逐行（跳过标题、引用、分隔线、代码块）
    let inFence = false;
    raw.split(/\r?\n/).forEach(function (line) {
      let s = line.trim();
      if (/^(`{3,}|~{3,})/.test(s)) { inFence = !inFence; return; }
      if (inFence) return;
      if (!s) return;
      if (/^#{1,6}\s/.test(s)) return;                 // 标题
      if (/^[-*_=]{3,}$/.test(s)) return;              // 分隔线
      if (/^[>|]/.test(s)) return;                     // 引用行 / 表格行
      if (/^(导出时间|记忆条数|说明)[:：]/.test(s)) return;
      if (/^(-\s*)?(导出时间|记忆条数|说明)[:：]/.test(s)) return;
      s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      const pinned = /^(★|⭐|📌)\s*/.test(s);
      const ex = extractTags(cleanContent(s));
      const c = cleanContent(ex.text);
      if (c.length < 2) return;
      out.push({ content: c, tags: ex.tags, pinned: pinned });
    });
    return out;
  };

  /**
   * 从文本导入记忆（自动去重）
   * @returns {{added:number, skipped:number, parsed:number, items:Array}}
   */
  Memory.importFromText = function (text, filename, opts) {
    opts = opts || {};
    const parsed = Memory.parseImport(text, filename);
    const exist = Object.create(null);
    (Store.memories || []).forEach(function (m) {
      exist[String(m.content || '').trim().toLowerCase()] = 1;
    });
    let added = 0, skipped = 0;
    const items = [];
    parsed.forEach(function (p) {
      const key = p.content.trim().toLowerCase();
      if (!key || exist[key]) { skipped++; return; }
      const m = Store.addMemory(p.content, p.source || 'manual', p.tags || []);
      if (!m) { skipped++; return; }
      if (p.pinned) Store.updateMemory(m.id, { pinned: true });
      if (p.createdAt) Store.updateMemory(m.id, { createdAt: p.createdAt });
      exist[key] = 1;
      added++;
      items.push(m);
    });
    return { added: added, skipped: skipped, parsed: parsed.length, items: items };
  };

  Memory.stats = function () {
    const list = Store.memories || [];
    let chars = 0, auto = 0, pinned = 0, used = 0;
    list.forEach(function (m) {
      chars += (m.content || '').length;
      if (m.source === 'auto') auto++;
      if (m.pinned) pinned++;
      if ((m.useCount || 0) > 0) used++;
    });
    return { count: list.length, chars: chars, auto: auto, manual: list.length - auto, pinned: pinned, used: used };
  };

  global.Memory = Memory;
})(window);
