# Paseo Read Aloud

[简体中文](README.md) | **English**

Listen and keep the conversation going in Paseo. Read assistant responses continuously, start from any sentence, ask follow-up questions on the same page, and hear new content as it arrives.

![Read Aloud in action: word highlighting, a follow-up question, and automatic continuation](docs/media/read-aloud-demo.gif)

Recorded from the plugin UI with a sample conversation. Both the GIF and video are silent. [Download the MP4 demo](docs/media/read-aloud-demo.mp4).

## Features

| Feature                | How it works                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Continuous reading     | Start at the top or at any sentence and keep listening through later responses.                                |
| Automatic continuation | Wait at the end of the current content, then resume from the saved position when a reply or more text arrives. |
| Follow-up chat         | A text field and Send button use the same agent, model, and configuration.                                     |
| Saved progress         | Each conversation remembers your reading progress so you can continue with unread content.                     |
| Reading guidance       | Approximate word highlighting and scrolling follow the active sentence.                                        |
| Audio preparation      | A rolling buffer preloads the next 5 chunks, shows loading states, and caches synthesized audio.               |
| Voices and speed       | Choose from 4 MiniMax female voice presets and playback speeds of 0.8×, 1×, 1.2×, or 1.5×.                     |

Before synthesis, the plugin removes Markdown decoration, raw URLs, code blocks, generic attachment labels, and symbol-only paragraphs. It preserves readable headings, lists, tables, and link labels.

## Screenshots

Desktop: responses, reading controls, and a follow-up input on one page.

![Desktop reading page with an active word highlighted and a follow-up input at the bottom](docs/media/read-aloud-desktop.png)

<details>
<summary>See the compact layout and dark theme</summary>

<img src="docs/media/read-aloud-mobile.png" width="360" alt="Compact reading page in dark mode with a simple input and Send button at the bottom" />

</details>

## Install

Requires **Paseo 0.15.3 or later**.

1. Enable plugins under Paseo's **Settings → Plugins**.
2. Configure an OpenAI-compatible TTS service under **Settings → Voice**.
3. Install the plugin:

```bash
paseo plugin install github:danshuitaihejie/paseo-read-aloud
```

Open an agent conversation and select **朗读** beside its composer, or choose **打开专属朗读** in the Command Center. The plugin's current controls use Chinese labels.

The built-in female voice presets use MiniMax voice IDs. For another OpenAI-compatible service, choose **Paseo 默认** to use the voice from Paseo's settings.

## Use

1. Select **从顶部开始** to start at the top, **继续朗读** to resume, or select any sentence.
2. Type a question at the bottom and press Send while reading continues. Enter inserts a new line. Accepted messages clear the input; failed messages stay available for retry.
3. Keep the page open at the end of the content. New responses resume playback automatically.
4. Select **停止** to stop reading and automatic continuation.

## TTS and data

The plugin reuses Paseo's existing TTS configuration without storing another API key. Text selected for reading goes to your configured TTS service, and the resulting audio plays on the current client. Follow-up questions go to the agent in the current conversation.

## Limits

- The page shows up to the 30 most recent readable assistant responses.
- Speech generation uses an OpenAI-compatible TTS endpoint. Paseo's built-in local speech models are not exposed to this plugin.
- Word timing is estimated from audio duration and text weights, rather than precise forced alignment.
- Web and desktop clients can stop audio immediately. Native mobile clients finish the current audio chunk when the host does not provide immediate stopping.
- Reading uses a separate page; the plugin does not add buttons to native message footers.

## Development

```bash
npm install --ignore-scripts
npm run typecheck
npx vitest run tests/read-aloud-panel.test.tsx --bail=1
paseo plugin install /absolute/path/to/paseo-read-aloud
```

After editing source files, check types and reload the plugin:

```bash
npm run typecheck
paseo plugin reload paseo-read-aloud
```

## License

[MIT](LICENSE)
