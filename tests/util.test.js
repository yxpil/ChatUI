// ChatUI util.js 单元测试：纯函数 + 安全测试
// 运行: node --test --test-force-exit tests/util.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 最小 window/document 沙箱
const elements = {};
global.document = {
  createElement: (tag) => ({
    tagName: tag, children: [], attrs: {}, style: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); },
    addEventListener() {},
    classList: { add() {}, remove() {} },
    dataset: {},
    getContext: () => null,
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {}, removeChild() {} },
};
global.window = global;
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
  key(i) { return Object.keys(this._data)[i] ?? null; },
  get length() { return Object.keys(this._data).length; },
};
global.structuredClone = global.structuredClone || ((o) => JSON.parse(JSON.stringify(o)));
global.URL = require('url').URL;

// 加载 util.js
const utilPath = path.join(__dirname, '..', 'assets', 'js', 'util.js');
eval(fs.readFileSync(utilPath, 'utf8'));
const U = global.U;

describe('字符串转义（XSS 防护）', () => {
  test('escapeHtml 转义 < > & " \'', () => {
    assert.strictEqual(U.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(U.escapeHtml('"quoted"'), '&quot;quoted&quot;');
    assert.strictEqual(U.escapeHtml("'single'"), '&#39;single&#39;');
    assert.strictEqual(U.escapeHtml('&amp;'), '&amp;amp;');
  });

  test('escapeHtml 对 null/undefined/空字符串安全', () => {
    assert.strictEqual(U.escapeHtml(null), '');
    assert.strictEqual(U.escapeHtml(undefined), '');
    assert.strictEqual(U.escapeHtml(''), '');
  });

  test('escapeHtml 对 XSS 载荷完全转义（标签被中和）', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '"><script>alert(1)</script>',
      '<iframe src="javascript:alert(1)">',
    ];
    for (const p of payloads) {
      const escaped = U.escapeHtml(p);
      // 转义后不应包含任何原始 HTML 尖括号（标签被中和）
      assert.ok(!escaped.includes('<img'), `不应包含 <img: ${escaped}`);
      assert.ok(!escaped.includes('<script'), `不应包含 <script: ${escaped}`);
      assert.ok(!escaped.includes('<svg'), `不应包含 <svg: ${escaped}`);
      assert.ok(!escaped.includes('<iframe'), `不应包含 <iframe: ${escaped}`);
      // 所有尖括号都应被转义
      assert.ok(!escaped.includes('<'), `不应包含 <: ${escaped}`);
    }
  });

  test('escapeRegExp 转义正则特殊字符', () => {
    assert.strictEqual(U.escapeRegExp('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });
});

describe('数值工具', () => {
  test('clamp 边界', () => {
    assert.strictEqual(U.clamp(5, 0, 10), 5);
    assert.strictEqual(U.clamp(-5, 0, 10), 0);
    assert.strictEqual(U.clamp(15, 0, 10), 10);
  });

  test('formatBytes', () => {
    assert.strictEqual(U.formatBytes(500), '500 B');
    assert.strictEqual(U.formatBytes(2048), '2.0 KB');
    assert.strictEqual(U.formatBytes(5 * 1024 * 1024), '5.00 MB');
  });

  test('estimateTokens CJK vs 拉丁', () => {
    const cjk = U.estimateTokens('你好世界测试');
    const latin = U.estimateTokens('hello world test');
    assert.ok(cjk > 0 && latin > 0);
    assert.strictEqual(U.estimateTokens(''), 0);
  });
});

describe('时间格式化', () => {
  test('formatTime 24小时制', () => {
    const ts = new Date(2024, 0, 1, 14, 30).getTime();
    assert.strictEqual(U.formatTime(ts), '14:30');
  });

  test('formatDateTime', () => {
    const ts = new Date(2024, 5, 15, 9, 5).getTime();
    assert.match(U.formatDateTime(ts), /2024-06-15 09:05/);
  });

  test('relativeTime', () => {
    assert.strictEqual(U.relativeTime(Date.now()), '刚刚');
    assert.strictEqual(U.relativeTime(Date.now() - 65 * 1000), '1 分钟前');
  });
});

describe('防抖/节流（钩子测试）', () => {
  test('debounce 只在停止调用后执行一次', async () => {
    let count = 0;
    const fn = U.debounce(() => count++, 50);
    fn(); fn(); fn();
    assert.strictEqual(count, 0);
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(count, 1);
  });

  test('throttle 限制调用频率', async () => {
    let count = 0;
    const fn = U.throttle(() => count++, 50);
    fn(); fn(); fn();
    assert.ok(count >= 1 && count <= 2);
    await new Promise(r => setTimeout(r, 100));
    fn();
    assert.ok(count >= 2);
  });
});

describe('事件总线（钩子测试）', () => {
  test('on/emit/off 正常工作', () => {
    const bus = U.bus;
    let received = null;
    const fn = (data) => { received = data; };
    bus.on('test-evt', fn);
    bus.emit('test-evt', 'hello');
    assert.strictEqual(received, 'hello');
    bus.off('test-evt', fn);
  });

  test('一个监听器抛异常不阻断其他监听器', () => {
    const bus = U.bus;
    const order = [];
    bus.on('err-evt', () => order.push(1));
    bus.on('err-evt', () => { order.push(2); throw new Error('boom'); });
    bus.on('err-evt', () => order.push(3));
    bus.emit('err-evt', null);
    assert.deepStrictEqual(order, [1, 2, 3]);
  });
});

describe('JSON 容错解析（注入测试）', () => {
  test('parseJSONLoose 提取 ```json 代码块', () => {
    const result = U.parseJSONLoose('```json\n{"a":1}\n```');
    assert.deepStrictEqual(result, { a: 1 });
  });

  test('parseJSONLoose 从文本中提取 JSON 对象', () => {
    const result = U.parseJSONLoose('前面有文字 {"key":"val"} 后面有文字');
    assert.deepStrictEqual(result, { key: 'val' });
  });

  test('parseJSONLoose 处理嵌套大括号和字符串转义', () => {
    const result = U.parseJSONLoose('{"a":{"b":"test}escaped"}}');
    assert.deepStrictEqual(result, { a: { b: 'test}escaped' } });
  });

  test('parseJSONLoose 对 XSS 载荷返回 null（不执行）', () => {
    const result = U.parseJSONLoose('<script>alert(1)</script>');
    assert.strictEqual(result, null);
  });

  test('parseJSONLoose 空输入返回 null', () => {
    assert.strictEqual(U.parseJSONLoose(''), null);
    assert.strictEqual(U.parseJSONLoose(null), null);
  });
});

describe('深拷贝', () => {
  test('deepClone 嵌套对象独立', () => {
    const orig = { a: 1, b: { c: [1, 2, 3] } };
    const copy = U.deepClone(orig);
    copy.b.c.push(4);
    assert.strictEqual(orig.b.c.length, 3);
  });
});
