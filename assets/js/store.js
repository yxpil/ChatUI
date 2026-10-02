/* ===========================================================
   store.js · 本地存储层（全部基于 localStorage）
   =========================================================== */
(function (global) {
  'use strict';

  const NS = 'chatui.v1.';
  const KEY = {
    settings: NS + 'settings',
    providers: NS + 'providers',
    active: NS + 'active',
    convIndex: NS + 'convIndex',
    conv: NS + 'conv.',          // + id
    memories: NS + 'memories',
    assistants: NS + 'assistants',
    activeConv: NS + 'activeConv'
  };

  /* ---------------------------------------------------------
     服务商预设（全部为 OpenAI 兼容协议）
     --------------------------------------------------------- */
  const PRESETS = [
    {
      id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true,
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'o1-mini'],
      note: '官方接口。若浏览器提示 CORS 失败，请使用支持跨域的中转地址。'
    },
    {
      id: 'deepseek', name: 'DeepSeek 深度求索', baseUrl: 'https://api.deepseek.com/v1', needsKey: true,
      models: ['deepseek-chat', 'deepseek-reasoner'],
      note: 'deepseek-reasoner 为推理模型，会自动展示思维链。'
    },
    {
      id: 'ollama', name: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', needsKey: false,
      models: ['llama3.2', 'qwen2.5:7b', 'deepseek-r1:7b', 'gemma3', 'phi4', 'mistral'],
      note: '需允许跨域：启动 Ollama 前设置环境变量 OLLAMA_ORIGINS=*（详见 README）。'
    },
    {
      id: 'lmstudio', name: 'LM Studio（本地）', baseUrl: 'http://localhost:1234/v1', needsKey: false,
      models: ['local-model'], note: 'LM Studio 开启 Developer → Start Server 后使用。'
    },
    {
      id: 'vllm', name: 'vLLM / 自建（本地）', baseUrl: 'http://localhost:8000/v1', needsKey: false,
      models: [], note: '任何暴露 /v1/chat/completions 的服务都可接入。'
    },
    {
      id: 'moonshot', name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', needsKey: true,
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview']
    },
    {
      id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', needsKey: true,
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4-long']
    },
    {
      id: 'dashscope', name: '阿里云通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsKey: true,
      models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct', 'qwq-32b']
    },
    {
      id: 'siliconflow', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', needsKey: true,
      models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct']
    },
    {
      id: 'volcengine', name: '火山方舟（豆包）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', needsKey: true,
      models: ['doubao-pro-32k', 'doubao-lite-32k'], note: '模型名通常填写「接入点 ID」（ep-xxxxxxxx）。'
    },
    {
      id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', needsKey: true,
      models: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-standard']
    },
    {
      id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true,
      models: ['openai/gpt-4o', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat']
    },
    {
      id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true,
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']
    },
    {
      id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', needsKey: true,
      models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest']
    },
    {
      id: 'custom', name: '自定义 / 中转站', baseUrl: '', needsKey: true,
      models: [], note: '填入任何 OpenAI 兼容网关地址，例如 https://your-gateway.com/v1'
    }
  ];

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    fontSize: 15,
    stream: true,
    sendOnEnter: true,
    showReasoning: true,
    autoTitle: true,
    autoScroll: true,
    saveImages: true,
    ttsAuto: false,
    ttsVoice: '',
    maxContextTokens: 32000,
    contextStrategy: 'trim',       // trim | summary
    memoryEnabled: true,
    memoryAutoExtract: true,
    memoryTopK: 6,
    memoryMaxChars: 2000,
    systemPrompt: '你是一个乐于助人的 AI 助手。回答准确、简洁、有条理，使用 Markdown 排版；代码放在带语言标注的代码块中。',
    timeoutMs: 120000,
    hideUserAvatar: false
  };

  /* ---------------------------------------------------------
     底层读写
     --------------------------------------------------------- */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      console.warn('[store] 读取失败', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[store] 写入失败', key, e);
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        U.toast('本地存储已满，请清理历史对话或导出备份后删除', 'err', 4200);
      } else {
        U.toast('本地保存失败：' + (e && e.message ? e.message : e), 'err', 3200);
      }
      return false;
    }
  }

  /* ---------------------------------------------------------
     助手图标迁移：旧数据里的 emoji → 语义化 SVG 图标 id
     （界面已完全改用 SVG，不再渲染 emoji 字形）
     --------------------------------------------------------- */
  const EMOJI_TO_ICON = {
    '👨‍💻': 'i-terminal', '💻': 'i-terminal', '🧑‍💻': 'i-terminal', '🖥️': 'i-terminal',
    '✍️': 'i-pen', '✏️': 'i-pen', '📝': 'i-pen',
    '🌐': 'i-globe', '🔤': 'i-globe', '🈯': 'i-globe',
    '📚': 'i-book', '📖': 'i-book', '📄': 'i-file-text', '📃': 'i-file-text',
    '🔍': 'i-search', '🔎': 'i-search', '🔬': 'i-search',
    '📊': 'i-chart', '📈': 'i-chart', '⚖️': 'i-chart',
    '🧠': 'i-brain', '💡': 'i-sparkles', '✨': 'i-sparkles', '🌟': 'i-sparkles',
    '🤖': 'i-bot', '🦾': 'i-bot', '🧪': 'i-sparkles', '🧭': 'i-sparkles',
    '🗄️': 'i-database', '💾': 'i-database', '🔒': 'i-shield', '🛡️': 'i-shield',
    '🖼️': 'i-image', '🎨': 'i-image', '⚙️': 'i-settings', '🔌': 'i-plug'
  };

  /** 可选图标（助手新建 / 编辑弹窗用） */
  const ASSISTANT_ICONS = [
    'i-sparkles', 'i-bot', 'i-terminal', 'i-code', 'i-pen', 'i-book',
    'i-globe', 'i-brain', 'i-chart', 'i-search', 'i-file-text', 'i-database',
    'i-image', 'i-sliders', 'i-shield', 'i-plug'
  ];

  function normalizeAssistant(a) {
    if (!a || typeof a !== 'object') return a;
    if (!a.icon || typeof a.icon !== 'string' || a.icon.indexOf('i-') !== 0) {
      a.icon = EMOJI_TO_ICON[a.emoji] || 'i-sparkles';
    }
    if (a.emoji) delete a.emoji;
    return a;
  }

  /* ---------------------------------------------------------
     Store
     --------------------------------------------------------- */
  const Store = {
    PRESETS: PRESETS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    ASSISTANT_ICONS: ASSISTANT_ICONS,
    EMOJI_TO_ICON: EMOJI_TO_ICON,
    normalizeAssistant: normalizeAssistant,

    settings: null,
    providers: [],
    active: { providerId: 'deepseek', model: {} },   // model: { providerId: modelName }
    convIndex: [],
    memories: [],
    assistants: [],
    activeConvId: null,

    /* ---------- 初始化 ---------- */
    init: function () {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, read(KEY.settings, {}));

      let provs = read(KEY.providers, null);
      if (!provs || !provs.length) {
        provs = PRESETS.map(function (p) {
          return {
            id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: '',
            models: (p.models || []).slice(), builtin: true, note: p.note || '',
            headers: {}
          };
        });
      }
      this.providers = provs;

      this.active = read(KEY.active, { providerId: 'deepseek', model: {} });
      if (!this.getProvider(this.active.providerId)) this.active.providerId = this.providers[0].id;
      if (!this.active.model) this.active.model = {};

      this.convIndex = read(KEY.convIndex, []);
      this.memories = read(KEY.memories, []);
      this.assistants = read(KEY.assistants, []);
      this.activeConvId = read(KEY.activeConv, null);

      if (!this.convIndex.length) {
        const c = this.createConversation({ silent: true });
        this.activeConvId = c.id;
      }
      if (!this.memories.length) {
        this.memories = [{
          id: U.uid('mem'),
          content: '示例记忆：用户偏好用中文交流，回答希望简洁并带代码示例。可在此弹窗中删除或添加你自己的长期记忆。',
          tags: ['示例'],
          createdAt: Date.now(), updatedAt: Date.now(),
          source: 'manual', pinned: false, useCount: 0, lastUsedAt: 0
        }];
        write(KEY.memories, this.memories);
      }
      if (!this.getConversation(this.activeConvId)) {
        this.activeConvId = this.convIndex[0] ? this.convIndex[0].id : null;
      }
      return this;
    },

    /* ---------- 设置 ---------- */
    saveSettings: function (patch) {
      if (patch) Object.assign(this.settings, patch);
      write(KEY.settings, this.settings);
      U.bus.emit('settings', this.settings);
      return this.settings;
    },

    /* ---------- 服务商 ---------- */
    getProvider: function (id) {
      for (let i = 0; i < this.providers.length; i++) if (this.providers[i].id === id) return this.providers[i];
      return null;
    },
    saveProviders: function () { write(KEY.providers, this.providers); U.bus.emit('providers', this.providers); },
    updateProvider: function (id, patch) {
      const p = this.getProvider(id);
      if (!p) return null;
      Object.assign(p, patch);
      this.saveProviders();
      return p;
    },
    addProvider: function (data) {
      const p = Object.assign({
        id: U.uid('prov'), name: '新服务商', baseUrl: '', apiKey: '', models: [],
        builtin: false, note: '', headers: {}
      }, data || {});
      this.providers.push(p);
      this.saveProviders();
      return p;
    },
    removeProvider: function (id) {
      this.providers = this.providers.filter(p => p.id !== id);
      if (this.active.providerId === id) this.active.providerId = this.providers[0] ? this.providers[0].id : '';
      this.saveProviders();
      this.saveActive();
    },
    getActiveProvider: function () { return this.getProvider(this.active.providerId) || this.providers[0] || null; },
    getActiveModel: function () {
      const p = this.getActiveProvider();
      if (!p) return '';
      return this.active.model[p.id] || p.defaultModel || (p.models && p.models[0]) || '';
    },
    setActive: function (providerId, model) {
      if (providerId) this.active.providerId = providerId;
      if (model) { this.active.model = this.active.model || {}; this.active.model[this.active.providerId] = model; }
      this.saveActive();
    },
    saveActive: function () { write(KEY.active, this.active); U.bus.emit('active', this.active); },

    /* ---------- 对话 ---------- */
    listConversations: function () {
      return this.convIndex.slice().sort(function (a, b) {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    },
    getConversation: function (id) {
      if (!id) return null;
      return read(KEY.conv + id, null);
    },
    saveConversation: function (conv, opts) {
      if (!conv || !conv.id) return false;
      conv.updatedAt = conv.updatedAt || Date.now();
      const ok = write(KEY.conv + conv.id, conv);
      if (!ok) return false;
      const msgs = conv.messages || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      let preview = '';
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user' && msgs[i].content) { preview = msgs[i].content.slice(0, 60); break; }
      }
      const meta = {
        id: conv.id, title: conv.title, providerId: conv.providerId, model: conv.model,
        createdAt: conv.createdAt, updatedAt: conv.updatedAt, pinned: !!conv.pinned,
        msgCount: msgs.length, preview: preview,
        lastRole: last ? last.role : ''
      };
      const idx = this.convIndex.findIndex(c => c.id === conv.id);
      if (idx >= 0) this.convIndex[idx] = meta; else this.convIndex.push(meta);
      write(KEY.convIndex, this.convIndex);
      if (!opts || !opts.silent) U.bus.emit('conversations', this.convIndex);
      return true;
    },
    createConversation: function (opts) {
      opts = opts || {};
      const p = opts.providerId ? this.getProvider(opts.providerId) : this.getActiveProvider();
      const conv = {
        id: U.uid('conv'),
        title: opts.title || '新对话',
        providerId: p ? p.id : '',
        model: opts.model || (p ? (this.active.model[p.id] || p.models[0] || '') : ''),
        assistantId: opts.assistantId || null,
        systemPrompt: opts.systemPrompt != null ? opts.systemPrompt : null,
        temperature: opts.temperature != null ? opts.temperature : null,
        topP: opts.topP != null ? opts.topP : null,
        maxTokens: opts.maxTokens != null ? opts.maxTokens : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        summary: '',            // 滚动摘要（上下文压缩用）
        summarizedUpTo: 0,      // 已被摘要覆盖的消息条数
        messages: []
      };
      write(KEY.conv + conv.id, conv);
      this.convIndex.unshift({
        id: conv.id, title: conv.title, providerId: conv.providerId, model: conv.model,
        createdAt: conv.createdAt, updatedAt: conv.updatedAt, pinned: false, msgCount: 0, preview: ''
      });
      write(KEY.convIndex, this.convIndex);
      if (!opts.silent) U.bus.emit('conversations', this.convIndex);
      return conv;
    },
    deleteConversation: function (id) {
      try { localStorage.removeItem(KEY.conv + id); } catch (e) { }
      this.convIndex = this.convIndex.filter(c => c.id !== id);
      write(KEY.convIndex, this.convIndex);
      if (this.activeConvId === id) this.activeConvId = this.convIndex[0] ? this.convIndex[0].id : null;
      this.setActiveConv(this.activeConvId);
      U.bus.emit('conversations', this.convIndex);
      return true;
    },
    renameConversation: function (id, title) {
      const conv = this.getConversation(id);
      if (!conv) return false;
      conv.title = title;
      conv.updatedAt = Date.now();
      return this.saveConversation(conv);
    },
    togglePin: function (id) {
      const conv = this.getConversation(id);
      if (!conv) return false;
      conv.pinned = !conv.pinned;
      this.saveConversation(conv);
      return conv.pinned;
    },
    setActiveConv: function (id) { this.activeConvId = id; write(KEY.activeConv, id); U.bus.emit('activeConv', id); },

    searchConversations: function (q) {
      q = (q || '').trim().toLowerCase();
      if (!q) return this.listConversations();
      const out = [];
      const idx = this.listConversations();
      for (let i = 0; i < idx.length; i++) {
        const meta = idx[i];
        if ((meta.title || '').toLowerCase().indexOf(q) >= 0 || (meta.preview || '').toLowerCase().indexOf(q) >= 0) {
          out.push(meta);
          continue;
        }
        const conv = this.getConversation(meta.id);
        if (conv && (conv.messages || []).some(m => (m.content || '').toLowerCase().indexOf(q) >= 0)) out.push(meta);
      }
      return out;
    },

    /* ---------- 记忆 ---------- */
    listMemories: function () { return this.memories.slice(); },
    addMemory: function (content, source, tags) {
      content = (content || '').trim();
      if (!content) return null;
      // 去重：完全一致或高度相似则跳过
      for (let i = 0; i < this.memories.length; i++) {
        if (this.memories[i].content.trim() === content) return null;
      }
      const m = {
        id: U.uid('mem'), content: content, tags: tags || [], createdAt: Date.now(),
        updatedAt: Date.now(), source: source || 'manual', pinned: false, useCount: 0, lastUsedAt: 0
      };
      this.memories.unshift(m);
      this.saveMemories();
      return m;
    },
    updateMemory: function (id, patch) {
      const m = this.memories.find(x => x.id === id);
      if (!m) return null;
      Object.assign(m, patch, { updatedAt: Date.now() });
      this.saveMemories();
      return m;
    },
    removeMemory: function (id) {
      this.memories = this.memories.filter(m => m.id !== id);
      this.saveMemories();
    },
    clearMemories: function () { this.memories = []; this.saveMemories(); },
    saveMemories: function () { write(KEY.memories, this.memories); U.bus.emit('memories', this.memories); },

    /* ---------- 助手 ---------- */
    listAssistants: function () {
      if (!this.assistants.length) {
        this.assistants = [
          { id: 'as_code', name: '代码助手', icon: 'i-terminal', desc: '专注写代码、调试与代码审查', systemPrompt: '你是一位资深软件工程师。回答以可运行的代码为主，代码块必须标注语言，并简要解释关键点与边界情况。', temperature: 0.2, memoryEnabled: true, builtin: true, createdAt: Date.now() },
          { id: 'as_write', name: '写作润色', icon: 'i-pen', desc: '文案、报告、文章润色', systemPrompt: '你是一位中文写作专家。输出结构清晰、语言凝练，善用小标题与列表；除非要求，不要过度使用形容词。', temperature: 0.7, memoryEnabled: true, builtin: true, createdAt: Date.now() },
          { id: 'as_trans', name: '翻译官', icon: 'i-globe', desc: '中英互译，保留术语与格式', systemPrompt: '你是一位专业翻译。中英互译时保持原文语气、专业术语与 Markdown 格式不变，只输出译文。', temperature: 0.3, memoryEnabled: false, builtin: true, createdAt: Date.now() },
          { id: 'as_read', name: '长文解析', icon: 'i-book', desc: '总结长文档、论文、README', systemPrompt: '你擅长信息抽取。阅读用户提供的长文后，先给出 3-5 条 TL;DR，再按主题分节整理要点，最后列出待确认问题。', temperature: 0.3, memoryEnabled: true, builtin: true, createdAt: Date.now() }
        ];
        write(KEY.assistants, this.assistants);
      } else {
        // 兼容历史数据：把 emoji 字段就地迁移成 icon
        let dirty = false;
        this.assistants.forEach(function (a) {
          const before = a.icon;
          normalizeAssistant(a);
          if (before !== a.icon) dirty = true;
        });
        if (dirty) {
          try { write(KEY.assistants, this.assistants); } catch (e) { }
        }
      }
      return this.assistants;
    },
    getAssistant: function (id) { return this.listAssistants().find(a => a.id === id) || null; },
    saveAssistant: function (data) {
      const list = this.listAssistants();
      if (data.id) {
        const a = list.find(x => x.id === data.id);
        if (a) { Object.assign(a, data); normalizeAssistant(a); write(KEY.assistants, list); U.bus.emit('assistants', list); return a; }
      }
      const na = Object.assign({ id: U.uid('as'), icon: 'i-sparkles', name: '新助手', desc: '', systemPrompt: '', temperature: 0.6, memoryEnabled: true, builtin: false, createdAt: Date.now() }, data);
      normalizeAssistant(na);
      list.push(na);
      write(KEY.assistants, list);
      U.bus.emit('assistants', list);
      return na;
    },
    removeAssistant: function (id) {
      this.assistants = this.listAssistants().filter(a => a.id !== id);
      write(KEY.assistants, this.assistants);
      U.bus.emit('assistants', this.assistants);
    },

    /* ---------- 导入 / 导出 ---------- */
    exportAll: function (withConversations) {
      const data = {
        app: 'ChatUI', version: 1, exportedAt: Date.now(),
        settings: this.settings, providers: this.providers, active: this.active,
        memories: this.memories, assistants: this.listAssistants()
      };
      if (withConversations !== false) {
        data.conversations = this.convIndex.map(m => this.getConversation(m.id)).filter(Boolean);
      }
      return data;
    },
    /**
     * @param {object} data 备份数据
     * @param {string} mode 'merge'（保留现有）| 'conv'（对话重新分配 ID、不覆盖设置）
     * @param {object} [opts] 分项开关：{ settings, providers, assistants, memories, conversations }，缺省为 true
     */
    importAll: function (data, mode, opts) {
      if (!data || typeof data !== 'object') throw new Error('文件格式不正确');
      opts = opts || {};
      const want = function (k) { return opts[k] !== false; };
      if (data.settings && mode !== 'conv' && want('settings')) Object.assign(this.settings, data.settings);
      if (Array.isArray(data.providers) && want('providers')) {
        data.providers.forEach(function (p) {
          const ex = Store.getProvider(p.id);
          if (ex) Object.assign(ex, p); else Store.providers.push(p);
        });
      }
      if (data.active) { this.active = data.active; write(KEY.active, this.active); }
      if (Array.isArray(data.memories) && want('memories')) {
        const exist = {};
        this.memories.forEach(m => { exist[m.content.trim()] = 1; });
        data.memories.forEach(function (m) {
          if (!exist[(m.content || '').trim()]) { Store.memories.push(m); exist[(m.content || '').trim()] = 1; }
        });
      }
      if (Array.isArray(data.assistants) && want('assistants')) {
        data.assistants.forEach(function (a) {
          if (!a || !a.id) return;
          normalizeAssistant(a);      // 备份里的旧 emoji 图标一并迁移
          if (!Store.assistants.some(x => x.id === a.id)) Store.assistants.push(a);
        });
      }
      if (Array.isArray(data.conversations) && want('conversations')) {
        const existIdx = {};
        this.convIndex.forEach(c => { existIdx[c.id] = 1; });
        data.conversations.forEach(function (c) {
          if (!c || !c.id) return;
          if (mode === 'conv' && existIdx[c.id]) c.id = U.uid('conv');
          Store.saveConversation(c, { silent: true });
        });
      }
      write(KEY.settings, this.settings);
      write(KEY.providers, this.providers);
      write(KEY.memories, this.memories);
      write(KEY.assistants, this.assistants);
      U.bus.emit('conversations', this.convIndex);
      U.bus.emit('settings', this.settings);
      U.bus.emit('memories', this.memories);
      U.bus.emit('assistants', this.assistants);
      return true;
    },
    exportConversationMarkdown: function (conv) {
      if (!conv) return '';
      const p = this.getProvider(conv.providerId);
      let out = '# ' + (conv.title || '对话') + '\n\n';
      out += '> 模型：' + (p ? p.name + ' / ' : '') + (conv.model || '未知') + '\n';
      out += '> 时间：' + U.formatDateTime(conv.createdAt) + '\n\n---\n\n';
      (conv.messages || []).forEach(function (m) {
        if (m.hidden) return;
        const who = m.role === 'user' ? '用户' : '助手';
        out += '### ' + who + ' · ' + U.formatTime(m.createdAt || Date.now()) + '\n\n';
        if (m.reasoning) out += '<details><summary>思考过程</summary>\n\n' + m.reasoning + '\n\n</details>\n\n';
        out += (m.content || '') + '\n\n';
        if (m.images && m.images.length) out += '_（含 ' + m.images.length + ' 张图片附件，未导出）_\n\n';
        out += '---\n\n';
      });
      return out;
    },

    /* ---------- 容量 ---------- */
    usage: function () {
      let bytes = 0, count = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(NS) === 0) {
            bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
            count++;
          }
        }
      } catch (e) { }
      return { bytes: bytes, items: count, quota: 5 * 1024 * 1024 };
    },

    clearConversations: function () {
      this.convIndex.forEach(c => { try { localStorage.removeItem(KEY.conv + c.id); } catch (e) { } });
      this.convIndex = [];
      write(KEY.convIndex, this.convIndex);
      this.setActiveConv(null);
      U.bus.emit('conversations', this.convIndex);
    },

    resetAll: function () {
      const keys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(NS) === 0) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
      } catch (e) { }
      location.reload();
    }
  };

  global.Store = Store;
})(window);
