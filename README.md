# ChatUI · 本地大模型聊天客户端

纯前端、零后端、零账号的 **OpenAI 兼容协议**聊天界面。数据（对话、设置、API Key、长期记忆）全部保存在你自己的浏览器 `localStorage` 中，不上传任何服务器。

支持接入任何遵循 OpenAI 协议的模型服务：**Ollama（本地）、LM Studio、vLLM、OpenAI GPT、DeepSeek、Kimi、智谱 GLM、通义千问、硅基流动、火山方舟（豆包）、腾讯混元、OpenRouter、Groq、Mistral** 以及任意中转站 / 自建网关。

---

## ✨ 功能一览

**模型接入**
- 15 个内置服务商预设，一键切换；也可添加任意自定义 OpenAI 兼容网关
- 自动拉取 `/v1/models` 模型列表，支持手动输入模型名
- 流式输出（SSE）+ 非流式回退，自动兼容不支持 `stream_options` 的服务
- 支持 DeepSeek-R1 等推理模型的思维链（`reasoning_content`）展示
- 视觉模型图片输入（自动压缩到 1280px）、文本文件附件、拖拽 / 粘贴上传
- 可视化参数调节：Temperature、Top P、最大输出、Presence / Frequency Penalty
- 单次请求超时、请求附加自定义 Header（适配中转站鉴权）

**Markdown / README 解析**
- 完整 GFM：标题、列表、任务清单、引用、表格（横向滚动）、分隔线、脚注式链接
- 代码块：语法高亮（190+ 语言自动识别）、语言标签、行数、**一键复制**、**下载为文件**、超长代码自动折叠
- LaTeX 公式（块级 `$$...$$` 与行内 `$...$`），自动避开金额等非公式文本
- 消息级复制（保留 Markdown 原文）、HTML 输出经 DOMPurify 净化防 XSS

**记忆**
- 长期记忆库：手动添加 / 批量导入 / 编辑 / 置顶 / 搜索 / 清空
- 自动记忆抽取：每几轮对话后由模型总结用户偏好与事实并去重入库
- 相关度检索：按关键词与记忆标签打分，只把最相关的记忆注入系统提示，避免污染上下文
- 超长对话处理：裁剪最旧消息 或 自动滚动摘要压缩（可配置上下文 token 预算）
- **记忆导出 / 导入**：JSON、Markdown、纯文本、CSV 四种格式互相转换，可换浏览器、换设备或共享给他人（详见下文）

**对话管理**
- 多会话、置顶、重命名、删除、全文搜索（含消息内容）
- 自动生成对话标题、停止生成、重新生成、编辑重发、删除单条消息
- 导出：Markdown / JSON / 复制为 Markdown / 打印存 PDF；全量备份
- **导入**：ChatGPT / Claude 官方导出、全量备份、任意 OpenAI 消息 JSON、Markdown 与纯文本聊天记录、记忆文件——拖入文件先预览再导入，自动去重（详见下文）
- 语音输入（Web Speech API）、语音朗读回复（可自动朗读）
- 助手（GPTs 式预设）：内置代码助手 / 写作润色 / 翻译官 / 长文解析，可自建

**体验**
- 深色 / 浅色主题、字号调节、移动端自适应、打印样式
- 全部键盘快捷键支持，双标签页数据自动同步
- 本地存储用量可视化、配额告警

---

## 🚀 快速开始

### 方式一：一键启动（推荐）

双击 `start.bat`（Windows）或运行 `./start.sh`（macOS / Linux），会自动启动本地静态服务并打开浏览器：

```
http://localhost:5173/
```

> 需要已安装 Python（或 Node.js）。没有也没关系，见方式二。

### 方式二：直接打开

双击 `index.html` 即可使用（界面与所有功能正常，仅浏览器对 `file://` 的跨域策略更严格，连本地 Ollama 时可能被拦截，建议用方式一）。

### 方式三：任意静态服务器

```bash
cd ChatUI
python -m http.server 5173        # 或 npx http-server -p 5173 -c-1
```

---

## 🔧 服务商配置

首次打开会自动弹出设置向导。位置：左下角 **⚙️ 设置 → 模型服务**。

| 服务商 | Base URL | API Key |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | 必需 |
| DeepSeek | `https://api.deepseek.com/v1` | 必需 |
| Ollama（本地） | `http://localhost:11434/v1` | 不需要 |
| LM Studio（本地） | `http://localhost:1234/v1` | 不需要 |
| vLLM / 自建 | `http://localhost:8000/v1` | 视配置 |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | 必需 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 必需 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 必需 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 必需 |
| 火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | 必需（模型填接入点 ID） |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | 必需 |
| OpenRouter | `https://openrouter.ai/api/v1` | 必需 |
| Groq | `https://api.groq.com/openai/v1` | 必需 |
| Mistral | `https://api.mistral.ai/v1` | 必需 |
| 自定义 / 中转站 | 任意 OpenAI 兼容地址 | 视配置 |

填好后点击 **「测试并拉取模型」** 验证连通性，会自动填充模型列表。

### Ollama 跨域设置（重要）

浏览器直连 Ollama 需要它放行跨域。启动 Ollama 前设置环境变量：

```bash
# Windows (PowerShell，当前会话生效)
$env:OLLAMA_ORIGINS="*"; ollama serve

# Windows (永久)
setx OLLAMA_ORIGINS "*"

# macOS / Linux
OLLAMA_ORIGINS=* ollama serve
```

已装 Ollama 桌面版的话，在系统环境变量里新增 `OLLAMA_ORIGINS = *` 后重启 Ollama 即可。

### 关于浏览器直连云服务的 CORS

OpenAI、DeepSeek 等官方接口一般**不允许**浏览器跨域直连（会报 `Failed to fetch`）。解决办法任选其一：

1. 使用支持 CORS 的中转 / 网关地址（填到「自定义 / 中转站」）；
2. 本地起一层代理；
3. 优先用 Ollama / LM Studio / vLLM 等本地模型，无此限制。

---

## 💾 记忆导出 / 导入

入口一：左下角 **🧠 记忆 → 备份与迁移**（导出 / 复制为文本 / 从文件导入）。
入口二：**⚙️ 设置 → 记忆 → 记忆备份与迁移**。

| 格式 | 特点 | 适用场景 |
|---|---|---|
| **JSON** | 完整保留内容、标签、置顶、来源 | 备份、迁移、程序处理 |
| **Markdown** | 人类可读，列表形式，带标签与置顶标记 | 贴进笔记软件（Obsidian / Notion / 语雀） |
| **纯文本 TXT** | 每行一条，最干净 | 粘贴到任何地方、喂给其他工具 |
| **CSV** | 带 BOM，Excel / WPS 直接打开不乱码 | 表格化管理、批量编辑 |

导出示例（Markdown）：

```markdown
# ChatUI 长期记忆

> 导出时间：2026-10-02 21:07
> 记忆条数：3

---

- ★ 用户住在上海，平时喜欢喝咖啡 #生活
- 用户偏好中文回答，代码需要加注释 #偏好
- 用户是前端工程师，主要写 React 和 TypeScript #技术栈
```

**导入规则**（四种格式通用，自动识别）：
- 每行一条；`-` / `*` / `1.` 等列表前缀会自动剥离，标题、引用、分隔线、代码块会被跳过
- 行内 `#标签` 会自动提取为记忆标签（`C#`、`#1` 这类不会误判）
- `★` / `📌` 前缀会还原为「置顶」
- 已存在的相同内容自动跳过，不会重复入库
- 也可直接导入 `ChatUI` 全量备份 JSON（其中的 `memories` 数组会被识别）

> 「设置 → 数据 → 导出全部数据 (JSON)」同样包含记忆库，适合整机备份。

---

## 📥 导入对话 / 备份 / 记忆

**入口**：顶栏 ↑（导入）按钮 · 欢迎页「📥 导入对话 / 备份」卡片 · 设置 → 数据 · 导出弹窗 · 把 `.json` 文件直接拖进聊天区。

支持导入的来源（自动识别，全部在本机解析，不会上传任何数据）：

| 来源 | 说明 |
|---|---|
| **ChatGPT 官方导出** | `conversations.json`（mapping 树结构），只保留当前分支，自动过滤隐藏消息与工具调用 |
| **Claude 官方导出** | `conversations.json`（chat_messages 结构） |
| **ChatUI 全量备份** | 可勾选恢复服务商与 API Key / 设置 / 助手 / 记忆 |
| **ChatUI 单条对话 JSON** | 自己导出的「当前对话 → JSON」，含思维链 |
| **通用 OpenAI 消息数组** | `[{role, content}, …]`、`{messages:[…]}`、多对话数组、JSONL |
| **Markdown / 纯文本对话记录** | 识别 `### 🧑 用户 · 10:00`、`**User:**`、`User:`、`- 用户：` 等常见写法 |
| **记忆文件** | 本应用导出的记忆 JSON / Markdown / TXT / CSV |

使用要点：
- **拖入或选择文件后先预览再导入**：显示识别出的来源、对话数、消息数与对话列表
- **导入方式**：每个对话单独导入（推荐），或全部合并为一个对话（自动插入来源分隔）
- **归属服务商**：导入的对话可指定挂到哪个服务商下，之后可随时在顶部切换模型继续聊
- **自动去重**：标题与内容都相同的对话、内容相同的记忆会自动跳过，重复导入同一文件不会产生重复数据
- **识别方式可手动切换**：自动识别不准时，可强制「按对话」或「按记忆」解析
- 系统（system）消息会转为该对话的系统提示词，不会混进消息流
- 导入内容经过 DOMPurify 净化后渲染，脚本与事件属性会被剥离

> ChatGPT 导出方法：ChatGPT → Settings → Data controls → Export data，邮件里下载的压缩包中的 `conversations.json` 就是它。

---

## ⌨️ 快捷键

| 按键 | 功能 |
|---|---|
| `Enter` | 发送 |
| `Shift + Enter` | 换行 |
| `Ctrl + Enter` | 发送（当 Enter 设为换行时） |
| `Esc` | 停止生成 / 关闭弹窗 |
| `Ctrl + K` | 搜索对话 |
| `Ctrl + Shift + O` | 新建对话 |
| `Ctrl + B` | 收起 / 展开侧边栏 |
| `Ctrl + M` | 记忆管理器 |
| `Ctrl + /` | 快捷键帮助 |
| `↑`（输入框为空时） | 取上一条消息编辑 |

---

## 🧠 记忆是怎么工作的

1. **存储**：每条记忆是一条独立短句（如「用户是前端工程师，主写 React」），存在 `localStorage`。
2. **检索**：每次发消息时，对用户输入与记忆做中文分词 + 关键词命中评分，取相关度最高的若干条（默认 6 条、2000 字以内）。
3. **注入**：被选中的记忆以「关于用户的长期记忆」小节附加到本次请求的系统提示末尾，不会改动你保存的系统提示词。
4. **自动抽取**：开启后，每积累约 4 条新消息会让模型提取最多 3 条稳定事实，去重后入库。
5. **上下文压缩**：超过 token 预算时，可裁剪最旧消息（快）或自动生成滚动摘要（省 token 且保留结论）。

---

## 📁 目录结构

```
ChatUI/
├── index.html              # 入口页面（外壳布局用 Tailwind 工具类直接书写）
├── start.bat / start.sh    # 一键本地启动（样式产物缺失时会自动 npm run build）
├── src/
│   └── tailwind.css        # 样式源文件：@theme 设计令牌 + @layer components
├── package.json            # npm run build / dev（Tailwind 本地编译，不联网）
├── assets/
│   ├── css/app.css         # Tailwind 编译产物（已提交，改样式才需要重新构建）
│   ├── js/
│   │   ├── util.js         # 通用工具（DOM/剪贴板/文件/token 估算）
│   │   ├── store.js        # localStorage 数据层 + 服务商预设
│   │   ├── api.js          # OpenAI 兼容协议（SSE 流式解析）
│   │   ├── markdown.js     # Markdown 渲染 + 高亮 + 复制 + 公式
│   │   ├── memory.js       # 记忆检索 / 摘要压缩 / 自动抽取
│   │   ├── importer.js     # 导入解析（ChatGPT / Claude / 备份 / Markdown）
│   │   ├── ui.js           # 界面与交互
│   │   └── app.js          # 启动入口
│   └── vendor/             # marked / DOMPurify / highlight.js / KaTeX（已本地化，离线可用）
```

## 🎨 样式架构（Tailwind CSS v4）

样式用 **Tailwind CSS v4** 管理，但**不走 CDN**——由本地 CLI 编译出 `assets/css/app.css` 一并提交，断网、`file://` 双击直开都不受影响。

```bash
npm install          # 首次
npm run build        # 编译样式（改动 src/tailwind.css 或 index.html 之后）
npm run dev          # 监听模式，边改边编译
```

**分层约定**（都在 `src/tailwind.css`）：

| 层 | 内容 | 说明 |
|---|---|---|
| `@theme` | 设计令牌 | 全部颜色、圆角、字体、阴影、缓动、动画的**唯一来源** |
| `@layer base` | 全局基础 | body 字号/底色、滚动条之外的重置补充 |
| `@layer components` | 组件类 | `.btn` `.msg` `.md` `.code-block` 等，用 `@apply` 组合工具类 |
| 文件末尾原生 CSS | 状态与响应式 | 伪元素、后代状态、`@media`、`@media print` |

**改主题色只需要改一处**：`@theme` 里默认是深色值，`html[data-theme="light"]` 只覆盖令牌值，所有工具类和组件类会自动跟着变——这正是深浅色切换零成本的原因。

几个实用细节：

- `index.html` 的外壳布局直接写 Tailwind 工具类；JS 动态生成的 DOM（消息、弹窗内容）沿用 `.msg`、`.btn` 这类语义组件类，两者共用同一套令牌
- 保留 `--bg`、`--text`、`--accent` 等旧变量作为**别名**指向新令牌，`ui.js` 里的内联样式（如 `style="color:var(--warn)"`）无需改动
- `--fs`（正文字号）仍由设置面板运行时写入 `documentElement`
- ⚠️ Tailwind 的 preflight 会清掉 `h1`~`h6` 的字号和 `ul/ol` 的列表符号，`.md` 里已逐一补回，新增 Markdown 相关样式时注意

## 🖼 图标体系（全程 SVG，不用 emoji）

界面里**不出现任何 emoji**——跨平台字形不一致、无法随主题换色，也无法对齐像素网格。所有图标都来自 `index.html` 顶部的一段内联 SVG 雪碧图（`<symbol id="i-xxx">`），共 40+ 个描边图标。

- **取用方式**：JS 里 `U.icon('i-pin')` 生成 `<svg class="ic"><use href="#i-pin"/></svg>`；静态 HTML 直接写同样的标记
- **随主题换色**：图标一律用 `currentColor` 描边/填充，继承父级文字色，深浅色主题零成本
- **统一尺寸**：`.ic` 默认 18px，各容器（按钮、标签、头像、菜单）里有对应的覆盖规则
- **助手图标**：助手预设存的是图标 id（`icon: 'i-terminal'`）而非 emoji 字符，编辑弹窗里是 16 格的图标网格选择器；**旧数据里存过 emoji 的会自动映射迁移**（如 `✍️ → i-pen`），无需手动处理
- **加新图标**：往雪碧图里加一个 `<symbol>` 即可，注意保持 24×24 viewBox、`stroke-width≈1.7`、`fill="none"` 的描边风格，整体才协调

## 🔒 隐私与安全

- 无后端、无埋点、无第三方请求（除你配置的模型接口）
- API Key 仅存于本浏览器，导出备份时请妥善保管 JSON 文件
- 模型输出的 HTML 会经 DOMPurify 净化，脚本与事件属性被剥离
- 清除浏览器站点数据 = 清空全部对话与配置，建议定期「导出全部数据」

## ❓ 常见问题

**Q：发送后报 `Failed to fetch`？**
地址写错、服务未启动，或该服务不允许浏览器跨域。本地模型先确认服务已启动并设置了 `OLLAMA_ORIGINS`；云服务建议改用支持 CORS 的中转地址。

**Q：报 404？**
Base URL 少了 `/v1`（页面会自动补全，但部分网关路径不同），或模型名不存在。

**Q：401？**
API Key 错误 / 未填，或使用了需要 Key 的中转。

**Q：回复只有一段就停了？**
检查服务商额度与 429 限流，或在设置里调大超时时间。

**Q：换浏览器后数据没了？**
数据按浏览器 + 站点隔离存储，用「设置 → 数据 → 导出全部数据」迁移。
