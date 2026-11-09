# Paseo 专属朗读

这是一个面向当前 Paseo 正式版的朗读插件。它不依赖尚未合并的 response-action/read-aloud PR。

## 功能

- 每个会话的输入框旁显示“朗读”入口。
- 最近 30 条助手回复按时间从上往下展示。
- 点击一次即可从顶部连续朗读到底，也可从任意一句开始并继续后续回复。
- 按真实音频时长近似逐词高亮，并自动跟随当前句子。
- 朗读前自动清理 Markdown、裸链接、代码块、无意义附件标签和纯符号段落。
- 提供多种女声音色和慢速、正常、稍快、快速四档语速。
- 自动跟随当前会话的新回复。
- 复用 Paseo“设置 → 语音”中的 OpenAI 兼容 TTS 配置。
- 网页和桌面客户端支持立即停止；原生移动客户端在当前短分段结束后停止。

## 安装

需要 Paseo 0.15.3 或更高版本，并在“设置 → 语音”中配置 OpenAI 兼容的 TTS 服务。

```bash
paseo plugin install github:danshuitaihejie/paseo-read-aloud
```

插件内置的四种女声音色使用 MiniMax 音色 ID；其他 OpenAI 兼容服务请选择“Paseo 默认”，是否支持自定义音色取决于服务端。

## 开发

```bash
npm install --ignore-scripts
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo-read-aloud
```

源码变更后使用：

```bash
paseo plugin reload paseo-read-aloud
```

## 当前限制

正式版公开插件 API 不能把按钮注入原生回复底部，也不能直接调用 Paseo 内置的 local TTS provider。因此本插件使用独立的全屏朗读页面，并要求“设置 → 语音”中的 TTS provider 为 OpenAI 兼容端点。等待上游 API 发布后，可以保留现有语音与分段逻辑，只替换入口 UI。
