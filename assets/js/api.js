/* ===========================================================
   api.js · OpenAI 兼容协议调用层
   —— 适配 OpenAI / DeepSeek / Ollama / Kimi / GLM / 通义 / 硅基流动 等
   =========================================================== */
(function (global) {
  'use strict';

  const API = {};

  /* ---------- 地址规范化 ---------- */
  API.normalizeBase = function (baseUrl) {
    let u = String(baseUrl || '').trim();
    if (!u) return '';
    u = u.replace(/\/+$/, '');
    // 去掉用户误填的 /chat/completions
    u = u.replace(/\/chat\/completions$/i, '');
    try {
      const parsed = new URL(u);
      if (!parsed.pathname || parsed.pathname === '/') u += '/v1';
    } catch (e) { /* 非法 URL 原样返回 */ }
    return u;
  };

  API.buildHeaders = function (provider) {
    const h = { 'Content-Type': 'application/json' };
    if (provider && provider.apiKey) h['Authorization'] = 'Bearer ' + provider.apiKey;
    if (provider && provider.headers) {
      for (const k in provider.headers) {
        if (provider.headers[k]) h[k] = provider.headers[k];
      }
    }
    return h;
  };

  /* ---------- 组合 AbortSignal ---------- */
  function combineSignal(outer) {
    const ctl = new AbortController();
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener('abort', () => ctl.abort(), { once: true });
    }
    return { signal: ctl.signal, abort: () => ctl.abort(), ctl: ctl };
  }

  /* ---------- 超时 ---------- */
  function withTimeout(ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('请求超时')), ms || 120000);
    return { signal: ctl.signal, clear: () => clearTimeout(timer) };
  }

  /* ---------- 错误信息提取 ---------- */
  function extractError(status, bodyText) {
    let msg = bodyText || '';
    try {
      const j = JSON.parse(bodyText);
      msg = (j.error && (j.error.message || j.error.type)) || j.message || j.msg || bodyText;
    } catch (e) { }
    if (typeof msg === 'string' && msg.length > 400) msg = msg.slice(0, 400) + '…';
    let hint = '';
    if (status === 401 || status === 403) hint = '（API Key 无效或权限不足）';
    else if (status === 404) hint = '（接口地址或模型名不存在，请检查 Base URL 是否需要 /v1）';
    else if (status === 429) hint = '（请求过于频繁或额度不足）';
    else if (status === 0) hint = '（网络不可达 / 跨域被拦截）';
    return 'HTTP ' + status + hint + (msg ? '：' + msg : '');
  }

  /* ---------- 网络错误友好化 ---------- */
  function friendlyNetworkError(e, provider) {
    const isLocal = provider && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(provider.baseUrl || '');
    let m = e && e.message ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(m)) {
      m = '无法连接到 ' + (provider ? provider.baseUrl : '接口') + '。';
      if (isLocal) {
        m += ' 若为本地模型（Ollama/LM Studio），请确认服务已启动，并允许跨域访问（Ollama 需设置 OLLAMA_ORIGINS=*）。建议用 start.bat 以 http://localhost 方式打开本页面。';
      } else {
        m += ' 可能原因：网络不通、地址错误、或该服务未开放浏览器跨域（CORS）。可改用支持跨域的中转地址。';
      }
    }
    return new Error(m);
  }

  /* ---------- 拉取模型列表 ---------- */
  API.listModels = async function (provider, timeoutMs) {
    if (!provider) throw new Error('未选择服务商');
    const base = API.normalizeBase(provider.baseUrl);
    if (!base) throw new Error('请先填写 Base URL');
    const t = withTimeout(timeoutMs || 20000);
    const ctl = combineSignal(t.signal);
    let res;
    try {
      res = await fetch(base + '/models', { method: 'GET', headers: API.buildHeaders(provider), signal: ctl.signal });
    } catch (e) {
      t.clear();
      throw friendlyNetworkError(e, provider);
    }
    t.clear();
    const text = await res.text();
    if (!res.ok) throw new Error(extractError(res.status, text));
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('返回内容不是合法 JSON'); }
    let arr = json.data || json.models || json.list || json.result || [];
    if (!Array.isArray(arr)) arr = [];
    const ids = arr.map(function (m) {
      if (typeof m === 'string') return m;
      return m.id || m.name || m.model || '';
    }).filter(Boolean);
    // 排序：常用在前，其余字母序
    ids.sort(function (a, b) {
      const ca = /gpt|claude|deepseek|qwen|glm|llama|gemini/i.test(a) ? 0 : 1;
      const cb = /gpt|claude|deepseek|qwen|glm|llama|gemini/i.test(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.localeCompare(b);
    });
    return ids;
  };

  /* ---------- 消息体构造 ---------- */
  /**
   * 把内部消息结构转成 OpenAI messages
   * 内部：{role, content, images:[{dataUrl}], files:[{name,text}]}
   */
  API.toOpenAIMessages = function (messages) {
    const out = [];
    (messages || []).forEach(function (m) {
      if (m.hidden) return;
      let content = m.content || '';
      // 文本附件拼接到正文
      if (m.files && m.files.length) {
        const extra = m.files.map(function (f) {
          return '\n\n--- 附件：' + f.name + ' ---\n```\n' + (f.text || '').slice(0, 100000) + '\n```';
        }).join('');
        content = content + extra;
      }
      if (m.images && m.images.length) {
        const parts = [];
        if (content) parts.push({ type: 'text', text: content });
        m.images.forEach(function (img) {
          parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
        });
        out.push({ role: m.role, content: parts });
      } else {
        out.push({ role: m.role, content: content });
      }
    });
    return out;
  };

  /* ---------- 解析流式增量 ---------- */
  function pickDelta(delta) {
    let text = '', reason = '';
    if (!delta) return { text: '', reason: '' };
    if (typeof delta.content === 'string') text = delta.content;
    else if (Array.isArray(delta.content)) {
      delta.content.forEach(function (p) {
        if (typeof p === 'string') text += p;
        else if (p && p.type === 'text') text += (p.text || '');
      });
    }
    if (typeof delta.reasoning_content === 'string') reason = delta.reasoning_content;
    else if (typeof delta.reasoning === 'string') reason = delta.reasoning;
    else if (typeof delta.thinking === 'string') reason = delta.thinking;
    return { text: text, reason: reason };
  }

  /**
   * 流式对话
   * @returns {Promise<{content, reasoning, usage, finishReason, aborted}>}
   */
  API.chatStream = async function (opts) {
    const provider = opts.provider;
    const model = opts.model;
    const base = API.normalizeBase(provider.baseUrl);
    if (!base) throw new Error('请先在设置中填写 Base URL');
    if (!model) throw new Error('请先选择模型');

    const timeoutMs = opts.timeoutMs || Store.settings.timeoutMs || 120000;
    const t = withTimeout(timeoutMs);
    const ctl = combineSignal(opts.signal);
    if (t.signal.aborted) ctl.abort();
    else t.signal.addEventListener('abort', () => ctl.abort(), { once: true });

    const body = {
      model: model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature,
      top_p: opts.topP,
      max_tokens: opts.maxTokens,
      presence_penalty: opts.presencePenalty,
      frequency_penalty: opts.frequencyPenalty,
      stream_options: { include_usage: true }
    };
    if (opts.stop) body.stop = opts.stop;
    Object.keys(body).forEach(function (k) {
      if (body[k] === undefined || body[k] === null || body[k] === '') delete body[k];
    });

    async function doFetch(payload) {
      return fetch(base + '/chat/completions', {
        method: 'POST',
        headers: API.buildHeaders(provider),
        body: JSON.stringify(payload),
        signal: ctl.signal
      });
    }

    let res;
    try {
      res = await doFetch(body);
      // 某些服务不支持 stream_options，自动降级重试一次
      if (!res.ok && res.status === 400) {
        const txt = await res.clone().text().catch(() => '');
        if (/stream_options|include_usage/i.test(txt)) {
          const b2 = Object.assign({}, body);
          delete b2.stream_options;
          res = await doFetch(b2);
        }
      }
    } catch (e) {
      t.clear();
      if (ctl.signal.aborted && opts.signal && opts.signal.aborted) {
        return { content: opts.__acc || '', reasoning: opts.__accR || '', aborted: true };
      }
      throw friendlyNetworkError(e, provider);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      t.clear();
      throw new Error(extractError(res.status, txt));
    }
    if (!res.body) {
      t.clear();
      throw new Error('当前浏览器不支持流式读取，请在设置中关闭「流式输出」');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;
    let finishReason = '';

    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim();
          if (!line || line.charAt(0) === ':') continue;
          if (line.indexOf('data:') === 0) line = line.slice(5).trim();
          if (line === '[DONE]') { buffer = ''; continue; }
          let json;
          try { json = JSON.parse(line); } catch (e) { continue; }
          if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
          if (json.usage) usage = json.usage;
          const ch = json.choices && json.choices[0];
          if (!ch) continue;
          if (ch.finish_reason) finishReason = ch.finish_reason;
          const d = pickDelta(ch.delta || ch.message);
          if (d.reason) {
            reasoning += d.reason;
            if (opts.onReasoning) opts.onReasoning(d.reason, reasoning);
          }
          if (d.text) {
            content += d.text;
            if (opts.onDelta) opts.onDelta(d.text, content);
          }
        }
      }
    } catch (e) {
      t.clear();
      if (ctl.signal.aborted || (e && e.name === 'AbortError')) {
        return { content: content, reasoning: reasoning, usage: usage, finishReason: finishReason, aborted: true };
      }
      throw e;
    }
    t.clear();
    return { content: content, reasoning: reasoning, usage: usage, finishReason: finishReason, aborted: false };
  };

  /**
   * 非流式对话
   */
  API.chatOnce = async function (opts) {
    const provider = opts.provider;
    const base = API.normalizeBase(provider.baseUrl);
    if (!base) throw new Error('请先在设置中填写 Base URL');
    const t = withTimeout(opts.timeoutMs || Store.settings.timeoutMs || 120000);
    const ctl = combineSignal(opts.signal);
    const body = {
      model: opts.model,
      messages: opts.messages,
      stream: false,
      temperature: opts.temperature,
      top_p: opts.topP,
      max_tokens: opts.maxTokens,
      presence_penalty: opts.presencePenalty,
      frequency_penalty: opts.frequencyPenalty
    };
    Object.keys(body).forEach(function (k) {
      if (body[k] === undefined || body[k] === null || body[k] === '') delete body[k];
    });
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST', headers: API.buildHeaders(provider), body: JSON.stringify(body), signal: ctl.signal
      });
    } catch (e) {
      t.clear();
      throw friendlyNetworkError(e, provider);
    }
    t.clear();
    const text = await res.text();
    if (!res.ok) throw new Error(extractError(res.status, text));
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('返回内容不是合法 JSON'); }
    const ch = json.choices && json.choices[0];
    const m = ch ? (ch.message || ch.delta || {}) : {};
    return {
      content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('') : ''),
      reasoning: m.reasoning_content || m.reasoning || '',
      usage: json.usage || null,
      finishReason: ch ? ch.finish_reason : ''
    };
  };

  /**
   * 统一入口：根据设置决定流式或非流式
   */
  API.chat = function (opts) {
    const useStream = opts.stream != null ? opts.stream : Store.settings.stream;
    return useStream ? API.chatStream(opts) : API.chatOnce(opts);
  };

  /* ---------- 生成对话标题 ---------- */
  API.generateTitle = async function (provider, model, firstUserText) {
    const clean = String(firstUserText || '').replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length <= 18) return clean || '新对话';
    try {
      const r = await API.chatOnce({
        provider: provider, model: model, temperature: 0.3, maxTokens: 32,
        timeoutMs: 25000,
        messages: [
          { role: 'system', content: '你是一个标题生成器。根据用户的第一句话，生成一个不超过 14 个汉字的简短标题。只输出标题本身，不要标点、引号或任何解释。' },
          { role: 'user', content: clean.slice(0, 800) }
        ]
      });
      let title = (r.content || '').trim().replace(/^["'「【]+|["'」】。.!！]+$/g, '').replace(/\n/g, ' ');
      if (title.length > 24) title = title.slice(0, 24);
      return title || clean.slice(0, 18);
    } catch (e) {
      return clean.slice(0, 18);
    }
  };

  global.API = API;
})(window);
