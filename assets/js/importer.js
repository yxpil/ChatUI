/* ===========================================================
   importer.js · 导入解析引擎
   -----------------------------------------------------------
   支持把外部数据解析成 ChatUI 能落库的结构：
     · ChatUI 单条对话 JSON（自己导出的那种）
     · ChatUI 全量备份 JSON（对话 + 记忆 + 助手 + 设置）
     · ChatGPT 官方导出 conversations.json（mapping 树）
     · Claude 官方导出 conversations.json（chat_messages）
     · 通用 OpenAI messages 数组 / {messages:[...]} / 多对话数组
     · 记忆文件（本应用导出的 JSON / MD / TXT / CSV 列表）
     · Markdown / 纯文本对话记录（含本应用导出的格式）
   全部解析成：
     { kind, label, conversations:[{title,messages:[{role,content,reasoning,createdAt}]}],
       memories:[...], backup:{...}|null, warnings:[...] }
   =========================================================== */
(function (global) {
  'use strict';

  const Imp = {};

  const SRC = {
    chatui: 'ChatUI 对话',
    backup: 'ChatUI 全量备份',
    chatgpt: 'ChatGPT 导出',
    claude: 'Claude 导出',
    openai: 'OpenAI 消息数组',
    conv: '通用对话 JSON',
    memory: '记忆文件',
    markdown: 'Markdown 对话',
    text: '纯文本',
    unknown: '未知格式'
  };
  Imp.SRC = SRC;

  /* =========================================================
     一、通用文本归一
     ========================================================= */
  const ROLE_MAP = {
    'assistant': 'assistant', 'ai': 'assistant', 'ai assistant': 'assistant', 'bot': 'assistant',
    'model': 'assistant', 'gpt': 'assistant', 'chatgpt': 'assistant', 'claude': 'assistant',
    'gemini': 'assistant', 'deepseek': 'assistant', 'kimi': 'assistant', 'copilot': 'assistant',
    '助手': 'assistant', '回答': 'assistant', '模型': 'assistant', '机器人': 'assistant',
    'user': 'user', 'human': 'user', 'me': 'user', 'you': 'user', 'q': 'user', 'client': 'user',
    '用户': 'user', '我': 'user', '提问': 'user', '人类': 'user', '问': 'user',
    'system': 'system', 'developer': 'system', '系统': 'system',
    'tool': 'tool', 'function': 'tool', '工具': 'tool'
  };

  function normRole(r) {
    if (r == null) return '';
    const k = String(r).trim().toLowerCase().replace(/\s+/g, ' ');
    if (ROLE_MAP[k]) return ROLE_MAP[k];
    if (/^(human|user|client|我|用户|提问)/.test(k)) return 'user';
    if (/^(assistant|ai|bot|助手|模型|gpt|claude|deepseek|kimi|gemini|chatgpt)/.test(k)) return 'assistant';
    if (/^(system|系统|developer)/.test(k)) return 'system';
    if (/^(tool|function|工具)/.test(k)) return 'tool';
    return '';
  }
  Imp.normRole = normRole;

  /** 把各种各样的 content 结构压成纯文本 */
  function toText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('\n');
    if (typeof v === 'object') {
      if (v.content_type && /image|asset|audio|video/i.test(v.content_type)) return '[图片]';
      if (typeof v.text === 'string') return v.text;
      if (typeof v.text === 'number') return String(v.text);
      if (Array.isArray(v.parts)) return v.parts.map(toText).filter(Boolean).join('\n');
      if (typeof v.content === 'string') return v.content;
      if (Array.isArray(v.content)) return v.content.map(toText).filter(Boolean).join('\n');
      if (v.type === 'image_url' || v.type === 'image' || v.image_url) return '[图片]';
      if (typeof v.value === 'string') return v.value;
    }
    return '';
  }
  Imp.toText = toText;

  /** 时间戳归一：秒 / 毫秒 / ISO 字符串 → 毫秒 */
  function normTs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') {
      if (!isFinite(v) || v <= 0) return 0;
      if (v < 1e11) return Math.round(v * 1000);   // 秒
      return Math.round(v);
    }
    if (typeof v === 'string') {
      if (/^\d+$/.test(v.trim())) return normTs(parseInt(v, 10));
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }

  /** 单条消息归一 */
  function normMsg(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let roleRaw = '';
    if (raw.role != null) roleRaw = raw.role;
    else if (raw.sender != null) roleRaw = raw.sender;
    else if (raw.author != null) roleRaw = (typeof raw.author === 'object' ? raw.author.role : raw.author);
    else if (raw.from != null) roleRaw = raw.from;
    else if (raw.who != null) roleRaw = raw.who;
    else if (raw.is_user === true) roleRaw = 'user';
    else if (raw.is_bot === true || raw.isBot === true) roleRaw = 'assistant';

    const role = normRole(roleRaw);
    if (!role || role === 'tool') return null;   // 工具调用中间态不进入对话

    const content = toText(raw.content != null ? raw.content
      : raw.text != null ? raw.text
        : raw.message != null ? raw.message : '').trim();
    const reasoning = toText(raw.reasoning_content || raw.reasoning || raw.thinking || raw.reasoningText || '').trim();
    if (!content && !reasoning) return null;

    return {
      role: role,
      content: content,
      reasoning: reasoning,
      createdAt: normTs(raw.createdAt || raw.created_at || raw.created || raw.create_time || raw.timestamp || raw.time || raw.date || 0)
    };
  }
  Imp.normMsg = normMsg;

  function baseName(filename) {
    const s = String(filename || '').split(/[\\/]/).pop() || '';
    return s.replace(/\.[a-z0-9]{1,6}$/i, '');
  }

  function trimTitle(t) {
    return String(t || '').replace(/^#+\s*/, '').replace(/[\r\n]+/g, ' ').trim();
  }

  /* =========================================================
     二、JSON 解析
     ========================================================= */
  function tryJSON(s) {
    if (typeof s !== 'string') return s;
    const t = s.trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch (e) { }
    if (U && U.parseJSONLoose) {
      const v = U.parseJSONLoose(t);
      if (v != null) return v;
    }
    return null;
  }

  function convFromChatUI(c) {
    if (!c || typeof c !== 'object') return null;
    const msgs = (c.messages || []).map(normMsg).filter(Boolean);
    return {
      title: trimTitle(c.title), model: c.model || '', providerId: c.providerId || '',
      createdAt: normTs(c.createdAt), updatedAt: normTs(c.updatedAt),
      messages: msgs, source: SRC.chatui
    };
  }

  function convFromGeneric(c) {
    if (!c || typeof c !== 'object') return null;
    const rawMsgs = c.messages || c.chat || c.log || c.entries || c.turns || [];
    const msgs = (Array.isArray(rawMsgs) ? rawMsgs : []).map(normMsg).filter(Boolean);
    if (!msgs.length) return null;
    return {
      title: trimTitle(c.title || c.name || c.subject || c.topic || ''),
      model: c.model || c.model_name || '',
      createdAt: normTs(c.createdAt || c.created_at || c.create_time || c.created || 0),
      updatedAt: normTs(c.updatedAt || c.updated_at || 0),
      messages: msgs, source: SRC.conv
    };
  }

  /** ChatGPT 官方导出：mapping 树 → 线性对话 */
  function parseChatGPT(arr) {
    const out = [];
    arr.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      const mapping = c.mapping || {};
      const chain = [];
      if (c.current_node && mapping[c.current_node]) {
        let id = c.current_node, guard = 0;
        while (id && mapping[id] && guard++ < 20000) { chain.push(mapping[id]); id = mapping[id].parent; }
        chain.reverse();
      } else {
        chain.push.apply(chain, Object.keys(mapping).map(k => mapping[k])
          .filter(n => n && n.message)
          .sort((a, b) => ((a.message.create_time || 0) - (b.message.create_time || 0))));
      }
      const msgs = [];
      chain.forEach(function (node) {
        const m = node && node.message;
        if (!m || !m.author) return;
        const meta = m.metadata || {};
        if (meta.is_visually_hidden_from_conversation) return;
        if (m.recipient && m.recipient !== 'all' && m.author.role === 'assistant') return; // 工具调用中间态
        const role = normRole(m.author.role);
        if (!role || role === 'tool') return;
        const content = toText(m.content).trim();
        if (!content) return;
        msgs.push({ role: role, content: content, reasoning: '', createdAt: normTs(m.create_time) });
      });
      if (!msgs.length) return;
      out.push({
        title: trimTitle(c.title || 'ChatGPT 对话'),
        createdAt: normTs(c.create_time),
        model: (c.default_model_slug && c.default_model_slug !== 'auto') ? c.default_model_slug : '',
        messages: msgs, source: SRC.chatgpt
      });
    });
    return out;
  }

  /** Claude 官方导出 */
  function parseClaude(arr) {
    const out = [];
    arr.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      const msgs = [];
      (c.chat_messages || []).forEach(function (m) {
        const role = m.sender === 'human' ? 'user' : (m.sender === 'assistant' ? 'assistant' : '');
        if (!role) return;
        let content = m.text || '';
        if (!content && m.content) content = toText(m.content);
        content = String(content || '').trim();
        if (!content) return;
        msgs.push({ role: role, content: content, reasoning: '', createdAt: normTs(m.created_at) });
      });
      if (!msgs.length) return;
      out.push({
        title: trimTitle(c.name || c.title || 'Claude 对话'),
        createdAt: normTs(c.created_at),
        messages: msgs, source: SRC.claude
      });
    });
    return out;
  }

  function looksLikeMemoryArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    let hit = 0;
    arr.slice(0, 12).forEach(function (it) {
      if (it && typeof it === 'object' && typeof it.content === 'string' && !it.role && !it.messages && !it.mapping) hit++;
    });
    return hit >= Math.min(2, arr.length);
  }

  function normMemories(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (m) {
      const content = typeof m === 'string' ? m : (m && (m.content || m.text || m.value));
      const c = String(content == null ? '' : content).trim();
      if (!c) return;
      let tags = m && m.tags;
      if (typeof tags === 'string') tags = tags.split(/[,，;；\s]+/).filter(Boolean);
      if (!Array.isArray(tags)) tags = [];
      out.push({ content: c, tags: tags, pinned: !!(m && m.pinned) });
    });
    return out;
  }

  function fromJSON(obj, filename) {
    const warns = [];

    // 1) ChatUI 全量备份
    if (obj && !Array.isArray(obj) && typeof obj === 'object' && Array.isArray(obj.conversations) &&
      (obj.app === 'ChatUI' || obj.settings || obj.providers || obj.memories)) {
      const convs = obj.conversations.map(convFromChatUI).filter(c => c && c.messages.length);
      return {
        kind: 'backup', label: SRC.backup, backup: obj, conversations: convs,
        memories: normMemories(obj.memories), warnings: warns
      };
    }

    // 2) 只含记忆的对象
    if (obj && !Array.isArray(obj) && typeof obj === 'object' && Array.isArray(obj.memories) && !obj.conversations) {
      return { kind: 'memory', label: SRC.memory, conversations: [], memories: normMemories(obj.memories), warnings: warns };
    }

    // 3) 数组
    if (Array.isArray(obj)) {
      if (!obj.length) throw new Error('文件里没有内容');
      const sample = obj.find(x => x && typeof x === 'object') || {};

      if (sample.mapping || sample.current_node) {
        const convs = parseChatGPT(obj);
        if (convs.length) return { kind: 'chatgpt', label: SRC.chatgpt, conversations: convs, memories: [], warnings: warns };
      }
      if (sample.chat_messages) {
        const convs = parseClaude(obj);
        if (convs.length) return { kind: 'claude', label: SRC.claude, conversations: convs, memories: [], warnings: warns };
      }
      // 多对话数组（含 messages / chat 字段）
      if (obj.some(x => x && typeof x === 'object' && (Array.isArray(x.messages) || Array.isArray(x.chat)))) {
        const convs = obj.map(convFromGeneric).filter(Boolean);
        if (convs.length) return { kind: 'conv', label: SRC.conv, conversations: convs, memories: [], warnings: warns };
      }
      // 记忆数组
      if (looksLikeMemoryArray(obj)) {
        return { kind: 'memory', label: SRC.memory, conversations: [], memories: normMemories(obj), warnings: warns };
      }
      // OpenAI 风格消息数组
      const msgs = obj.map(normMsg).filter(Boolean);
      if (msgs.length) {
        if (msgs.length < obj.length) warns.push('已忽略 ' + (obj.length - msgs.length) + ' 条无法识别的条目（工具调用/空内容等）');
        return {
          kind: 'openai', label: SRC.openai, memories: [], warnings: warns,
          conversations: [{
            title: baseName(filename) ? '导入 · ' + baseName(filename) : '导入的消息数组',
            messages: msgs, source: SRC.openai
          }]
        };
      }
    }

    // 4) 单个对话对象
    if (obj && !Array.isArray(obj) && typeof obj === 'object') {
      const isChatUI = !!obj.providerId || !!obj.summarizedUpTo || (obj.id && /^conv[_-]/.test(String(obj.id)));
      const conv = isChatUI ? convFromChatUI(obj) : convFromGeneric(obj);
      if (conv && conv.messages.length) {
        return { kind: isChatUI ? 'chatui' : 'conv', label: isChatUI ? SRC.chatui : SRC.conv, conversations: [conv], memories: [], warnings: warns };
      }
      if (Array.isArray(obj.data && obj.data.messages)) {
        const c2 = convFromGeneric(obj.data);
        if (c2) return { kind: 'conv', label: SRC.conv, conversations: [c2], memories: [], warnings: warns };
      }
    }

    throw new Error('无法识别的 JSON 结构：既不是对话导出，也不是记忆文件。');
  }

  /* =========================================================
     三、Markdown / 纯文本解析
     ========================================================= */
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

  /** 判断某一行是否是「角色头」，例如：### 用户 · 10:00 / **助手：** / User:（角色名前带旧版 emoji 也能识别） */
  function roleHeader(line) {
    const raw = String(line == null ? '' : line);
    let s = raw.replace(INVISIBLE, ' ').trim();
    if (!s || s.length > 64) return null;
    if (/^[>|]/.test(s)) return null;            // 引用行 / 表格行不是角色头

    const isHeading = /^#{1,6}\s/.test(s);
    const isBullet = /^[-*+]\s+/.test(s) || /^\d+[.)]\s+/.test(s);
    if (isHeading) s = s.replace(/^#{1,6}\s*/, '').replace(/\s+#+\s*$/, '');
    if (isBullet) s = s.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
    const hasBold = /^\*\*[\s\S]+\*\*$/.test(s.trim());

    let core = s.replace(/\*\*/g, '').replace(/^[_*`~]+|[_*`~]+$/g, '').trim();
    core = core.replace(/^[^\p{L}\p{N}]+/u, '').trim();   // 去掉前置 emoji 与符号
    if (!core) return null;

    let name = core, rest = '', hasSep = false;
    const sepIdx = core.search(/[·•|｜]/);
    if (sepIdx > 0) {
      name = core.slice(0, sepIdx).trim();
      rest = core.slice(sepIdx + 1).trim();
      hasSep = true;
    } else {
      const ci = core.search(/[:：]/);
      if (ci > 0 && ci <= 24) {
        name = core.slice(0, ci).trim();
        rest = core.slice(ci + 1).trim();
        hasSep = true;
      }
    }

    const key = name.toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    let role = ROLE_MAP[key] || '';
    if (!role) {
      // 收紧规则：没有分隔符也没有加粗标记时，只认完全匹配的角色词
      // （避免把「## 助手使用说明」这类标题误当成角色头）
      if (!hasSep && !hasBold) return null;
      if (/^(用户|我|提问|human|user|me|问)$/.test(key)) role = 'user';
      else if (/^(助手|回答|模型|ai|bot|gpt|assistant|chatgpt|claude|deepseek|kimi|gemini)/.test(key)) role = 'assistant';
      else if (/^(系统|system)$/.test(key)) role = 'system';
      else return null;
    }

    // 从剩余部分里抽出时间（如 · 10:23:45）
    let inline = rest;
    const tm = inline.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[,，]?\s*/);
    if (tm) inline = inline.slice(tm[0].length).trim();
    inline = inline.replace(/^[\s·:：\-—|]+|[\s·:：\-—|]+$/g, '').trim();

    return { role: role, name: name, inline: inline };
  }
  Imp.roleHeader = roleHeader;

  /** 去掉导出文件头部的元信息（> 模型：xxx / > 时间：xxx / ---） */
  function stripMeta(s) {
    const lines = String(s).split('\n');
    const blank = () => { while (lines.length && /^\s*$/.test(lines[0])) lines.shift(); };
    blank();
    while (lines.length && /^\s*>\s*(模型|时间|导出时间|导出|说明|记忆条数|来源|标题)[:：]/.test(lines[0])) lines.shift();
    blank();
    while (lines.length && /^\s*-{3,}\s*$/.test(lines[0])) lines.shift();
    blank();
    return lines.join('\n').trim();
  }

  /** 判断整份文本是不是「一行一条」的记忆列表 */
  function looksLikeMemoryList(text) {
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean)
      .filter(l => !/^(#{1,6}\s|>|-{3,}$|={3,}$|\*{3,}$)/.test(l));
    if (lines.length < 2) return false;
    const bullet = lines.filter(l => /^([-*+]|\d+[.)])\s*\S/.test(l) || /^(★|⭐|📌)\s*\S/.test(l)).length;
    return bullet / lines.length >= 0.8;
  }

  function fromMarkdown(text, filename) {
    const warns = [];
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');

    let title = '';
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      const m = lines[i].match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/);
      if (m) { title = trimTitle(m[1]); break; }
    }

    const msgs = [];
    let cur = null, buf = [], hits = 0, fence = false;
    const flush = function () {
      if (cur) {
        const c = buf.join('\n').trim();
        if (c) { cur.content = c; msgs.push(cur); }
      }
      cur = null; buf = [];
    };
    lines.forEach(function (line) {
      // 代码围栏内的内容一律视为正文，不做角色头判断
      if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
      const h = fence ? null : roleHeader(line);
      if (h) {
        hits++;
        flush();
        cur = { role: h.role, content: '', reasoning: '', createdAt: 0 };
        if (h.inline) buf.push(h.inline);
        return;
      }
      if (cur) buf.push(line);
    });
    flush();

    // 识别成功：至少两个角色头且产出了多条消息
    const meaningful = msgs.filter(m => m.role === 'user' || m.role === 'assistant');
    if (hits >= 2 && meaningful.length >= 2) {
      if (msgs[0]) msgs[0].content = stripMeta(msgs[0].content);
      const clean = msgs.filter(m => m.content && m.content.trim());
      if (clean.length >= 2) {
        return {
          kind: 'markdown', label: SRC.markdown, memories: [], warnings: warns,
          conversations: [{ title: title || baseName(filename) || '导入的对话', messages: clean, source: SRC.markdown }]
        };
      }
    }

    // 记忆列表
    if (looksLikeMemoryList(text)) {
      let mems = [];
      try { mems = global.Memory ? Memory.parseImport(text, filename) : []; } catch (e) { mems = []; }
      if (mems && mems.length) {
        return { kind: 'memory', label: SRC.memory, conversations: [], memories: mems, warnings: warns };
      }
    }

    // 兜底：整份内容作为一条用户消息
    const plain = String(text).trim();
    if (!plain) throw new Error('文件里没有可导入的文本');
    warns.push('没有识别到「用户 / 助手」等对话标记，整份内容已作为一条用户消息导入，可在新对话里直接针对它提问。');
    if (plain.length > 200000) warns.push('内容较长，注意会占用较多上下文。');
    return {
      kind: 'text', label: SRC.text, memories: [], warnings: warns,
      conversations: [{
        title: title || baseName(filename) || '导入的文本',
        messages: [{ role: 'user', content: plain, reasoning: '', createdAt: 0 }],
        source: SRC.text
      }]
    };
  }

  /* =========================================================
     四、入口：文本 / 文件
     ========================================================= */
  Imp.parseText = function (text, filename) {
    const raw = String(text == null ? '' : text);
    if (!raw.trim()) throw new Error('内容为空');
    const head = raw.trim();

    if (/^[[{]/.test(head)) {
      let obj = null;
      try { obj = JSON.parse(head); } catch (e) { obj = null; }

      // JSONL：每一行都是一个独立完整的 JSON 对象
      if (obj == null) {
        const jlines = head.split('\n').map(l => l.trim()).filter(Boolean);
        if (jlines.length > 1) {
          const parsed = jlines.map(function (l) { try { return JSON.parse(l); } catch (e) { return undefined; } });
          if (parsed.every(x => x !== undefined)) {
            const r = fromJSON(parsed, filename);
            r.warnings.push('按 JSONL（每行一个 JSON 对象）解析，共 ' + parsed.length + ' 行');
            return r;
          }
        }
        obj = tryJSON(head);   // 宽松解析：可能被多余文字或代码围栏包裹
      }
      if (obj != null && typeof obj === 'object') return fromJSON(obj, filename);
      throw new Error('JSON 解析失败：文件可能不完整或不是合法的 JSON');
    }
    return fromMarkdown(raw, filename);
  };

  Imp.parseFile = function (file) {
    const name = (file && file.name) || '';
    if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(name)) {
      return Promise.reject(new Error('图片不能导入为对话，请用附件方式发送'));
    }
    return U.readAsText(file).then(function (t) { return Imp.parseText(t, name); });
  };

  /** 合并多个文件的解析结果 */
  Imp.parseFiles = function (files) {
    const list = Array.prototype.slice.call(files || []);
    const jobs = list.map(function (f) {
      return Imp.parseFile(f).then(
        r => ({ ok: true, name: f.name, result: r }),
        e => ({ ok: false, name: f.name, error: e && e.message ? e.message : String(e) })
      );
    });
    return Promise.all(jobs).then(function (rs) {
      const merged = { kind: 'multi', label: '', conversations: [], memories: [], backup: null, warnings: [], files: [] };
      const kinds = [];
      rs.forEach(function (r) {
        if (!r.ok) { merged.warnings.push('「' + r.name + '」解析失败：' + r.error); return; }
        const res = r.result;
        merged.files.push({ name: r.name, kind: res.kind, label: res.label, conversations: res.conversations.length, messages: countMessages(res), memories: res.memories.length });
        kinds.push(res.kind);
        merged.conversations.push.apply(merged.conversations, res.conversations || []);
        merged.memories.push.apply(merged.memories, res.memories || []);
        if (!merged.backup && res.backup) merged.backup = res.backup;
        merged.warnings.push.apply(merged.warnings, res.warnings || []);
      });
      merged.conversations.forEach(function (c) { if (!c.source) c.source = '导入'; });
      merged.label = merged.files.length === 1 ? (merged.files[0].label || SRC.unknown) : (merged.files.length + ' 个文件');
      if (merged.files.length === 1) merged.kind = kinds[0] || 'unknown';
      if (!merged.conversations.length && !merged.memories.length) {
        throw new Error(merged.warnings.join('；') || '没有解析出可导入的内容');
      }
      return merged;
    });
  };

  function countMessages(res) {
    return (res.conversations || []).reduce((n, c) => n + (c.messages ? c.messages.length : 0), 0);
  }
  Imp.countMessages = countMessages;

  Imp.stats = function (res) {
    const st = { conversations: 0, messages: 0, user: 0, assistant: 0, memories: 0, chars: 0, tokens: 0, titles: [] };
    if (!res) return st;
    st.memories = (res.memories || []).length + (res.backup && Array.isArray(res.backup.memories) ? res.backup.memories.length : 0);
    (res.conversations || []).forEach(function (c) {
      st.conversations++;
      if (st.titles.length < 6) st.titles.push(c.title || '（无标题）');
      (c.messages || []).forEach(function (m) {
        if (m.role !== 'user' && m.role !== 'assistant') return;   // system / tool 不会进入对话
        st.messages++;
        if (m.role === 'user') st.user++; else st.assistant++;
        st.chars += (m.content || '').length;
      });
    });
    st.tokens = Math.round(st.chars / 2.2);   // 中英混排粗略估算
    return st;
  };

  /* =========================================================
     五、落库
     ========================================================= */
  /**
   * @param {object} result  parseText / parseFiles 的返回
   * @param {object} opts    { mode:'separate'|'merge', providerId, model, title,
   *                           memories:boolean, backup:{settings,providers,assistants,memories}|false }
   * @returns {{ conversations: object[], memories:number, skippedMemories:number, backup:boolean }}
   */
  function firstUserText(msgs) {
    for (let i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === 'user' && msgs[i].content) return String(msgs[i].content).replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    return '';
  }

  /** 是否已经存在内容相同的对话（标题 + 消息数 + 第一条用户消息） */
  function alreadyExists(title, msgs, titleMap) {
    const cands = titleMap[title];
    if (!cands || !cands.length) return false;
    const sig = (msgs || []).length + '|' + firstUserText(msgs);
    for (let i = 0; i < cands.length; i++) {
      if (cands[i].msgCount !== (msgs || []).length) continue;
      const ex = Store.getConversation(cands[i].id);
      if (!ex) continue;
      if ((ex.messages || []).length + '|' + firstUserText(ex.messages) === sig) return true;
    }
    return false;
  }

  Imp.apply = function (result, opts) {
    opts = opts || {};
    const out = { conversations: [], memories: 0, skippedMemories: 0, skippedConversations: 0, backup: false };
    const now = Date.now();

    /* ---- 备份：交给 Store.importAll ---- */
    let backupMemHandled = false;
    if (result.backup) {
      const b = opts.backup || {};
      const wantMem = !!b.memories && opts.memories !== false;
      const memBefore = Store.memories.length;
      Store.importAll(result.backup, 'merge', {
        settings: !!b.settings, providers: !!b.providers,
        assistants: !!b.assistants, memories: wantMem,
        conversations: false
      });
      out.backup = true;
      backupMemHandled = wantMem;
      if (wantMem) out.memories += Math.max(0, Store.memories.length - memBefore);
    }

    /* ---- 记忆 ---- */
    const mems = (!backupMemHandled && (result.memories || []).length) ? result.memories.slice() : [];
    if (opts.memories === false) mems.length = 0;
    mems.forEach(function (m) {
      const c = String(m.content || '').trim();
      if (!c) return;
      const existed = Store.memories.some(x => (x.content || '').trim() === c);
      if (existed) { out.skippedMemories++; return; }
      const created = Store.addMemory(c, 'import', m.tags || []);
      if (!created) { out.skippedMemories++; return; }
      if (m.pinned) Store.updateMemory(created.id, { pinned: true });
      out.memories++;
    });

    /* ---- 对话 ---- */
    let convs = (result.conversations || []).filter(c => c && c.messages && c.messages.length);
    if (!convs.length) return out;

    if (opts.mode === 'merge' && convs.length > 1) {
      const all = [];
      convs.forEach(function (c) {
        if (all.length) all.push({ role: 'user', content: '— 以下来自：' + (c.title || '未命名对话') + ' —', createdAt: 0 });
        c.messages.forEach(function (m) { all.push(m); });
      });
      convs = [{
        title: opts.title || (result.label ? result.label + '（合并）' : '合并导入的对话'),
        messages: all, source: '合并导入'
      }];
    }

    const wantDedupe = opts.dedupe !== false && opts.mode !== 'merge';
    const titleMap = {};
    if (wantDedupe) Store.convIndex.forEach(function (m) { (titleMap[m.title] = titleMap[m.title] || []).push(m); });

    const baseTime = now - convs.length * 60000;
    convs.forEach(function (c, i) {
      let title = trimTitle(c.title);
      if (!title) title = convs.length > 1 ? '导入的对话 ' + (i + 1) : '导入的对话';
      title = title.slice(0, 80);
      if (wantDedupe && alreadyExists(title, c.messages, titleMap)) { out.skippedConversations++; return; }
      const conv = Store.createConversation({
        title: title,
        providerId: opts.providerId || undefined,
        model: c.model || opts.model || undefined,
        silent: true
      });
      const start = c.createdAt && c.createdAt > 0 ? c.createdAt : (baseTime + i * 60000);
      conv.createdAt = start;
      conv.updatedAt = c.updatedAt && c.updatedAt > start ? c.updatedAt : start;
      conv.importedFrom = c.source || result.label || '导入';
      conv.importedAt = now;

      let t = start;
      let sysText = '';
      (c.messages || []).forEach(function (m) {
        if (m.role === 'tool') return;
        if (m.role === 'system') {
          if (!sysText) sysText = m.content || '';
          return;
        }
        t = m.createdAt && m.createdAt > 0 ? Math.max(m.createdAt, t) : t + 1000;
        conv.messages.push({
          id: U.uid('msg'),
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || '',
          reasoning: m.reasoning || '',
          createdAt: t,
          imported: true
        });
      });
      if (sysText.trim() && !conv.systemPrompt) conv.systemPrompt = sysText.trim();
      if (!conv.messages.length) { Store.deleteConversation(conv.id); return; }   // 只剩系统消息，丢弃空壳
      Store.saveConversation(conv, { silent: true });
      if (wantDedupe) (titleMap[title] = titleMap[title] || []).push({ id: conv.id, msgCount: conv.messages.length });
      out.conversations.push(conv);
    });

    U.bus.emit('conversations', Store.convIndex);
    return out;
  };

  global.Importer = Imp;
})(window);
