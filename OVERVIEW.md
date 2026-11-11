# Read aloud

Read aloud adds a dedicated reading page to each Paseo agent conversation. It displays recent assistant responses in chronological order. Start at the top or choose a sentence to begin continuous reading. When playback reaches the latest content, it waits and continues when a reply or more text arrives.

During playback, the page highlights the current word using an estimate based on audio duration and text weight. The page follows the active sentence until you scroll manually. Manual scrolling pauses automatic following while speech and highlighting continue. Select **恢复跟随** to return to the active sentence and follow it again; following does not resume on a timer.

The page includes a text field for sending follow-up questions to the same agent with its current model and configuration. Reading progress is saved per conversation. The player prepares up to five upcoming audio chunks in a rolling buffer, displays loading sentences, and caches synthesized audio.

Before synthesis, the plugin removes Markdown decoration, raw URLs, code blocks, generic attachment labels, and symbol-only paragraphs. It preserves readable headings, lists, tables, and link labels. Speech uses the OpenAI-compatible TTS provider configured in Paseo's Voice settings; selected text is sent to that provider and audio plays on the current client. The plugin does not store another API key. It includes four MiniMax female voice presets and playback speeds of 0.8×, 1×, 1.2×, and 1.5×.

Paseo 0.15.3 or later is required. Paseo's local speech provider is not exposed through the current public plugin API. Web and desktop clients can stop audio immediately. Native mobile clients finish the current audio chunk when the host does not provide immediate stopping. The reading controls are on a dedicated page, separate from native message footers.
