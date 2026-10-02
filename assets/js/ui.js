/* ===========================================================
   ui.js · 界面逻辑
   =========================================================== */
(function (global) {
  'use strict';

  const UI = {};

  /* ---------------- 内部状态 ---------------- */
  const S = {
    conv: null,
    stream: { active: false, controller: null, convId: null, msgId: null },
    attachments: [],
    recognition: null,
    searchTimer: null,
    editing: null,          // { msgId, index }
    sidebarOpen: false
  };

  UI.S = S;

  const $ = U.$;
  const el = U.el;

  /* ---------------- 参数 ---------------- */
  UI.getParams = function () {
    const p = Store.settings.params || {};
    return {
      temperature: p.temperature != null ? p.temperature : 0.7,
      topP: p.topP != null ? p.topP : 1,
      maxTokens: p.maxTokens || 0,
      presencePenalty: p.presencePenalty != null ? p.presencePenalty : 0,
      frequencyPenalty: p.frequencyPenalty != null ? p.frequencyPenalty : 0
    };
  };

  function convParams(conv) {
    const g = UI.getParams();
    return {
      temperature: conv && conv.temperature != null ? conv.temperature : g.temperature,
      topP: conv && conv.topP != null ? conv.topP : g.topP,
      maxTokens: conv && conv.maxTokens != null ? conv.maxTokens : (g.maxTokens || undefined),
      presencePenalty: g.presencePenalty,
      frequencyPenalty: g.frequencyPenalty
    };
  }

  /* ---------------- 弹窗 ---------------- */
  const Modal = {
    open: function (title, body, foot, opts) {
      opts = opts || {};
      $('#modalTitle').textContent = title;
      const mb = $('#modalBody');
      mb.innerHTML = '';
      if (typeof body === 'string') mb.innerHTML = body;
      else if (body) mb.appendChild(body);
      const mf = $('#modalFoot');
      mf.innerHTML = '';
      (foot || []).forEach(function (n) { if (n) mf.appendChild(n); });
      $('#modal').className = 'modal' + (opts.wide ? ' wide' : '');
      $('#modalMask').classList.add('show');
      Modal.onClose = opts.onClose || null;
      if (opts.maxWidth) $('#modal').style.maxWidth = opts.maxWidth;
      else $('#modal').style.maxWidth = '';
      return mb;
    },
    close: function () {
      $('#modalMask').classList.remove('show');
      $('#modalBody').innerHTML = '';
      $('#modalFoot').innerHTML = '';
      if (Modal.onClose) { try { Modal.onClose(); } catch (e) { } Modal.onClose = null; }
    },
    onClose: null
  };
  UI.Modal = Modal;

  UI.confirm = function (title, message, danger) {
    return new Promise(function (resolve) {
      const body = el('div', {}, [
        el('div', { style: { lineHeight: '1.7', fontSize: '14px', whiteSpace: 'pre-wrap' }, text: message })
      ]);
      const cancel = el('button', { class: 'btn', text: '取消', onclick: function () { Modal.close(); resolve(false); } });
      const ok = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: '确定', onclick: function () { Modal.close(); resolve(true); } });
      Modal.open(title, body, [cancel, ok], { onClose: function () { resolve(false); } });
    });
  };

  UI.prompt = function (title, value, placeholder) {
    return new Promise(function (resolve) {
      const input = el('input', { type: 'text', value: value || '', placeholder: placeholder || '' });
      const body = el('div', { class: 'field' }, [input]);
      const cancel = el('button', { class: 'btn', text: '取消', onclick: function () { Modal.close(); resolve(null); } });
      const ok = el('button', {
        class: 'btn primary', text: '确定', onclick: function () { const v = input.value; Modal.close(); resolve(v); }
      });
      Modal.open(title, body, [cancel, ok], { onClose: function () { resolve(null); } });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
      });
      setTimeout(function () { input.focus(); input.select(); }, 40);
    });
  };

  /* ---------------- 服务商就绪检查 ---------------- */
  function providerReady() {
    const p = Store.getActiveProvider();
    if (!p) { U.toast('请先添加一个模型服务商', 'err'); UI.openSettings('providers'); return null; }
    if (!p.baseUrl) { U.toast('请先填写 ' + p.name + ' 的 Base URL', 'err'); UI.openSettings('providers'); return null; }
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(p.baseUrl);
    if (!p.apiKey && !isLocal) {
      // 允许继续（部分网关无需 Key），仅提示
      U.toast('提示：该服务未填写 API Key', 'err', 2400);
    }
    if (!Store.getActiveModel()) { U.toast('请先选择一个模型', 'err'); return null; }
    return p;
  }

  /* =========================================================
     侧边栏：会话列表
     ========================================================= */
  UI.renderConvList = function () {
    const wrap = $('#convList');
    const q = $('#convSearch').value.trim();
    const list = Store.searchConversations(q);
    wrap.innerHTML = '';
    if (!list.length) {
      wrap.appendChild(el('div', { class: 'empty-tip', text: q ? '没有匹配的对话' : '还没有对话，点击上方「开启新对话」' }));
      return;
    }
    const pinned = list.filter(c => c.pinned);
    const normal = list.filter(c => !c.pinned);
    const mkGroup = function (title, arr, iconName) {
      if (!arr.length) return;
      if (pinned.length && normal.length) {
        wrap.appendChild(el('div', { class: 'sb-group' }, iconName
          ? [icon(iconName), el('span', { text: title })]
          : [el('span', { text: title })]));
      }
      arr.forEach(function (meta) {
        const active = meta.id === Store.activeConvId;
        const node = el('div', { class: 'conv-item' + (active ? ' active' : ''), title: meta.title }, [
          el('div', { class: 'conv-main' }, [
            el('div', { class: 'conv-name' }, [
              meta.pinned ? el('span', { class: 'pin-flag', title: '已置顶' }, [icon('i-pin-fill')]) : null,
              document.createTextNode(meta.title || '新对话')
            ]),
            el('div', { class: 'conv-meta', text: (meta.msgCount || 0) + ' 条 · ' + U.relativeTime(meta.updatedAt || meta.createdAt) })
          ]),
          el('div', { class: 'conv-act' }, [
            el('button', {
              class: 'icon-btn', title: meta.pinned ? '取消置顶' : '置顶',
              onclick: function (e) { e.stopPropagation(); Store.togglePin(meta.id); }
            }, [icon('i-pin')]),
            el('button', {
              class: 'icon-btn', title: '重命名',
              onclick: function (e) {
                e.stopPropagation();
                UI.prompt('重命名对话', meta.title).then(function (v) {
                  if (v != null && v.trim()) {
                    Store.renameConversation(meta.id, v.trim());
                    if (S.conv && S.conv.id === meta.id) { S.conv.title = v.trim(); updateTitle(); }
                  }
                });
              }
            }, [icon('i-edit')]),
            el('button', {
              class: 'icon-btn', title: '删除',
              onclick: function (e) {
                e.stopPropagation();
                UI.confirm('删除对话', '确定删除「' + (meta.title || '新对话') + '」？此操作不可恢复。', true).then(function (ok) {
                  if (!ok) return;
                  const wasActive = Store.activeConvId === meta.id;
                  Store.deleteConversation(meta.id);
                  if (wasActive) UI.selectConv(Store.activeConvId || (Store.convIndex[0] && Store.convIndex[0].id));
                });
              }
            }, [icon('i-trash')])
          ])
        ]);
        node.addEventListener('click', function () { UI.selectConv(meta.id); });
        wrap.appendChild(node);
      });
    };
    mkGroup('已置顶', pinned, 'i-pin-fill');
    mkGroup('最近', normal);
  };

  function icon(name) { return U.icon(name); }
  UI.icon = icon;

  /** 内联图标 + 文字（用于徽标、提示行，替代原先的 emoji 前缀） */
  function iconTag(name, text, cls) {
    return el('span', { class: cls || 'icon-line' }, [icon(name), el('span', { text: text })]);
  }
  UI.iconTag = iconTag;

  /* =========================================================
     顶部：模型选择 / 标题
     ========================================================= */
  UI.renderProviders = function () {
    const sel = $('#selProvider');
    sel.innerHTML = '';
    Store.providers.forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name + (p.apiKey ? '' : ' (未配置)') }));
    });
    sel.value = Store.active.providerId;
    UI.renderModels();
  };

  UI.renderModels = function () {
    const p = Store.getActiveProvider();
    const sel = $('#selModel');
    sel.innerHTML = '';
    if (!p) return;
    const models = (p.models || []).slice();
    const cur = Store.getActiveModel();
    if (cur && models.indexOf(cur) < 0) models.unshift(cur);
    if (!models.length) models.push('');
    models.forEach(function (m) {
      sel.appendChild(el('option', { value: m, text: m || '（请选择模型）' }));
    });
    sel.appendChild(el('option', { value: '__custom__', text: '＋ 手动输入模型名…' }));
    sel.value = cur || models[0];
    if (!cur) sel.value = models[0] || '';
  };

  function updateTitle() {
    const t = $('#chatTitle');
    t.textContent = S.conv ? (S.conv.title || '新对话') : '未选择对话';
  }

  UI.updateCtxBadge = function () {
    if (!S.conv) { $('#ctxBadge').textContent = '0 tok'; return; }
    const visible = (S.conv.messages || []).filter(m => !m.hidden);
    let tokens = U.estimateTokens(Store.settings.systemPrompt || '');
    if (S.conv.systemPrompt) tokens = U.estimateTokens(S.conv.systemPrompt);
    if (S.conv.summary) tokens += U.estimateTokens(S.conv.summary);
    visible.forEach(function (m) { tokens += U.estimateTokens(m.content || '') + 6; });
    const max = Store.settings.maxContextTokens || 32000;
    const pct = Math.min(100, Math.round(tokens / max * 100));
    $('#ctxBadge').textContent = '≈' + tokens + ' tok · ' + pct + '%';
    $('#ctxBadge').title = '当前上下文估算 ≈ ' + tokens + ' tokens（上限 ' + max + '，超出将自动' +
      (Store.settings.contextStrategy === 'summary' ? '摘要压缩' : '裁剪最旧消息') + '）';
  };

  /* =========================================================
     会话切换
     ========================================================= */
  UI.selectConv = function (id) {
    if (!id) { S.conv = null; updateTitle(); UI.renderWelcome(); UI.updateCtxBadge(); UI.renderConvList(); return; }
    const conv = Store.getConversation(id);
    if (!conv) return;
    S.conv = conv;
    Store.setActiveConv(id);
    if (conv.providerId && Store.getProvider(conv.providerId)) Store.setActive(conv.providerId, conv.model || undefined);
    else { conv.providerId = Store.active.providerId; conv.model = Store.getActiveModel(); }
    UI.renderProviders();
    updateTitle();
    UI.renderMessages();
    UI.renderConvList();
    UI.updateCtxBadge();
    closeSidebarOnMobile();
  };

  UI.newChat = function (opts) {
    opts = opts || {};
    if (S.stream.active) { U.toast('正在生成中，请先停止', 'err'); return; }
    if (S.conv && !(S.conv.messages || []).length && !opts.force) {
      // 已有空对话，直接复用
      UI.selectConv(S.conv.id);
      return S.conv;
    }
    const conv = Store.createConversation(opts);
    S.attachments = [];
    UI.renderAttachments();
    UI.selectConv(conv.id);
    setTimeout(function () { $('#input').focus(); }, 60);
    return conv;
  };

  /* =========================================================
     消息渲染
     ========================================================= */
  function scrollToBottom(force) {
    const box = $('#messages');
    if (!box) return;
    if (force || Store.settings.autoScroll) {
      const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
      if (force || near) box.scrollTop = box.scrollHeight;
    }
  }
  UI.scrollToBottom = scrollToBottom;

  UI.renderWelcome = function () {
    const box = $('#messages');
    const p = Store.getActiveProvider();
    const tips = [];
    if (!p || !p.apiKey) tips.push('尚未配置 API Key：点击左下角「设置」→ 模型服务，选择服务商并填入 Key（本地 Ollama 无需 Key）。');
    const examples = [
      { ic: 'i-file-text', t: '解读 README', d: '把项目 README 贴进来并总结', p: '帮我把下面这段 README 解析成结构化笔记：先 3 条 TL;DR，再按模块列出功能点、安装步骤与关键配置项，最后指出可能的坑。\n\n```\n（在此粘贴 README 内容）\n```' },
      { ic: 'i-code', t: '写代码', d: '带注释、可直接运行', p: '用 Python 写一个脚本，功能是：（描述你的需求）。要求代码可直接运行，关键处加注释。' },
      { ic: 'i-chart', t: '对比分析', d: '表格化输出优缺点', p: '请对比 A 与 B，从适用场景、成本、性能、生态四个维度分析，用 Markdown 表格输出，并给出结论建议。' },
      { ic: 'i-globe', t: '翻译润色', d: '中英互译保留格式', p: '把下面的内容翻译成英文，保留 Markdown 结构与专业术语：\n\n（粘贴内容）' }
    ];
    const grid = el('div', { class: 'wc-grid' });
    examples.forEach(function (ex) {
      const card = el('button', { class: 'wc-card' }, [
        el('span', { class: 'wc-ic' }, [icon(ex.ic)]),
        el('span', { class: 'wc-txt' }, [
          el('b', { text: ex.t }),
          el('span', { text: ex.d })
        ])
      ]);
      card.addEventListener('click', function () {
        $('#input').value = ex.p;
        autoGrow();
        $('#input').focus();
      });
      grid.appendChild(card);
    });
    if (Store.convIndex.length) {
      const impCard = el('button', { class: 'wc-card' }, [
        el('span', { class: 'wc-ic' }, [icon('i-inbox')]),
        el('span', { class: 'wc-txt' }, [
          el('b', { text: '导入对话 / 备份' }),
          el('span', { text: 'ChatGPT、Claude 导出文件与 Markdown 记录' })
        ])
      ]);
      impCard.addEventListener('click', function () { UI.openImport(); });
      grid.appendChild(impCard);
    }
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'welcome' }, [
      el('div', { class: 'wc-badge' }, [icon('i-logo'), el('span', { text: 'OpenAI 兼容 · 本地存储' })]),
      el('div', { class: 'wc-title', text: '今天想聊点什么？' }),
      el('div', { class: 'wc-sub', text: '支持 OpenAI 兼容的全部模型：Ollama 本地模型、DeepSeek、GPT、Kimi、GLM、通义千问…' }),
      grid,
      el('div', { class: 'wc-tips' }, [
        el('div', { html: '全部数据保存在浏览器本地 · <span class="kbd">Ctrl</span>+<span class="kbd">K</span> 搜索对话 · <span class="kbd">Ctrl</span>+<span class="kbd">/</span> 快捷键' }),
        tips.length ? (function () {
          const line = el('div', { class: 'wc-warn' }, [icon('i-alert'), el('span', { text: tips[0] })]);
          return line;
        })() : null
      ])
    ]));
  };

  UI.renderMessages = function () {
    const box = $('#messages');
    if (!S.conv || !(S.conv.messages || []).length) { UI.renderWelcome(); return; }
    box.innerHTML = '';
    const wrap = el('div', { class: 'msg-wrap' });
    S.conv.messages.forEach(function (m, i) { wrap.appendChild(buildMessageNode(m, i)); });
    box.appendChild(wrap);
    scrollToBottom(true);
  };

  /** 助手头像图标：跟随当前对话使用的助手预设，否则用通用图标 */
  function assistantIconOf(conv) {
    if (conv && conv.assistantId) {
      const a = Store.getAssistant(conv.assistantId);
      if (a && a.icon) return a.icon;
    }
    return 'i-bot';
  }

  function buildMessageNode(m, index) {
    const isUser = m.role === 'user';
    const node = el('div', {
      class: 'msg ' + m.role + (m.error ? ' error' : ''),
      data: { mid: m.id, index: index }
    });

    const avatar = el('div', { class: 'msg-avatar', title: isUser ? '你' : '助手' }, [
      icon(isUser ? 'i-user' : assistantIconOf(S.conv))
    ]);

    const actions = el('div', { class: 'msg-actions' });
    actions.appendChild(actBtn('i-copy', '复制内容', function () { copyMessage(m); }));
    if (!isUser) actions.appendChild(actBtn('i-volume', '朗读', function () { speak(m.content || ''); }));
    actions.appendChild(actBtn('i-edit', '编辑', function () { startEdit(m, node); }));
    if (!isUser) actions.appendChild(actBtn('i-refresh', '重新生成', function () { regenerateFrom(m.id); }));
    actions.appendChild(actBtn('i-trash', '删除', function () { deleteMessage(m.id); }));

    const head = el('div', { class: 'msg-head' }, [
      el('span', { class: 'msg-role', text: isUser ? '你' : '助手' }),
      !isUser && m.model ? el('span', { class: 'msg-tag', text: m.model }) : null,
      m.aborted ? el('span', { class: 'msg-tag', text: '已停止' }) : null,
      el('span', { class: 'msg-time', text: U.formatTime(m.createdAt || Date.now()) }),
      actions
    ]);

    const body = el('div', { class: 'msg-body' }, [head]);

    if (m.images && m.images.length) {
      const imgs = el('div', { class: 'msg-images' });
      m.images.forEach(function (im) {
        const img = el('img', { src: im.dataUrl, alt: im.name || 'image' });
        img.addEventListener('click', function () { UI.viewImage(im.dataUrl); });
        imgs.appendChild(img);
      });
      body.appendChild(imgs);
    }
    if (m.files && m.files.length) {
      const fl = el('div', { class: 'msg-images' });
      m.files.forEach(function (f) {
        fl.appendChild(el('div', { class: 'attach-chip', title: f.name }, [
          icon('i-copy'),
          el('span', { class: 'nm', text: f.name })
        ]));
      });
      body.appendChild(fl);
    }

    if (!isUser && (m.reasoning || m.streamingReason)) {
      body.appendChild(buildReasonNode(m));
    }

    const contentNode = el('div', { class: 'md' });
    if (isUser) {
      const bubble = el('div', { class: 'user-bubble' }, [contentNode]);
      body.appendChild(bubble);
    } else {
      body.appendChild(contentNode);
    }
    fillContent(m, contentNode);

    if (m.error) {
      body.appendChild(el('div', { class: 'msg-usage err-line' }, [icon('i-alert'), el('span', { text: m.error })]));
    } else if (m.usage && !isUser) {
      const u = m.usage;
      const parts = [];
      if (u.prompt_tokens != null) parts.push('输入 ' + u.prompt_tokens);
      if (u.completion_tokens != null) parts.push('输出 ' + u.completion_tokens);
      if (u.total_tokens != null) parts.push('合计 ' + u.total_tokens);
      if (m.duration) parts.push((m.duration / 1000).toFixed(1) + 's');
      if (parts.length) body.appendChild(el('div', { class: 'msg-usage', text: parts.join(' · ') }));
    }

    node.appendChild(avatar);
    node.appendChild(body);
    return node;
  }

  function actBtn(iconName, title, fn) {
    const b = el('button', { class: 'icon-btn', title: title, onclick: function (e) { e.stopPropagation(); fn(); } }, [icon(iconName)]);
    return b;
  }

  function fillContent(m, node) {
    if (m.role === 'user') {
      if (S.editing && S.editing.msgId === m.id) return;
      node.innerHTML = MD.plainToHtml(m.content || '');
      return;
    }
    MD.renderTo(node, m.content || '', { streaming: !!m.streaming });
    if (m.streaming) {
      node.classList.add('cursor-blink');
      if (!m.content) {
        node.innerHTML = '<span class="think-dots"><i></i><i></i><i></i></span> <span style="color:var(--text-mute);font-size:13px">正在思考…</span>';
      }
    } else {
      node.classList.remove('cursor-blink');
    }
  }

  function buildReasonNode(m) {
    const box = el('div', { class: 'reason-box' + (m.reasonOpen ? '' : ' closed') });
    const head = el('div', { class: 'reason-head' }, [
      icon('i-brain'),
      el('span', { text: m.streaming ? '思考中…' : '已深度思考' }),
      el('span', { class: 'spacer', style: { flex: '1' } }),
      el('span', { class: 'msg-tag', text: '点击展开/收起' })
    ]);
    const body = el('div', { class: 'reason-body', text: m.reasoning || '' });
    head.addEventListener('click', function () {
      box.classList.toggle('closed');
      m.reasonOpen = !box.classList.contains('closed');
    });
    if (m.streaming) box.classList.remove('closed');
    box.appendChild(head);
    box.appendChild(body);
    return box;
  }

  function getMsgNode(id) { return document.querySelector('.msg[data-mid="' + id + '"]'); }

  function updateMsgNode(m) {
    const node = getMsgNode(m.id);
    if (!node) return;
    const mdNode = node.querySelector('.md');
    const isUser = m.role === 'user';
    if (mdNode) fillContent(m, mdNode);
    let rbox = node.querySelector('.reason-box');
    if ((m.reasoning || m.streamingReason) && !isUser) {
      if (!rbox) {
        const head = node.querySelector('.msg-head');
        rbox = buildReasonNode(m);
        head.parentNode.insertBefore(rbox, node.querySelector('.msg-images') ? node.querySelector('.msg-images').nextSibling : head.nextSibling);
      } else {
        const rb = rbox.querySelector('.reason-body');
        if (rb) rb.textContent = m.reasoning || '';
        const t = rbox.querySelector('.reason-head span');
        if (t) t.textContent = m.streaming ? '思考中…' : '已深度思考';
      }
    }
    if (m.error) {
      node.classList.add('error');
      let e = node.querySelector('.err-line');
      if (!e) {
        e = el('div', { class: 'msg-usage err-line' }, [icon('i-alert'), el('span')]);
        node.querySelector('.msg-body').appendChild(e);
      }
      const t = e.querySelector('span');
      if (t) t.textContent = m.error;
    }
  }

  /* ---------------- 消息操作 ---------------- */
  function copyMessage(m) {
    U.copy(m.content || '').then(function (ok) { if (ok) U.toast('已复制到剪贴板', 'ok'); });
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) { U.toast('当前浏览器不支持语音朗读', 'err'); return; }
    const clean = String(text || '')
      .replace(/```[\s\S]*?```/g, '（代码块）')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~|-]/g, '')
      .replace(/\n{2,}/g, '\n');
    if (!clean.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean.slice(0, 3000));
    const voices = window.speechSynthesis.getVoices() || [];
    let v = voices.find(x => x.name === Store.settings.ttsVoice);
    if (!v) v = voices.find(x => /zh[-_]?CN|Chinese|中文/i.test(x.lang + ' ' + x.name));
    if (v) u.voice = v;
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
    U.toast('开始朗读');
  }

  function startEdit(m, node) {
    const body = node.querySelector('.msg-body');
    const target = m.role === 'user' ? node.querySelector('.user-bubble') : node.querySelector('.md');
    if (!target) return;
    const ta = el('textarea', { class: 'edit-area' });
    ta.value = m.content || '';
    ta.style.cssText = 'width:100%;min-height:90px;border-radius:10px;border:1px solid var(--border);background:var(--bg-input);padding:10px;line-height:1.6;resize:vertical;outline:none';
    target.replaceWith(ta);
    ta.focus();
    ta.style.height = Math.min(400, Math.max(90, ta.scrollHeight)) + 'px';

    const bar = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' } });
    const cancel = el('button', { class: 'btn sm', text: '取消', onclick: function () { UI.renderMessages(); } });
    const save = el('button', { class: 'btn sm primary', text: m.role === 'user' ? '保存并重新发送' : '保存', onclick: function () { doSave(); } });
    bar.appendChild(cancel); bar.appendChild(save);
    body.appendChild(bar);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); UI.renderMessages(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
    });

    function doSave() {
      const v = ta.value;
      m.content = v;
      const idx = S.conv.messages.findIndex(x => x.id === m.id);
      if (m.role === 'user') {
        // 截断该条之后的所有消息，重新生成
        S.conv.messages = S.conv.messages.slice(0, idx + 1);
        S.conv.summary = '';
        S.conv.summaryCovers = 0;
        Store.saveConversation(S.conv);
        UI.renderMessages();
        runGeneration();
      } else {
        Store.saveConversation(S.conv);
        UI.renderMessages();
      }
    }
  }

  function deleteMessage(id) {
    const idx = S.conv.messages.findIndex(x => x.id === id);
    if (idx < 0) return;
    S.conv.messages.splice(idx, 1);
    Store.saveConversation(S.conv);
    UI.renderMessages();
    UI.updateCtxBadge();
    U.toast('已删除该条消息');
  }

  function regenerateFrom(id) {
    if (S.stream.active) { U.toast('正在生成中，请先停止', 'err'); return; }
    const idx = S.conv.messages.findIndex(x => x.id === id);
    if (idx < 0) return;
    S.conv.messages = S.conv.messages.slice(0, idx);
    Store.saveConversation(S.conv);
    UI.renderMessages();
    runGeneration();
  }

  UI.viewImage = function (src) {
    let v = document.querySelector('.viewer');
    if (!v) {
      v = el('div', { class: 'viewer', onclick: function () { v.classList.remove('show'); } }, [el('img', {})]);
      document.body.appendChild(v);
    }
    v.querySelector('img').src = src;
    v.classList.add('show');
  };

  /* =========================================================
     附件
     ========================================================= */
  UI.renderAttachments = function () {
    const bar = $('#attachBar');
    bar.innerHTML = '';
    S.attachments.forEach(function (a, i) {
      const chip = el('div', { class: 'attach-chip' }, [
        a.type === 'image' ? el('img', { src: a.dataUrl }) : icon('i-copy'),
        el('span', { class: 'nm', text: a.name }),
        el('button', { title: '移除', onclick: function () { S.attachments.splice(i, 1); UI.renderAttachments(); } }, [icon('i-close')])
      ]);
      bar.appendChild(chip);
    });
  };

  async function handleFiles(files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > 3 * 1024 * 1024 * 20) { U.toast('文件过大：' + f.name, 'err'); continue; }
      if (/^image\//.test(f.type)) {
        const r = await U.compressImage(f, 1280, 0.82);
        S.attachments.push({ type: 'image', name: f.name, dataUrl: r.dataUrl, w: r.w, h: r.h });
      } else if (f.size < 1024 * 1024) {
        try {
          const text = await U.readAsText(f);
          S.attachments.push({ type: 'file', name: f.name, text: text.slice(0, 200000), size: f.size });
        } catch (e) { U.toast('读取失败：' + f.name, 'err'); }
      } else {
        U.toast('仅支持 1MB 以内的文本文件：' + f.name, 'err');
      }
    }
    UI.renderAttachments();
  }

  /* =========================================================
     生成
     ========================================================= */
  function setSending(on) {
    const btn = $('#btnSend');
    btn.classList.toggle('stop', on);
    btn.innerHTML = '';
    btn.appendChild(icon(on ? 'i-stop' : 'i-send'));
    btn.title = on ? '停止生成' : '发送';
    $('#input').disabled = false;
  }

  UI.stopStream = function () {
    if (S.stream.controller) S.stream.controller.abort();
    S.stream.active = false;
    setSending(false);
    U.toast('已停止生成');
  };

  async function runGeneration(opts) {
    opts = opts || {};
    const conv = S.conv;
    if (!conv) return;
    const provider = Store.getProvider(conv.providerId) || Store.getActiveProvider();
    if (!provider || !provider.baseUrl) { providerReady(); return; }
    const model = conv.model || Store.getActiveModel();
    if (!model) { U.toast('请先选择模型', 'err'); return; }

    const visible = conv.messages.filter(m => !m.hidden);
    const lastUser = visible.slice().reverse().find(m => m.role === 'user');
    const ctx = Memory.buildContext(conv, lastUser ? lastUser.content : '');

    const amsg = {
      id: U.uid('msg'), role: 'assistant', content: '', reasoning: '',
      model: model, providerId: provider.id, createdAt: Date.now(), streaming: true
    };
    conv.messages.push(amsg);

    // 渲染
    if (S.conv === conv) {
      const box = $('#messages');
      let wrap = box.querySelector('.msg-wrap');
      if (!wrap) { UI.renderMessages(); wrap = box.querySelector('.msg-wrap'); }
      wrap.appendChild(buildMessageNode(amsg, conv.messages.length - 1));
      scrollToBottom(true);
    }

    S.stream.active = true;
    S.stream.controller = new AbortController();
    S.stream.convId = conv.id;
    S.stream.msgId = amsg.id;
    setSending(true);

    const p = convParams(conv);
    const t0 = Date.now();

    const repaint = U.throttle(function () {
      if (S.conv === conv) { updateMsgNode(amsg); scrollToBottom(false); }
      else { amsg.streaming = true; }
    }, 90);

    try {
      const res = await API.chat({
        provider: provider,
        model: model,
        messages: ctx.messages,
        signal: S.stream.controller.signal,
        temperature: p.temperature,
        topP: p.topP,
        maxTokens: p.maxTokens || undefined,
        presencePenalty: p.presencePenalty || undefined,
        frequencyPenalty: p.frequencyPenalty || undefined,
        onDelta: function (d, full) { amsg.content = full; repaint(); },
        onReasoning: function (d, full) { amsg.reasoning = full; repaint(); }
      });
      amsg.content = res.content || amsg.content;
      amsg.reasoning = res.reasoning || amsg.reasoning;
      if (res.usage) amsg.usage = res.usage;
      if (res.aborted) amsg.aborted = true;
      if (!amsg.content && !amsg.reasoning) {
        amsg.content = '（模型没有返回内容，可能是内容被安全策略拦截，或该模型不支持当前请求格式）';
      }
    } catch (e) {
      amsg.error = (e && e.message) ? e.message : String(e);
      if (!amsg.content) amsg.content = '';
    } finally {
      amsg.streaming = false;
      amsg.duration = Date.now() - t0;
      S.stream.active = false;
      S.stream.controller = null;
      setSending(false);
      Store.saveConversation(conv);
      Memory.markUsed(ctx.memoryIds);
      if (S.conv === conv) {
        UI.renderMessages();
        UI.updateCtxBadge();
        UI.renderConvList();
      }

      // 自动朗读
      if (Store.settings.ttsAuto && amsg.content && !amsg.error && !amsg.aborted) {
        speak(amsg.content);
      }

      // 自动标题
      if (!opts.noTitle && Store.settings.autoTitle && conv.title === '新对话') {
        const firstUser = conv.messages.find(m => m.role === 'user');
        if (firstUser) {
          const quick = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 20) || '新对话';
          conv.title = quick;
          Store.saveConversation(conv);
          if (S.conv === conv) { updateTitle(); UI.renderConvList(); }
          API.generateTitle(provider, model, firstUser.content).then(function (t) {
            if (t && t.trim()) {
              conv.title = t.trim();
              Store.saveConversation(conv);
              if (S.conv === conv) { updateTitle(); UI.renderConvList(); }
            }
          });
        }
      }

      // 自动抽取长期记忆
      if (Store.settings.memoryEnabled && Store.settings.memoryAutoExtract && !opts.noMemory) {
        Memory.autoExtract(conv, provider, model).then(function (added) {
          if (added && added.length) {
            U.toast('已自动记录 ' + added.length + ' 条长期记忆', 'ok');
            updateMemDot();
          }
        }).catch(function () { });
      }

      // 自动上下文压缩
      if (Store.settings.contextStrategy === 'summary' && ctx.estTokens > (Store.settings.maxContextTokens || 32000) * 0.9) {
        Memory.summarize(conv, provider, model).then(function (r) {
          U.toast('上下文已自动压缩为摘要', 'ok');
          UI.updateCtxBadge();
        }).catch(function () { });
      }
    }
  }

  UI.runGeneration = runGeneration;

  /* =========================================================
     发送
     ========================================================= */
  async function doSend(textOverride) {
    if (S.stream.active) { UI.stopStream(); return; }
    if (!S.conv) UI.newChat();
    const input = $('#input');
    const text = (textOverride != null ? textOverride : input.value).trim();
    const atts = S.attachments.slice();
    if (!text && !atts.length) return;
    if (!providerReady()) return;

    const images = atts.filter(a => a.type === 'image').map(a => ({ dataUrl: a.dataUrl, name: a.name, w: a.w, h: a.h }));
    const files = atts.filter(a => a.type === 'file').map(a => ({ name: a.name, text: a.text, size: a.size }));
    if (!Store.settings.saveImages) images.length = 0;

    const msg = {
      id: U.uid('msg'), role: 'user', content: text,
      images: images, files: files, createdAt: Date.now()
    };
    S.conv.messages.push(msg);
    if (S.conv.title === '新对话') {
      S.conv.title = text.replace(/\s+/g, ' ').slice(0, 20) || '新对话';
      updateTitle();
    }
    Store.saveConversation(S.conv);

    input.value = '';
    autoGrow();
    S.attachments = [];
    UI.renderAttachments();
    $('#input').focus();

    if (S.conv.messages.length === 1) UI.renderMessages();
    else {
      const wrap = $('#messages').querySelector('.msg-wrap');
      if (wrap) wrap.appendChild(buildMessageNode(msg, S.conv.messages.length - 1));
      else UI.renderMessages();
    }
    scrollToBottom(true);
    UI.updateCtxBadge();
    UI.renderConvList();

    runGeneration();
  }

  /* 输入框自适应高度 */
  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(220, t.scrollHeight) + 'px';
  }
  UI.autoGrow = autoGrow;

  /* =========================================================
     设置弹窗
     ========================================================= */
  function switchRow(label, desc, checked, onChange) {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    return el('div', { class: 'switch-row' }, [
      el('div', { class: 'sw-txt' }, [el('b', { text: label }), el('span', { text: desc })]),
      el('label', { class: 'switch' }, [input, el('i')])
    ]);
  }
  UI.switchRow = switchRow;

  UI.openSettings = function (tab) {
    const body = el('div');
    const tabsWrap = el('div', { class: 'tabs' });
    const panels = {};
    const TABS = [
      ['providers', '模型服务'],
      ['general', '通用'],
      ['memory', '记忆'],
      ['prompt', '提示词'],
      ['data', '数据'],
      ['about', '关于']
    ];
    TABS.forEach(function (t) {
      const b = el('button', { class: 'tab' + (t[0] === (tab || 'providers') ? ' on' : ''), text: t[1] });
      const p = el('div', { class: 'tab-panel' + (t[0] === (tab || 'providers') ? ' on' : '') });
      panels[t[0]] = p;
      b.addEventListener('click', function () {
        U.$$('.tab', tabsWrap).forEach(x => x.classList.remove('on'));
        Object.keys(panels).forEach(k => panels[k].classList.remove('on'));
        b.classList.add('on');
        p.classList.add('on');
      });
      tabsWrap.appendChild(b);
      body.appendChild(p);
    });
    body.insertBefore(tabsWrap, body.firstChild);

    buildProvidersPanel(panels.providers);
    buildGeneralPanel(panels.general);
    buildMemoryPanel(panels.memory);
    buildPromptPanel(panels.prompt);
    buildDataPanel(panels.data);
    buildAboutPanel(panels.about);

    const close = el('button', { class: 'btn', text: '关闭', onclick: function () { Modal.close(); } });
    Modal.open('设置', body, [close], { wide: true });
  };

  function buildProvidersPanel(p) {
    p.innerHTML = '';
    const listWrap = el('div');
    function renderList() {
      listWrap.innerHTML = '';
      Store.providers.forEach(function (pr) {
        const active = pr.id === Store.active.providerId;
        const item = el('div', { class: 'list-item' + (active ? ' active' : '') }, [
          el('div', { class: 'li-main' }, [
            el('b', {}, [document.createTextNode(pr.name), pr.apiKey ? el('span', { class: 'msg-tag', text: '已配置 Key' }) : el('span', { class: 'msg-tag', text: '无 Key' })]),
            el('span', { text: (pr.baseUrl || '未填写地址') + ' · ' + (pr.models || []).length + ' 个模型' })
          ]),
          el('button', { class: 'btn sm', text: active ? '使用中' : '切换', onclick: function () { Store.setActive(pr.id); UI.renderProviders(); renderList(); } }),
          el('button', { class: 'btn sm', text: '编辑', onclick: function () { editProvider(pr); } }),
          pr.builtin ? null : el('button', {
            class: 'btn sm danger', text: '删除',
            onclick: function () { Store.removeProvider(pr.id); UI.renderProviders(); renderList(); }
          })
        ]);
        listWrap.appendChild(item);
      });
    }

    function editProvider(pr) {
      const nameI = el('input', { type: 'text', value: pr.name });
      const urlI = el('input', { type: 'text', value: pr.baseUrl, placeholder: 'https://api.example.com/v1' });
      const keyI = el('input', { type: 'password', value: pr.apiKey, placeholder: 'sk-...' });
      const modelsI = el('textarea', { placeholder: '每行一个模型名' });
      modelsI.value = (pr.models || []).join('\n');
      const hdrI = el('textarea', { placeholder: '{"X-Custom-Header":"value"}' });
      hdrI.value = pr.headers && Object.keys(pr.headers).length ? JSON.stringify(pr.headers, null, 2) : '';
      const status = el('div', { class: 'hint status-line' });
      const setStatus = function (iconName, text, tone) {
        status.className = 'hint status-line' + (tone ? ' ' + tone : '');
        status.innerHTML = '';
        if (iconName) status.appendChild(icon(iconName));
        status.appendChild(el('span', { text: text }));
      };

      const body = el('div', {}, [
        el('div', { class: 'field' }, [el('label', { text: '显示名称' }), nameI]),
        el('div', { class: 'field' }, [el('label', { text: 'Base URL（OpenAI 兼容，一般以 /v1 结尾）' }), urlI,
          el('div', { class: 'hint', text: '本页会自动补全 /v1 与 /chat/completions。本地 Ollama：http://localhost:11434/v1' })]),
        el('div', { class: 'field' }, [el('label', { text: 'API Key' }), keyI,
          el('div', { class: 'hint', text: '仅保存在你的浏览器 localStorage 中，不会上传到任何第三方服务器。' })]),
        el('div', { class: 'field' }, [el('label', { text: '模型列表（每行一个）' }), modelsI]),
        el('div', { class: 'field' }, [el('label', { text: '附加请求头（JSON，可留空）' }), hdrI]),
        status
      ]);

      const testBtn = el('button', {
        class: 'btn', text: '测试并拉取模型', onclick: async function () {
          setStatus('', '正在请求…', '');
          try {
            const tmp = { id: 'tmp', baseUrl: urlI.value, apiKey: keyI.value, headers: parseHeaders(hdrI.value) };
            const ids = await API.listModels(tmp);
            if (ids.length) {
              modelsI.value = ids.join('\n');
              setStatus('i-check-circle', '连接成功，已拉取 ' + ids.length + ' 个模型', 'ok');
            } else {
              setStatus('i-check-circle', '连接成功，但未返回模型列表，请手动填写模型名', 'ok');
            }
          } catch (e) {
            setStatus('i-x-circle', e.message, 'err');
          }
        }
      });
      const save = el('button', {
        class: 'btn primary', text: '保存', onclick: function () {
          const models = modelsI.value.split('\n').map(s => s.trim()).filter(Boolean);
          Store.updateProvider(pr.id, {
            name: nameI.value.trim() || pr.name,
            baseUrl: urlI.value.trim(),
            apiKey: keyI.value,
            models: models,
            headers: parseHeaders(hdrI.value)
          });
          U.toast('已保存', 'ok');
          UI.renderProviders();
          renderList();
          Modal.close();
          if (!S.conv || !S.conv.messages.length) UI.renderWelcome();
        }
      });
      const cancel = el('button', { class: 'btn', text: '返回', onclick: function () { openSettings2(); } });
      Modal.open('编辑服务商 · ' + pr.name, body, [cancel, testBtn, save]);
    }

    function parseHeaders(text) {
      if (!text || !text.trim()) return {};
      try { return JSON.parse(text); } catch (e) { U.toast('请求头不是合法 JSON，已忽略', 'err'); return {}; }
    }

    function openSettings2() { UI.openSettings('providers'); }

    const addBtn = el('button', {
      class: 'btn', text: '＋ 添加自定义服务商', onclick: function () {
        const np = Store.addProvider({ name: '我的服务', baseUrl: '', models: [] });
        UI.renderProviders();
        renderList();
        editProvider(np);
      }
    });

    p.appendChild(el('div', { class: 'hint', style: { marginBottom: '12px', lineHeight: '1.8' } }, [
      el('span', { html: '所有服务商都使用 <b>OpenAI 兼容协议</b>（<code>/v1/models</code> 与 <code>/v1/chat/completions</code>）。若浏览器直连报跨域错误，请改用支持 CORS 的中转地址。' })
    ]));
    p.appendChild(listWrap);
    p.appendChild(el('div', { style: { marginTop: '10px' } }, [addBtn]));
    renderList();
  }

  function buildGeneralPanel(p) {
    p.innerHTML = '';
    const s = Store.settings;
    p.appendChild(switchRow('流式输出', '逐字返回，体验更好（部分网关不支持时可关闭）', s.stream, v => Store.saveSettings({ stream: v })));
    p.appendChild(switchRow('Enter 发送', '关闭后使用 Ctrl+Enter 发送', s.sendOnEnter, v => Store.saveSettings({ sendOnEnter: v })));
    p.appendChild(switchRow('显示思考过程', '推理模型（如 DeepSeek-R1）会输出思维链', s.showReasoning, v => Store.saveSettings({ showReasoning: v })));
    p.appendChild(switchRow('自动生成标题', '用模型为对话生成简短标题', s.autoTitle, v => Store.saveSettings({ autoTitle: v })));
    p.appendChild(switchRow('自动滚动到底部', '生成过程中跟随最新内容', s.autoScroll, v => Store.saveSettings({ autoScroll: v })));
    p.appendChild(switchRow('保存图片附件', '关闭后图片仅在本次发送使用，不写入本地存储', s.saveImages, v => Store.saveSettings({ saveImages: v })));
    p.appendChild(switchRow('自动朗读回复', '助手回答完成后自动语音朗读', s.ttsAuto, v => {
      Store.saveSettings({ ttsAuto: v });
      if (v && !('speechSynthesis' in window)) U.toast('当前浏览器不支持语音合成', 'err');
    }));

    const themeSel = el('select', {}, [
      el('option', { value: 'dark', text: '深色' }),
      el('option', { value: 'light', text: '浅色' })
    ]);
    themeSel.value = s.theme === 'light' ? 'light' : 'dark';
    themeSel.addEventListener('change', function () { applyTheme(themeSel.value); });
    p.appendChild(el('div', { class: 'field', style: { marginTop: '12px' } }, [el('label', { text: '主题' }), themeSel]));

    const fsInput = el('input', { type: 'range', min: 13, max: 19, step: 1, value: s.fontSize || 15 });
    const fsVal = el('span', { class: 'val', text: (s.fontSize || 15) + ' px' });
    fsInput.addEventListener('input', function () {
      fsVal.textContent = fsInput.value + ' px';
      Store.saveSettings({ fontSize: +fsInput.value });
      applyFontSize();
    });
    p.appendChild(el('div', { class: 'field' }, [el('label', { text: '正文字号' }), el('div', { class: 'range-row' }, [fsInput, fsVal])]));

    const maxTok = el('input', { type: 'number', min: 2000, step: 1000, value: s.maxContextTokens });
    maxTok.addEventListener('change', function () {
      Store.saveSettings({ maxContextTokens: Math.max(2000, +maxTok.value || 32000) });
      UI.updateCtxBadge();
    });
    const strat = el('select', {}, [
      el('option', { value: 'trim', text: '裁剪最旧消息（快，不额外消耗 token）' }),
      el('option', { value: 'summary', text: '自动摘要压缩（保留信息更多，需调用模型）' })
    ]);
    strat.value = s.contextStrategy || 'trim';
    strat.addEventListener('change', function () { Store.saveSettings({ contextStrategy: strat.value }); });
    p.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '上下文预算（tokens）' }), maxTok,
      el('div', { class: 'hint', text: '超出预算后按下方策略处理。此数字仅为本地估算，不发送给模型。' })
    ]));
    p.appendChild(el('div', { class: 'field' }, [el('label', { text: '超长上下文处理策略' }), strat]));

    const to = el('input', { type: 'number', min: 10000, step: 5000, value: s.timeoutMs || 120000 });
    to.addEventListener('change', function () { Store.saveSettings({ timeoutMs: Math.max(10000, +to.value || 120000) }); });
    p.appendChild(el('div', { class: 'field' }, [el('label', { text: '单次请求超时（毫秒）' }), to]));
  }

  function buildMemoryPanel(p) {
    p.innerHTML = '';
    const s = Store.settings;
    p.appendChild(switchRow('启用长期记忆', '把用户的稳定偏好注入每次对话的系统提示', s.memoryEnabled, v => {
      Store.saveSettings({ memoryEnabled: v }); updateMemDot();
    }));
    p.appendChild(switchRow('自动提取记忆', '每几轮对话后自动让模型总结用户偏好并保存', s.memoryAutoExtract, v => Store.saveSettings({ memoryAutoExtract: v })));

    const topk = el('input', { type: 'number', min: 1, max: 20, value: s.memoryTopK });
    topk.addEventListener('change', function () { Store.saveSettings({ memoryTopK: Math.max(1, Math.min(20, +topk.value || 6)) }); });
    const maxc = el('input', { type: 'number', min: 200, step: 100, value: s.memoryMaxChars });
    maxc.addEventListener('change', function () { Store.saveSettings({ memoryMaxChars: Math.max(200, +maxc.value || 2000) }); });
    p.appendChild(el('div', { class: 'field', style: { marginTop: '12px' } }, [
      el('label', { text: '每次注入的最大记忆条数 / 字符数' }),
      el('div', { class: 'row' }, [topk, maxc])
    ]));
    p.appendChild(el('div', { class: 'field' }, [
      el('button', { class: 'btn', text: '打开记忆管理器', onclick: function () { UI.openMemory(); } }),
      document.createTextNode(' '),
      el('button', {
        class: 'btn', text: '从当前对话提取记忆', onclick: async function () {
          if (!S.conv) return;
          const pr = Store.getActiveProvider();
          try {
            U.toast('正在分析对话…');
            const added = await Memory.autoExtract(S.conv, pr, S.conv.model || Store.getActiveModel(), true);
            U.toast(added.length ? ('已提取 ' + added.length + ' 条记忆') : '没有发现值得记录的内容', added.length ? 'ok' : '');
            updateMemDot();
          } catch (e) { U.toast('提取失败：' + e.message, 'err'); }
        }
      })
    ]));
    const mFmt = el('select', { style: { width: 'auto', flex: 'none' } });
    Memory.formats().forEach(function (f) { mFmt.appendChild(el('option', { value: f.key, text: f.label })); });
    p.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '记忆备份与迁移' }),
      el('div', { class: 'chip-row' }, [
        mFmt,
        el('button', {
          class: 'btn sm', text: '导出记忆', onclick: function () {
            const r = Memory.exportAs(mFmt.value);
            if (!r.count) { U.toast('还没有记忆可以导出', 'err'); return; }
            U.download(r.filename, r.content, r.mime);
            U.toast('已导出 ' + r.count + ' 条记忆（' + r.format.toUpperCase() + '）', 'ok');
          }
        }),
        el('button', {
          class: 'btn sm', text: '从文件导入记忆', onclick: function () {
            const inp = el('input', { type: 'file', accept: '.json,.md,.markdown,.txt,.csv' });
            inp.addEventListener('change', async function () {
              if (!inp.files[0]) return;
              try {
                const txt = await U.readAsText(inp.files[0]);
                const res = Memory.importFromText(txt, inp.files[0].name);
                updateMemDot();
                U.toast(res.parsed === 0 ? '没有解析到有效的记忆内容'
                  : ('导入完成：新增 ' + res.added + ' 条' + (res.skipped ? '，跳过 ' + res.skipped + ' 条' : '')), 'ok', 3200);
              } catch (e) { U.toast('导入失败：' + e.message, 'err'); }
            });
            inp.click();
          }
        })
      ]),
      el('div', { class: 'hint', text: '支持 JSON / Markdown / 纯文本 / CSV 互导，可用于换浏览器、换设备或团队间共享记忆库。' })
    ]));
    p.appendChild(el('div', { class: 'hint', text: '记忆只保存在本地。注入内容以「关于用户的长期记忆」小节附加在系统提示末尾，不会修改你的原始系统提示词。' }));
  }

  function buildPromptPanel(p) {
    p.innerHTML = '';
    const ta = el('textarea', { style: { minHeight: '150px' } });
    ta.value = Store.settings.systemPrompt || '';
    const saveBtn = el('button', {
      class: 'btn primary sm', text: '保存系统提示词', onclick: function () {
        Store.saveSettings({ systemPrompt: ta.value });
        U.toast('已保存', 'ok');
        UI.updateCtxBadge();
      }
    });
    p.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '全局系统提示词' }), ta,
      el('div', { class: 'hint', text: '每个对话也可单独覆盖：在「模型参数」弹窗中修改。' })
    ]));
    const presets = [
      ['默认助手', '你是一个乐于助人的 AI 助手。回答准确、简洁、有条理，使用 Markdown 排版；代码放在带语言标注的代码块中。'],
      ['严谨工程师', '你是一位严谨的资深工程师。回答前先澄清不确定的信息；给出可运行代码；指出边界条件与风险；不臆测 API。'],
      ['苏格拉底导师', '你是一位启发式导师。不要直接给出最终答案，而是通过提问与提示引导用户自己推导，最后再给出总结。'],
      ['极简模式', '只给出答案本身，不要寒暄、不要总结、不要复述问题。'],
      ['中英双语', '先用中文回答，然后在下方用英文给出同样内容的精炼版本。']
    ];
    const chips = el('div', { class: 'chip-row' });
    presets.forEach(function (pp) {
      chips.appendChild(el('button', {
        class: 'chip', text: pp[0], onclick: function () { ta.value = pp[1]; }
      }));
    });
    p.appendChild(el('div', { class: 'field' }, [el('label', { text: '快速预设' }), chips]));
    p.appendChild(el('div', {}, [saveBtn, document.createTextNode(' '),
      el('button', { class: 'btn sm', text: '恢复默认', onclick: function () { ta.value = Store.DEFAULT_SETTINGS.systemPrompt; } })]));
  }

  function buildDataPanel(p) {
    p.innerHTML = '';
    const u = Store.usage();
    const pct = Math.min(100, Math.round(u.bytes / u.quota * 100));
    p.appendChild(el('div', { class: 'field' }, [
      el('label', { text: '本地存储占用' }),
      el('div', { style: { height: '8px', borderRadius: '6px', background: 'var(--bg-hover)', overflow: 'hidden' } }, [
        el('div', { style: { width: pct + '%', height: '100%', background: pct > 80 ? 'var(--danger)' : 'var(--accent)' } })
      ]),
      el('div', { class: 'hint', text: U.formatBytes(u.bytes) + ' / 约 ' + U.formatBytes(u.quota) + '（localStorage 上限），共 ' + Store.convIndex.length + ' 个对话。' })
    ]));
    const btns = el('div', { class: 'chip-row' });
    btns.appendChild(el('button', {
      class: 'btn sm', text: '导出全部数据 (JSON)', onclick: function () {
        U.download('chatui-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Store.exportAll(true), null, 2), 'application/json');
      }
    }));
    btns.appendChild(el('button', {
      class: 'btn sm', text: '导出当前对话 (Markdown)', onclick: function () {
        if (!S.conv) return;
        U.download((S.conv.title || 'dialog') + '.md', Store.exportConversationMarkdown(S.conv), 'text/markdown;charset=utf-8');
      }
    }));
    btns.appendChild(el('button', {
      class: 'btn sm', text: '导入（对话 / 备份 / 记忆）', onclick: function () { UI.openImport(); }
    }));
    btns.appendChild(el('button', {
      class: 'btn sm danger', text: '清空全部对话', onclick: function () {
        UI.confirm('清空全部对话', '将删除所有历史对话，记忆与设置保留。此操作不可恢复！', true).then(function (ok) {
          if (!ok) return;
          Store.clearConversations();
          UI.newChat({ force: true });
          U.toast('已清空');
        });
      }
    }));
    btns.appendChild(el('button', {
      class: 'btn sm danger', text: '重置全部数据', onclick: function () {
        UI.confirm('重置全部数据', '将删除本地保存的对话、记忆、服务商配置与设置，并重新加载页面。此操作不可恢复！', true).then(function (ok) {
          if (ok) Store.resetAll();
        });
      }
    }));
    p.appendChild(el('div', { class: 'field' }, [el('label', { text: '备份与清理' }), btns]));
    p.appendChild(el('div', { class: 'hint', text: '所有内容（含 API Key）都保存在此浏览器的 localStorage 中。换浏览器或清理浏览器数据会丢失，建议定期导出备份。「全部数据备份」已包含记忆库；如需单独迁移或共享记忆，请到「记忆」标签页使用记忆导出。' }));
  }

  function buildAboutPanel(p) {
    p.innerHTML = '';
    p.appendChild(el('div', { style: { lineHeight: '1.9', fontSize: '13.5px' } }, [
      el('p', { html: '<b>ChatUI</b> · 纯前端 OpenAI 兼容聊天客户端' }),
      el('ul', { style: { paddingLeft: '20px' } }, [
        el('li', { text: '支持任何遵循 OpenAI 协议的服务：OpenAI、DeepSeek、Ollama、LM Studio、vLLM、Kimi、GLM、通义千问、硅基流动、OpenRouter、Groq…' }),
        el('li', { text: 'Markdown / README 完整解析，代码高亮、语言标签、一键复制与下载，支持表格、任务列表、LaTeX 公式' }),
        el('li', { text: '长期记忆、自动记忆抽取、超长对话摘要压缩' }),
        el('li', { text: '图片视觉输入、语音输入、语音朗读、对话导出' }),
        el('li', { text: '无后端、无账号、无追踪，数据 100% 留在本地' })
      ]),
      el('p', { html: '<b>快捷键</b>' }),
      el('div', { class: 'hint' }, [
        el('div', { html: '<span class="kbd">Enter</span> 发送 · <span class="kbd">Shift</span>+<span class="kbd">Enter</span> 换行' }),
        el('div', { html: '<span class="kbd">Esc</span> 停止生成 / 关闭弹窗' }),
        el('div', { html: '<span class="kbd">Ctrl</span>+<span class="kbd">K</span> 搜索对话' }),
        el('div', { html: '<span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">O</span> 新对话' }),
        el('div', { html: '<span class="kbd">Ctrl</span>+<span class="kbd">B</span> 收起/展开侧栏' }),
        el('div', { html: '<span class="kbd">Ctrl</span>+<span class="kbd">/</span> 显示快捷键' })
      ])
    ]));
  }

  /* =========================================================
     记忆管理弹窗
     ========================================================= */
  UI.openMemory = function () {
    const body = el('div');
    const search = el('input', { type: 'text', placeholder: '搜索记忆…' });
    const listWrap = el('div');
    const ta = el('textarea', { placeholder: '输入一条需要长期记住的信息，例如：用户是后端工程师，习惯用 Go', style: { minHeight: '70px' } });

    const addBtn = el('button', {
      class: 'btn primary sm', text: '添加记忆', onclick: function () {
        const v = ta.value.trim();
        if (!v) return;
        const m = Store.addMemory(v, 'manual', []);
        if (!m) { U.toast('已存在相同记忆'); return; }
        ta.value = '';
        render();
        updateMemDot();
        U.toast('已添加', 'ok');
      }
    });
    const bulkBtn = el('button', {
      class: 'btn sm', text: '批量导入', onclick: function () {
        ta.value = '';
        UI.prompt('批量导入记忆', '', '每行一条记忆').then(function (v) {
          if (!v) return;
          let n = 0;
          v.split('\n').forEach(function (line) {
            if (line.trim() && Store.addMemory(line.trim(), 'manual', [])) n++;
          });
          render(); updateMemDot();
          U.toast('导入 ' + n + ' 条', 'ok');
        });
      }
    });

    function render() {
      const q = search.value.trim().toLowerCase();
      const list = Store.listMemories().filter(m => !q || m.content.toLowerCase().indexOf(q) >= 0 ||
        (m.tags || []).join(',').toLowerCase().indexOf(q) >= 0);
      list.sort(function (a, b) {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      });
      listWrap.innerHTML = '';
      if (!list.length) {
        listWrap.appendChild(el('div', { class: 'empty-tip', text: Store.memories.length ? '没有匹配的记忆' : '还没有任何记忆。你可以手动添加，或开启「自动提取记忆」让模型自己总结。' }));
        return;
      }
      list.forEach(function (m) {
        const txtEl = el('div', { class: 'mem-txt', text: m.content });
        const item = el('div', { class: 'mem-item' }, [
          el('div', { class: 'mem-top' }, [
            m.pinned ? iconTag('i-pin-fill', '置顶', 'msg-tag pinned') : null,
            el('span', { class: 'msg-tag', text: m.source === 'auto' ? '自动提取' : '手动添加' }),
            el('span', { style: { flex: '1' } }),
            el('button', { class: 'icon-btn', title: '编辑', onclick: function () { doEdit(m); } }, [icon('i-edit')]),
            el('button', { class: 'icon-btn', title: m.pinned ? '取消置顶' : '置顶', onclick: function () { Store.updateMemory(m.id, { pinned: !m.pinned }); render(); } }, [icon('i-pin')]),
            el('button', { class: 'icon-btn', title: '删除', onclick: function () { Store.removeMemory(m.id); render(); updateMemDot(); } }, [icon('i-trash')])
          ]),
          txtEl,
          el('div', { class: 'mem-meta' }, [
            el('span', { text: '创建于 ' + U.formatDateTime(m.createdAt) }),
            el('span', { text: '被使用 ' + (m.useCount || 0) + ' 次' })
          ])
        ]);
        listWrap.appendChild(item);
      });
    }

    function doEdit(m) {
      UI.prompt('编辑记忆', m.content).then(function (v) {
        if (v != null && v.trim()) { Store.updateMemory(m.id, { content: v.trim() }); render(); }
      });
    }

    search.addEventListener('input', U.debounce(render, 160));

    /* ---- 导入 / 导出 ---- */
    const fmtSel = el('select', { title: '导出格式', style: { width: 'auto', flex: 'none', padding: '6px 8px' } });
    Memory.formats().forEach(function (f) {
      fmtSel.appendChild(el('option', { value: f.key, text: f.label }));
    });

    const exportBtn = el('button', {
      class: 'btn sm', text: '导出到文件', onclick: function () {
        const r = Memory.exportAs(fmtSel.value);
        if (!r.count) { U.toast('还没有记忆可以导出', 'err'); return; }
        U.download(r.filename, r.content, r.mime);
        U.toast('已导出 ' + r.count + ' 条记忆（' + r.format.toUpperCase() + '）', 'ok');
      }
    });

    const copyBtn = el('button', {
      class: 'btn sm', text: '复制为文本', onclick: function () {
        const list = Store.listMemories();
        if (!list.length) { U.toast('还没有记忆可以复制', 'err'); return; }
        U.copy(Memory.toText(list)).then(function (ok) { if (ok) U.toast('已复制 ' + list.length + ' 条记忆', 'ok'); });
      }
    });

    const importBtn = el('button', {
      class: 'btn sm', text: '从文件导入', onclick: function () {
        const inp = el('input', { type: 'file', accept: '.json,.md,.markdown,.txt,.csv,application/json,text/plain' });
        inp.addEventListener('change', async function () {
          const f = inp.files[0];
          if (!f) return;
          try {
            const txt = await U.readAsText(f);
            const res = Memory.importFromText(txt, f.name);
            render();
            updateMemDot();
            if (res.parsed === 0) U.toast('没有解析到有效的记忆内容', 'err', 3200);
            else U.toast('导入完成：新增 ' + res.added + ' 条' + (res.skipped ? '，跳过 ' + res.skipped + ' 条（重复或无效）' : ''), 'ok', 3200);
          } catch (e) {
            U.toast('导入失败：' + e.message, 'err', 4000);
          }
        });
        inp.click();
      }
    });

    const toolbar = el('div', { class: 'field' }, [
      el('label', { text: '备份与迁移' }),
      el('div', { class: 'chip-row' }, [fmtSel, exportBtn, copyBtn, importBtn]),
      el('div', { class: 'hint', text: '导出的 Markdown / 纯文本 / JSON / CSV 均可再次导入本页，会自动跳过重复内容。JSON 会保留标签、置顶与来源信息。' })
    ]);

    body.appendChild(el('div', { class: 'field' }, [el('label', { text: '新增记忆' }), ta, el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px' } }, [addBtn, bulkBtn])]));
    body.appendChild(el('div', { class: 'field' }, [search]));
    body.appendChild(toolbar);
    body.appendChild(listWrap);

    const foot = [
      el('span', {
        style: { marginRight: 'auto', fontSize: '12px', color: 'var(--text-mute)' },
        text: (function () { const s = Memory.stats(); return s.count + ' 条 · ' + s.chars + ' 字 · ' + s.pinned + ' 条置顶 · ' + s.auto + ' 条自动提取'; })()
      }),
      el('button', {
        class: 'btn danger sm', text: '清空全部记忆', onclick: function () {
          UI.confirm('清空记忆', '将删除所有长期记忆，不可恢复。', true).then(function (ok) {
            if (!ok) return;
            Store.clearMemories(); render(); updateMemDot();
          });
        }
      }),
      el('button', { class: 'btn', text: '关闭', onclick: function () { Modal.close(); } })
    ];
    Modal.open('长期记忆', body, foot, { wide: true });
    render();
  };

  function updateMemDot() {
    const d = $('#memDot');
    if (!d) return;
    d.classList.toggle('on', Store.settings.memoryEnabled && Store.memories.length > 0);
  }
  UI.updateMemDot = updateMemDot;

  /* =========================================================
     助手弹窗
     ========================================================= */
  UI.openAssistants = function () {
    const listWrap = el('div');
    function render() {
      listWrap.innerHTML = '';
      Store.listAssistants().forEach(function (a) {
        listWrap.appendChild(el('div', { class: 'list-item' }, [
          el('div', { class: 'li-ic' }, [icon(a.icon || 'i-sparkles')]),
          el('div', { class: 'li-main' }, [
            el('b', { text: a.name }),
            el('span', { text: (a.desc || a.systemPrompt || '').slice(0, 80) })
          ]),
          el('button', { class: 'btn sm primary', text: '用它开聊', onclick: function () { Modal.close(); UI.newChat({ assistantId: a.id, systemPrompt: a.systemPrompt, temperature: a.temperature, title: a.name }); } }),
          el('button', { class: 'btn sm', text: '编辑', onclick: function () { edit(a); } }),
          a.builtin ? null : el('button', { class: 'btn sm danger', text: '删除', onclick: function () { Store.removeAssistant(a.id); render(); } })
        ]));
      });
    }
    function edit(a) {
      const nameI = el('input', { type: 'text', value: a ? a.name : '', placeholder: '助手名称' });
      const descI = el('input', { type: 'text', value: a ? a.desc : '', placeholder: '一句话描述' });
      const promptI = el('textarea', { placeholder: '系统提示词，定义助手的人设与输出要求', style: { minHeight: '120px' } });
      promptI.value = a ? a.systemPrompt : '';
      const tempI = el('input', { type: 'number', min: 0, max: 2, step: 0.1, value: a && a.temperature != null ? a.temperature : 0.7 });

      /* 图标选择器：SVG 图标网格（替代原来的 emoji 输入框） */
      let chosenIcon = (a && a.icon) || 'i-sparkles';
      const picker = el('div', { class: 'icon-pick' });
      const pickerBtns = [];
      Store.ASSISTANT_ICONS.forEach(function (name) {
        const b = el('button', {
          type: 'button', class: 'icon-pick-btn' + (name === chosenIcon ? ' on' : ''), title: name.replace(/^i-/, ''),
          onclick: function () {
            chosenIcon = name;
            pickerBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
            preview.innerHTML = '';
            preview.appendChild(icon(name));
          }
        }, [icon(name)]);
        pickerBtns.push(b);
        picker.appendChild(b);
      });
      const preview = el('div', { class: 'li-ic lg' }, [icon(chosenIcon)]);

      const save = el('button', {
        class: 'btn primary', text: '保存', onclick: function () {
          if (!nameI.value.trim()) { U.toast('请填写名称', 'err'); return; }
          Store.saveAssistant({
            id: a && a.builtin === false ? a.id : (a ? a.id : undefined),
            name: nameI.value.trim(), icon: chosenIcon, desc: descI.value.trim(),
            systemPrompt: promptI.value, temperature: +tempI.value, builtin: a ? !!a.builtin : false
          });
          Modal.close();
          UI.openAssistants();
        }
      });
      const iconRow = el('div', { class: 'icon-pick-row' }, [
        preview,
        el('div', { class: 'icon-pick-main' }, [
          el('div', { class: 'field-label' }, [el('span', { text: '图标' })]),
          picker
        ])
      ]);
      Modal.open(a ? ('编辑助手 · ' + a.name) : '新建助手', el('div', {}, [
        iconRow,
        el('div', { class: 'field' }, [el('label', { text: '名称' }), nameI]),
        el('div', { class: 'field' }, [el('label', { text: '简介' }), descI]),
        el('div', { class: 'field' }, [el('label', { text: '系统提示词' }), promptI]),
        el('div', { class: 'field' }, [el('label', { text: 'Temperature' }), tempI])
      ]), [el('button', { class: 'btn', text: '返回', onclick: function () { UI.openAssistants(); } }), save]);
    }
    const body = el('div', {}, [
      el('div', { class: 'hint', style: { marginBottom: '12px' } }, [
        el('span', { text: '助手 = 预设人格 + 专属系统提示词 + 推荐参数。选择一个助手即可开启一段新对话。' })
      ]),
      listWrap
    ]);
    Modal.open('助手广场', body, [
      el('button', { class: 'btn primary', onclick: function () { edit(null); } }, [icon('i-plus'), el('span', { text: '新建助手' })]),
      el('button', { class: 'btn', text: '关闭', onclick: function () { Modal.close(); } })
    ], { wide: true });
    render();
  };

  /* =========================================================
     参数弹窗
     ========================================================= */
  UI.openParams = function () {
    const g = UI.getParams();
    const p = S.conv;
    const only = el('input', { type: 'checkbox' });
    only.checked = !!(p && p.temperature != null);

    function slider(label, key, min, max, step, val, hint) {
      const r = el('input', { type: 'range', min: min, max: max, step: step, value: val });
      const v = el('span', { class: 'val', text: String(val) });
      r.addEventListener('input', function () { v.textContent = r.value; });
      return { node: el('div', { class: 'field' }, [el('label', { text: label + '：' + (hint || '') }), el('div', { class: 'range-row' }, [r, v])]), get: () => parseFloat(r.value) };
    }

    const t = slider('Temperature 采样温度', 't', 0, 2, 0.05, p && p.temperature != null ? p.temperature : g.temperature, '越高越有创意，越低越稳定');
    const tp = slider('Top P 核采样', 'tp', 0.05, 1, 0.05, p && p.topP != null ? p.topP : g.topP, '一般保持 1');
    const pp = slider('Presence Penalty', 'pp', -2, 2, 0.1, g.presencePenalty || 0, '鼓励新话题');
    const fp = slider('Frequency Penalty', 'fp', -2, 2, 0.1, g.frequencyPenalty || 0, '降低重复');
    const mt = el('input', { type: 'number', min: 0, step: 256, value: p && p.maxTokens != null ? p.maxTokens : (g.maxTokens || 0) });
    const sysI = el('textarea', { style: { minHeight: '90px' }, placeholder: '留空则使用全局系统提示词' });
    sysI.value = p && p.systemPrompt != null ? p.systemPrompt : '';

    const body = el('div', {}, [
      el('div', { class: 'switch-row' }, [
        el('div', { class: 'sw-txt' }, [el('b', { text: '仅应用于当前对话' }), el('span', { text: '关闭时保存为所有新对话的默认参数' })]),
        el('label', { class: 'switch' }, [only, el('i')])
      ]),
      t.node, tp.node, pp.node, fp.node,
      el('div', { class: 'field' }, [el('label', { text: '最大输出 tokens（0 = 不限制）' }), mt]),
      el('div', { class: 'field' }, [el('label', { text: '本对话系统提示词' }), sysI]),
      el('div', { class: 'field' }, [
        el('button', {
          class: 'btn sm', text: '立即压缩当前对话为摘要', onclick: async function () {
            if (!S.conv) return;
            const pr = Store.getActiveProvider();
            try {
              U.toast('正在压缩…');
              const r = await Memory.summarize(S.conv, pr, S.conv.model || Store.getActiveModel());
              U.toast('已压缩 ' + r.count + ' 条消息为摘要', 'ok');
              UI.renderMessages();
              UI.updateCtxBadge();
            } catch (e) { U.toast(e.message, 'err'); }
          }
        }),
        el('button', {
          class: 'btn sm', text: '清除本对话摘要', onclick: function () {
            if (!S.conv) return;
            S.conv.summary = '';
            S.conv.summaryCovers = 0;
            Store.saveConversation(S.conv);
            UI.updateCtxBadge();
            U.toast('已清除摘要');
          }
        })
      ])
    ]);

    const save = el('button', {
      class: 'btn primary', text: '保存', onclick: function () {
        const vals = {
          temperature: t.get(), topP: tp.get(), maxTokens: parseInt(mt.value, 10) || 0,
          presencePenalty: pp.get(), frequencyPenalty: fp.get()
        };
        if (only.checked && S.conv) {
          S.conv.temperature = vals.temperature;
          S.conv.topP = vals.topP;
          S.conv.maxTokens = vals.maxTokens;
          S.conv.systemPrompt = sysI.value;
          Store.saveConversation(S.conv);
          U.toast('已应用到当前对话', 'ok');
        } else {
          Store.saveSettings({ params: vals });
          if (S.conv) {
            S.conv.temperature = null; S.conv.topP = null; S.conv.maxTokens = null;
            if (sysI.value !== (S.conv.systemPrompt || '')) S.conv.systemPrompt = sysI.value;
            Store.saveConversation(S.conv);
          }
          U.toast('已保存为默认参数', 'ok');
        }
        Modal.close();
        UI.updateCtxBadge();
      }
    });
    Modal.open('模型参数', body, [el('button', { class: 'btn', text: '取消', onclick: () => Modal.close() }), save]);
  };

  /* =========================================================
     导入弹窗（对话 / 备份 / 记忆，全部离线解析）
     ========================================================= */
  UI.openImport = function (opt) {
    opt = opt || {};
    let result = opt.result || null;
    let sourceText = opt.text != null ? opt.text : null;
    let sourceName = opt.filename || '';
    let mode = 'separate';
    let kind = 'auto';
    let includeMemories = true;
    let dedupe = true;
    const backupParts = { settings: false, providers: false, assistants: true, memories: true };
    let providerId = (Store.getActiveProvider() || {}).id || '';

    const body = el('div');
    const resultBox = el('div');
    const fileInput = el('input', {
      type: 'file', multiple: true, style: { display: 'none' },
      accept: '.json,.jsonl,.md,.markdown,.txt,.csv,.log,.text,application/json,text/plain,text/markdown'
    });

    /* ---------- 拖拽区 ---------- */
    const dropTitle = el('b', { text: '拖入文件，或点击选择' });
    const dropSub = el('span', { text: '支持 .json 备份与对话导出、ChatGPT / Claude 导出文件、.md / .txt 聊天记录、记忆文件（可多选）' });
    const drop = el('div', { class: 'imp-drop', onclick: function () { fileInput.click(); } }, [
      el('svg', { class: 'ic imp-ic' }, [el('use', { href: '#i-upload' })]),
      el('div', { class: 'imp-drop-txt' }, [dropTitle, dropSub])
    ]);
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      drop.addEventListener(ev, function () { drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('over');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) loadFiles(files);
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length) {
        const files = Array.prototype.slice.call(fileInput.files);
        // 单文件时保留原文，便于「识别方式」手动切换
        if (files.length === 1) {
          U.readAsText(files[0]).then(function (txt) { sourceText = txt; sourceName = files[0].name; loadFiles(files); });
        } else { sourceText = null; loadFiles(files); }
      }
      fileInput.value = '';
    });

    /* ---------- 粘贴区 ---------- */
    const pasteBox = el('textarea', { rows: '4', placeholder: '也可以直接把对话内容 / JSON 粘贴到这里，然后点右侧「识别内容」' });
    const pasteBtn = el('button', {
      class: 'btn sm', text: '识别内容', onclick: function () {
        const t = pasteBox.value;
        if (!t.trim()) { U.toast('请先粘贴内容', 'err'); return; }
        sourceText = t; sourceName = '粘贴的内容';
        try {
          result = overrideKind(Importer.parseText(t, sourceName));
          render();
        } catch (e) { U.toast('识别失败：' + e.message, 'err', 4200); }
      }
    });

    body.appendChild(drop);
    body.appendChild(fileInput);
    body.appendChild(el('div', { class: 'imp-sep' }, [el('i', { text: '或粘贴内容' })]));
    body.appendChild(el('div', { class: 'imp-paste' }, [pasteBox, pasteBtn]));
    body.appendChild(el('div', { class: 'imp-sep' }, [el('i', { text: '识别结果' })]));
    body.appendChild(resultBox);

    const footInfo = el('span', { style: { marginRight: 'auto', fontSize: '12px', color: 'var(--text-mute)' } });
    const doImport = el('button', { class: 'btn primary', text: '确认导入' });
    doImport.disabled = true;
    doImport.addEventListener('click', run);

    /* ---------- 逻辑 ---------- */
    function loadFiles(files) {
      fileInput.blur();
      U.toast('正在解析 ' + files.length + ' 个文件…');
      Importer.parseFiles(files).then(function (r) {
        result = overrideKind(r);
        render();
      }).catch(function (e) {
        U.toast('解析失败：' + (e && e.message ? e.message : e), 'err', 4600);
      });
    }

    function overrideKind(r) {
      if (kind === 'auto' || !r) return r;
      if (kind === 'memory') {
        let mems = [];
        try { mems = sourceText ? Memory.parseImport(sourceText, sourceName) : []; } catch (e) { mems = []; }
        if (!mems.length) { U.toast('没有从内容里解析出记忆条目', 'err'); return r; }
        return { kind: 'memory', label: '记忆文件', conversations: [], memories: mems, warnings: [] };
      }
      if (r.conversations && r.conversations.length) return r;
      const plain = (sourceText || '').trim();
      if (!plain) return r;
      return {
        kind: 'text', label: '纯文本', memories: [], warnings: [],
        conversations: [{
          title: sourceName ? sourceName.replace(/\.[a-z0-9]{1,6}$/i, '') : '导入的文本',
          messages: [{ role: 'user', content: plain, reasoning: '', createdAt: 0 }], source: '纯文本'
        }]
      };
    }

    function render() {
      resultBox.innerHTML = '';
      if (!result) {
        resultBox.appendChild(el('div', { class: 'empty-tip', text: '还没有识别到内容' }));
        doImport.disabled = true; footInfo.textContent = '';
        return;
      }
      const st = Importer.stats(result);
      const memCount = (result.memories || []).length;

      /* 概要 */
      resultBox.appendChild(el('div', { class: 'imp-sum' }, [
        el('span', { class: 'imp-kind', text: result.label || '已识别' }),
        el('span', { text: st.conversations ? st.conversations + ' 个对话' : '' }),
        el('span', { text: st.messages ? st.messages + ' 条消息' : '' }),
        el('span', { text: st.chars ? '约 ' + st.chars.toLocaleString() + ' 字' : '' }),
        memCount ? el('span', { text: memCount + ' 条记忆' }) : null
      ]));

      /* 对话预览 */
      if (result.conversations && result.conversations.length) {
        const list = el('div', { class: 'imp-list' });
        result.conversations.slice(0, 30).forEach(function (c) {
          const msgs = c.messages.filter(m => m.role === 'user' || m.role === 'assistant');
          const u = msgs.filter(m => m.role === 'user').length;
          const a = msgs.length - u;
          list.appendChild(el('div', { class: 'imp-item' }, [
            el('b', { text: c.title || '（无标题）' }),
            el('span', { text: msgs.length + ' 条（你 ' + u + ' · 助手 ' + a + '）' }),
            el('em', { text: c.source || '' })
          ]));
        });
        if (result.conversations.length > 30) {
          list.appendChild(el('div', { class: 'hint', text: '… 其余 ' + (result.conversations.length - 30) + ' 个对话未在预览中列出' }));
        }
        resultBox.appendChild(list);
      }

      /* 记忆预览 */
      if (memCount) {
        const ml = el('div', { class: 'imp-list' });
        result.memories.slice(0, 8).forEach(function (m) {
          ml.appendChild(el('div', { class: 'imp-item' }, [
            el('b', { text: m.content.length > 60 ? m.content.slice(0, 60) + '…' : m.content }),
            (m.tags && m.tags.length) ? el('em', { text: '#' + m.tags.join(' #') }) : null
          ]));
        });
        if (memCount > 8) ml.appendChild(el('div', { class: 'hint', text: '… 其余 ' + (memCount - 8) + ' 条记忆未在预览中列出' }));
        resultBox.appendChild(ml);
      }

      /* 警告 */
      (result.warnings || []).forEach(function (w) {
        resultBox.appendChild(el('div', { class: 'imp-warn' }, [icon('i-alert'), el('span', { text: w })]));
      });

      /* 选项 */
      const opts = el('div', { class: 'imp-opts' });

      if (sourceText) {
        const sel = el('select', {}, [
          el('option', { value: 'auto', text: '自动识别' }),
          el('option', { value: 'conv', text: '按对话导入' }),
          el('option', { value: 'memory', text: '按记忆导入' })
        ]);
        sel.value = kind;
        sel.addEventListener('change', function () {
          kind = sel.value;
          if (sourceText) {
            try { result = overrideKind(Importer.parseText(sourceText, sourceName)); } catch (e) { U.toast(e.message, 'err'); }
          }
          render();
        });
        opts.appendChild(el('div', { class: 'imp-row' }, [el('label', { text: '识别方式' }), sel]));
      }

      if (result.conversations && result.conversations.length) {
        if (result.conversations.length > 1 || result.backup) {
          const modeSel = el('select', {}, [
            el('option', { value: 'separate', text: '每个对话单独导入（推荐）' }),
            el('option', { value: 'merge', text: '全部合并为一个对话' })
          ]);
          modeSel.value = mode;
          modeSel.addEventListener('change', function () { mode = modeSel.value; });
          opts.appendChild(el('div', { class: 'imp-row' }, [el('label', { text: '导入方式' }), modeSel]));
        }
        const provSel = el('select');
        Store.providers.forEach(function (p) {
          provSel.appendChild(el('option', { value: p.id, text: p.name }));
        });
        provSel.value = providerId;
        if (!provSel.value && provSel.options.length) provSel.value = provSel.options[0].value;
        providerId = provSel.value;
        provSel.addEventListener('change', function () { providerId = provSel.value; });
        opts.appendChild(el('div', { class: 'imp-row' }, [
          el('label', { text: '归属服务商' }),
          provSel,
          el('span', { class: 'imp-note', text: '导入后继续对话时使用，可随时在顶部切换' })
        ]));
      }

      if (result.conversations && result.conversations.length > 1) {
        const dcb = el('input', { type: 'checkbox' });
        dcb.checked = dedupe;
        dcb.addEventListener('change', function () { dedupe = dcb.checked; });
        opts.appendChild(el('label', { class: 'imp-check' }, [dcb, el('span', { text: '跳过已经导入过的对话（标题与内容相同）' })]));
      }

      if (memCount) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = includeMemories;
        cb.addEventListener('change', function () { includeMemories = cb.checked; });
        opts.appendChild(el('label', { class: 'imp-check' }, [cb, el('span', { text: '同时导入其中的 ' + memCount + ' 条记忆（自动跳过重复）' })]));
      }

      if (result.backup) {
        opts.appendChild(el('div', { class: 'hint', style: { margin: '4px 0 2px' }, text: '这是一份全量备份，除对话外还可选择一并恢复：' }));
        [['providers', '服务商与 API Key'], ['settings', '全部设置项'], ['assistants', '助手预设'], ['memories', '记忆']].forEach(function (r) {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!backupParts[r[0]];
          cb.addEventListener('change', function () { backupParts[r[0]] = cb.checked; });
          opts.appendChild(el('label', { class: 'imp-check' }, [cb, el('span', { text: r[1] })]));
        });
        opts.appendChild(el('div', { class: 'hint', text: '注意：勾选「服务商」会用备份里的配置覆盖同名服务商（含 API Key）。' }));
      }

      resultBox.appendChild(opts);

      const can = (result.conversations && result.conversations.length) || memCount || result.backup;
      doImport.disabled = !can;
      doImport.textContent = '确认导入' + (st.conversations ? '（' + st.conversations + ' 个对话）' : (memCount ? '（' + memCount + ' 条记忆）' : ''));
      footInfo.textContent = st.conversations || memCount ? '解析在本机完成，不会上传任何数据' : '没有可导入的内容';
    }

    function run() {
      doImport.disabled = true;
      try {
        const out = Importer.apply(result, {
          mode: mode, providerId: providerId, memories: includeMemories, dedupe: dedupe,
          backup: result.backup ? backupParts : null
        });
        if (out.backup) { UI.renderProviders(); UI.renderModels(); applyTheme(Store.settings.theme); }
        const parts = [];
        if (out.conversations.length) parts.push('导入 ' + out.conversations.length + ' 个对话');
        if (out.skippedConversations) parts.push('跳过 ' + out.skippedConversations + ' 个已存在的对话');
        if (out.memories) parts.push('新增 ' + out.memories + ' 条记忆');
        if (out.skippedMemories) parts.push('跳过 ' + out.skippedMemories + ' 条重复记忆');
        if (out.backup) parts.push('备份已恢复');
        U.toast(parts.length ? parts.join('，') : '没有新增内容', parts.length ? 'ok' : '', 3600);
        Modal.close();
        UI.renderConvList();
        if (out.conversations.length) UI.selectConv(out.conversations[0].id);
      } catch (e) {
        U.toast('导入失败：' + (e && e.message ? e.message : e), 'err', 4600);
        doImport.disabled = false;
      }
    }

    Modal.open('导入对话 / 备份 / 记忆', body, [
      footInfo,
      el('button', { class: 'btn', text: '取消', onclick: () => Modal.close() }),
      doImport
    ], { wide: true });

    render();
  };

  /* =========================================================
     导出弹窗
     ========================================================= */
  UI.openExport = function () {
    const body = el('div', {}, [
      el('div', { class: 'chip-row' }, [
        el('button', {
          class: 'btn sm', text: '当前对话 → Markdown', onclick: function () {
            if (!S.conv) return;
            U.download((S.conv.title || 'dialog') + '.md', Store.exportConversationMarkdown(S.conv), 'text/markdown;charset=utf-8');
            U.toast('已导出 Markdown', 'ok');
          }
        }),
        el('button', {
          class: 'btn sm', text: '当前对话 → JSON', onclick: function () {
            if (!S.conv) return;
            U.download((S.conv.title || 'dialog') + '.json', JSON.stringify(S.conv, null, 2), 'application/json');
            U.toast('已导出 JSON', 'ok');
          }
        }),
        el('button', {
          class: 'btn sm', text: '复制为 Markdown', onclick: function () {
            if (!S.conv) return;
            U.copy(Store.exportConversationMarkdown(S.conv)).then(ok => ok && U.toast('已复制', 'ok'));
          }
        }),
        el('button', {
          class: 'btn sm', text: '全部数据备份 (JSON)', onclick: function () {
            U.download('chatui-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Store.exportAll(true), null, 2), 'application/json');
          }
        }),
        el('button', {
          class: 'btn sm', text: '导入对话 / 备份 / 记忆', onclick: function () { UI.openImport(); }
        }),
        el('button', {
          class: 'btn sm', text: '打印 / 存 PDF', onclick: function () { window.print(); }
        })
      ]),
      el('div', { class: 'hint', style: { marginTop: '12px' } }, [
        el('span', { text: 'Markdown 导出包含完整的对话内容与思考过程，可直接贴到任何笔记软件。JSON 备份包含服务商配置与 API Key，请妥善保管。' })
      ])
    ]);
    Modal.open('导出 / 导入', body, [el('button', { class: 'btn', text: '关闭', onclick: () => Modal.close() })]);
  };

  /* =========================================================
     快捷键说明
     ========================================================= */
  UI.openShortcuts = function () {
    const rows = [
      ['Enter', '发送消息'],
      ['Shift + Enter', '换行'],
      ['Ctrl + Enter', '发送（当 Enter 换行时）'],
      ['Esc', '停止生成 / 关闭弹窗'],
      ['Ctrl + K', '搜索对话'],
      ['Ctrl + Shift + O', '新建对话'],
      ['Ctrl + B', '收起 / 展开侧边栏'],
      ['Ctrl + M', '打开记忆管理器'],
      ['Ctrl + /', '显示本帮助'],
      ['↑（输入框为空）', '编辑上一条消息']
    ];
    const body = el('div', {});
    rows.forEach(function (r) {
      body.appendChild(el('div', { style: { display: 'flex', gap: '12px', padding: '7px 0', borderBottom: '1px solid var(--border-soft)' } }, [
        el('span', { class: 'kbd', style: { minWidth: '130px', textAlign: 'center' }, text: r[0] }),
        el('span', { style: { fontSize: '13.5px', color: 'var(--text-dim)' }, text: r[1] })
      ]));
    });
    Modal.open('快捷键', body, [el('button', { class: 'btn', text: '知道了', onclick: () => Modal.close() })]);
  };

  /* =========================================================
     主题 / 字号
     ========================================================= */
  function applyTheme(theme) {
    Store.saveSettings({ theme: theme });
    document.documentElement.setAttribute('data-theme', theme);
    $('#hljsDark').disabled = theme !== 'dark';
    $('#hljsLight').disabled = theme === 'dark';
    const b = $('#btnTheme');
    b.innerHTML = '';
    b.appendChild(icon(theme === 'dark' ? 'i-moon' : 'i-sun'));
    const sp = el('span', { text: '主题' });
    b.appendChild(sp);
  }
  UI.applyTheme = applyTheme;

  function applyFontSize() {
    document.documentElement.style.setProperty('--fs', (Store.settings.fontSize || 15) + 'px');
  }
  UI.applyFontSize = applyFontSize;

  /* =========================================================
     侧边栏（移动端）
     ========================================================= */
  function openSidebar() { $('#app').classList.add('side-open'); }
  function closeSidebarOnMobile() {
    if (window.innerWidth <= 860) $('#app').classList.remove('side-open');
  }

  /* =========================================================
     初始化
     ========================================================= */
  UI.init = function () {
    applyTheme(Store.settings.theme || 'dark');
    applyFontSize();
    UI.renderProviders();
    UI.renderConvList();
    UI.renderAttachments();
    updateMemDot();

    // 会话
    const first = Store.activeConvId || (Store.convIndex[0] && Store.convIndex[0].id);
    if (first) UI.selectConv(first);
    else UI.newChat();

    /* ---- 事件绑定 ---- */
    $('#btnNewChat').addEventListener('click', function () { UI.newChat(); });

    $('#convSearch').addEventListener('input', U.debounce(function () { UI.renderConvList(); }, 180));

    $('#selProvider').addEventListener('change', function () {
      Store.setActive(this.value);
      UI.renderModels();
      if (S.conv) { S.conv.providerId = this.value; S.conv.model = Store.getActiveModel(); Store.saveConversation(S.conv); }
      UI.renderWelcome();
    });
    $('#selModel').addEventListener('change', async function () {
      if (this.value === '__custom__') {
        const v = await UI.prompt('输入模型名', '', '例如 deepseek-chat');
        const p = Store.getActiveProvider();
        if (v && v.trim()) {
          if ((p.models || []).indexOf(v.trim()) < 0) { p.models = p.models || []; p.models.unshift(v.trim()); Store.saveProviders(); }
          Store.setActive(p.id, v.trim());
        }
        UI.renderModels();
      } else {
        Store.setActive(null, this.value);
      }
      if (S.conv) { S.conv.model = Store.getActiveModel(); Store.saveConversation(S.conv); }
    });
    $('#btnRefreshModels').addEventListener('click', async function () {
      const p = Store.getActiveProvider();
      if (!p) return;
      const btn = this;
      btn.disabled = true;
      U.toast('正在拉取模型列表…');
      try {
        const ids = await API.listModels(p);
        if (ids.length) {
          p.models = ids;
          Store.saveProviders();
          UI.renderModels();
          U.toast('已拉取 ' + ids.length + ' 个模型', 'ok');
        } else U.toast('该服务未返回模型列表，请手动添加', 'err');
      } catch (e) {
        U.toast(e.message, 'err', 5000);
      } finally { btn.disabled = false; }
    });

    $('#chatTitle').addEventListener('click', function () {
      if (!S.conv) return;
      UI.prompt('重命名对话', S.conv.title).then(function (v) {
        if (v != null && v.trim()) {
          S.conv.title = v.trim();
          Store.saveConversation(S.conv);
          updateTitle(); UI.renderConvList();
        }
      });
    });

    $('#btnParams').addEventListener('click', UI.openParams);
    $('#btnImport').addEventListener('click', function () { UI.openImport(); });
    $('#btnExport').addEventListener('click', UI.openExport);
    $('#btnTheme').addEventListener('click', function () {
      applyTheme(Store.settings.theme === 'dark' ? 'light' : 'dark');
    });

    U.$$('.sb-foot-btn[data-modal]').forEach(function (b) {
      b.addEventListener('click', function () {
        const m = b.dataset.modal;
        if (m === 'settings') UI.openSettings();
        else if (m === 'memory') UI.openMemory();
        else if (m === 'assistants') UI.openAssistants();
      });
    });

    $('#btnOpenSidebar').addEventListener('click', openSidebar);
    $('#btnCloseSidebar').addEventListener('click', function () {
      if (window.innerWidth <= 860) $('#app').classList.remove('side-open');
      else $('#app').classList.toggle('side-hidden');
    });
    $('#sbBackdrop').addEventListener('click', function () { $('#app').classList.remove('side-open'); });

    // 输入区
    const input = $('#input');
    input.addEventListener('input', function () {
      autoGrow();
      const t = U.estimateTokens(input.value);
      $('#tokenHint').textContent = input.value.length ? (input.value.length + ' 字 · ≈' + t + ' tok') : '';
    });
    input.addEventListener('keydown', function (e) {
      const enterSend = Store.settings.sendOnEnter;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (enterSend || e.ctrlKey || e.metaKey) { e.preventDefault(); doSend(); }
      } else if (e.key === 'ArrowUp' && !input.value.trim()) {
        // 编辑上一条用户消息
        const lastUser = S.conv ? S.conv.messages.filter(m => m.role === 'user').pop() : null;
        if (lastUser) {
          e.preventDefault();
          $('#input').value = lastUser.content;
          autoGrow();
          const node = getMsgNode(lastUser.id);
          if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    });
    $('#btnSend').addEventListener('click', function () { doSend(); });
    $('#btnAttach').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function (e) {
      handleFiles(Array.prototype.slice.call(e.target.files));
      e.target.value = '';
    });

    // 拖拽上传 / 拖拽导入
    const main = document.querySelector('.main');
    main.addEventListener('dragover', function (e) { e.preventDefault(); });
    main.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      const files = Array.prototype.slice.call(e.dataTransfer.files);
      // .json 视为导出数据 → 走导入；其余按附件处理
      if (files.every(f => /\.(json|jsonl)$/i.test(f.name))) {
        U.toast('正在解析 ' + files.length + ' 个文件…');
        if (files.length === 1) {
          U.readAsText(files[0]).then(function (txt) {
            UI.openImport({ result: Importer.parseText(txt, files[0].name), text: txt, filename: files[0].name });
          }).catch(function (err) { U.toast('解析失败：' + (err && err.message ? err.message : err), 'err', 4600); });
        } else {
          Importer.parseFiles(files).then(function (r) { UI.openImport({ result: r, filename: files[0].name }); })
            .catch(function (err) { U.toast('解析失败：' + (err && err.message ? err.message : err), 'err', 4600); });
        }
        return;
      }
      handleFiles(files);
    });

    // 粘贴图片
    input.addEventListener('paste', function (e) {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) { e.preventDefault(); handleFiles(files); }
    });

    // 语音输入
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      $('#btnMic').addEventListener('click', function () {
        const btn = this;
        if (S.recognition) {
          S.recognition.stop();
          return;
        }
        const r = new SR();
        r.lang = 'zh-CN';
        r.continuous = true;
        r.interimResults = true;
        let base = input.value;
        r.onresult = function (ev) {
          let text = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) text += ev.results[i][0].transcript;
          input.value = base + text;
          autoGrow();
        };
        r.onend = function () { S.recognition = null; btn.style.color = ''; };
        r.onerror = function () { S.recognition = null; btn.style.color = ''; };
        r.start();
        S.recognition = r;
        btn.style.color = 'var(--accent)';
        U.toast('正在聆听…再次点击停止');
      });
    } else {
      $('#btnMic').style.display = 'none';
    }

    // 滚动按钮
    $('#btnScrollBottom').addEventListener('click', function () { scrollToBottom(true); });
    $('#messages').addEventListener('scroll', function () {
      const box = this;
      const show = box.scrollHeight - box.scrollTop - box.clientHeight > 260;
      $('#btnScrollBottom').classList.toggle('show', show);
    });

    // 弹窗关闭
    $('#modalClose').addEventListener('click', function () { Modal.close(); });
    $('#modalMask').addEventListener('mousedown', function (e) {
      if (e.target === $('#modalMask')) Modal.close();
    });

    // 全局快捷键
    document.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if ($('#modalMask').classList.contains('show')) { Modal.close(); return; }
        if (S.stream.active) { UI.stopStream(); return; }
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); $('#convSearch').focus(); $('#convSearch').select(); openSidebar(); }
      else if (k === 'o' && e.shiftKey) { e.preventDefault(); UI.newChat(); }
      else if (k === 'b') { e.preventDefault(); $('#app').classList.toggle('side-hidden'); }
      else if (k === 'm') { e.preventDefault(); UI.openMemory(); }
      else if (k === '/') { e.preventDefault(); UI.openShortcuts(); }
    });

    // Store 事件
    U.bus.on('conversations', function () { UI.renderConvList(); });
    U.bus.on('providers', function () { UI.renderProviders(); });
    U.bus.on('memories', function () { updateMemDot(); });

    // 跨标签页同步
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf('chatui.v1.') !== 0) return;
      Store.init();
      UI.renderProviders();
      UI.renderConvList();
      updateMemDot();
      if (Store.activeConvId !== (S.conv && S.conv.id)) UI.selectConv(Store.activeConvId);
      applyTheme(Store.settings.theme);
    });

    // 首次使用引导
    const anyKey = Store.providers.some(p => p.apiKey);
    if (!anyKey && !localStorage.getItem('chatui.v1.onboarded')) {
      localStorage.setItem('chatui.v1.onboarded', '1');
      setTimeout(function () { UI.openSettings('providers'); }, 500);
    }

    // 滚动到底部
    setTimeout(function () { scrollToBottom(true); }, 80);
  };

  global.UI = UI;
})(window);
