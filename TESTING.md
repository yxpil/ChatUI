# ChatUI 测试说明

## 测试目录

| 文件 | 说明 |
|------|------|
| `tests/util.test.js` | util.js 纯函数单元测试 + XSS 注入测试 + 事件总线钩子测试 |

## 运行方式

```bash
npm test
```

## 覆盖说明

### 单元测试（12 个）
- escapeHtml / escapeRegExp 转义
- clamp / formatBytes / estimateTokens
- formatTime / formatDateTime / relativeTime
- deepClone

### 注入测试（3 个）
- XSS 载荷（`<img onerror>`、`<svg onload>`、`<script>`、`<iframe javascript:>`）全部被 escapeHtml 中和
- parseJSONLoose 对 XSS 字符串返回 null 不执行
- parseJSONLoose 对嵌套大括号和字符串转义正确解析

### 钩子/交互测试（5 个）
- debounce 只在停止后执行一次
- throttle 限制调用频率
- 事件总线 on/emit/off
- 监听器异常不阻断其他监听器
- 空输入/null 安全处理

## 预期结果：20 个用例全部通过
