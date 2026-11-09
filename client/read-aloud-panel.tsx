import type {
  PluginClientContext,
  PluginScreenProps,
} from "@getpaseo/plugin/client";
import { getPaseoClient, useHosts } from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent, ScrollView as NativeScrollView } from "react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { synthesizeSpeechRpc } from "../shared/speech";
import {
  buildConversationSpeechUnits,
  prepareTextForSpeech,
  splitIntoSpeechSegments,
  tokenizeSpeechText,
  type ConversationSpeechUnit,
  type SpeechSegment,
} from "../shared/text";
import { prepareAudio, stopActiveAudio } from "./audio";
import { isTransientConnectionError } from "./connection-errors";
import { runPrefetchedPlayback } from "./prefetched-playback";

interface AssistantResponse {
  id: string;
  text: string;
  timestamp: Date;
  segments: SpeechSegment[];
}

type PlaybackState =
  | { status: "idle" }
  | {
      status: "preparing" | "speaking";
      responseId: string;
      responseIndex: number;
      segmentIndex: number;
      tokenIndex: number | null;
    };

interface PlaybackError {
  message: string;
  responseIndex: number;
  segmentIndex: number;
}

const RESPONSE_LIMIT = 30;
const PREFETCH_LOOKAHEAD = 1;
const CONNECTION_RETRY_MAX_DELAY_MS = 5_000;

const VOICE_OPTIONS = [
  { value: "female-shaonv", label: "清甜女声" },
  { value: "female-yujie", label: "知性女声" },
  { value: "female-chengshu", label: "成熟女声" },
  { value: "female-tianmei", label: "甜美女声" },
  { value: "", label: "Paseo 默认" },
] as const;

const SPEED_OPTIONS = [
  { value: 0.8, label: "慢速" },
  { value: 1, label: "正常" },
  { value: 1.2, label: "稍快" },
  { value: 1.5, label: "快速" },
] as const;

export function createReadAloudScreen(client: PluginClientContext) {
  return function ReadAloudScreen({ params, theme, host, layout }: PluginScreenProps) {
    const agentId = params.agentId;
    if (!agentId) {
      return (
        <View
          style={{
            flex: 1,
            padding: layout.compact ? 16 : 24,
            backgroundColor: theme.colors.surface0,
          }}
        >
          <Text style={{ color: theme.colors.statusDanger }}>没有找到要朗读的对话。</Text>
        </View>
      );
    }
    return (
      <ReadAloudPanelContent
        agentId={agentId}
        client={client}
        hostId={host.id}
        theme={theme}
        layout={layout}
      />
    );
  };
}

function ReadAloudPanelContent({
  agentId,
  client,
  hostId,
  theme,
  layout,
}: Pick<PluginScreenProps, "theme" | "layout"> & {
  agentId: string;
  client: PluginClientContext;
  hostId: string;
}) {
  const hosts = useHosts();
  const hostStatus = hosts.find((host) => host.serverId === hostId)?.status;
  const toast = useToast();
  const [responses, setResponses] = useState<AssistantResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({ status: "idle" });
  const [playbackError, setPlaybackError] = useState<PlaybackError | null>(null);
  const [loadingSegments, setLoadingSegments] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [voice, setVoice] = useState<string>("female-shaonv");
  const [speed, setSpeed] = useState(1);
  const playbackToken = useRef(0);
  const loadRequestToken = useRef(0);
  const loadResponsesRef = useRef<() => Promise<void>>(async () => {});
  const connectionRetryAttempt = useRef(0);
  const connectionRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSegmentCounts = useRef(new Map<string, number>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousHost = useRef({ id: hostId, status: hostStatus });
  const hostStatusRef = useRef(hostStatus);
  const scrollRef = useRef<NativeScrollView>(null);
  const responseOffsets = useRef(new Map<string, number>());
  const listOffsets = useRef(new Map<string, number>());
  const segmentOffsets = useRef(new Map<string, number>());

  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: 12 },
      header: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        justifyContent: "space-between" as const,
        gap: 12,
      },
      titleGroup: { flex: 1, gap: 4 },
      title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "600" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      headerActions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
      },
      buttonActive: { backgroundColor: theme.colors.accent },
      buttonDisabled: { opacity: 0.45 },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      buttonTextActive: { color: theme.colors.accentForeground, fontSize: 13 },
      controls: {
        padding: 12,
        gap: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
      },
      controlRow: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 8,
      },
      controlLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        width: layout.compact ? undefined : 64,
      },
      chipRow: { flex: 1, flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      chipActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      chipText: { color: theme.colors.foreground, fontSize: 12 },
      chipTextActive: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      errorPanel: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 10,
        padding: 12,
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      },
      errorText: {
        flex: 1,
        color: theme.colors.statusDanger,
        fontSize: 13,
        lineHeight: 19,
      },
      empty: {
        color: theme.colors.foregroundMuted,
        paddingVertical: 24,
        textAlign: "center" as const,
      },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      cardHeader: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      cardTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      timestamp: { color: theme.colors.foregroundMuted, fontSize: 12 },
      segmentList: { borderTopWidth: 1, borderTopColor: theme.colors.border },
      segment: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      segmentActive: { backgroundColor: theme.colors.surface2 },
      segmentActiveMarker: {
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
        paddingLeft: 9,
      },
      segmentNumber: { color: theme.colors.foregroundMuted, fontSize: 12, width: 28 },
      segmentNumberActive: { color: theme.colors.accent, fontWeight: "700" as const },
      segmentText: { color: theme.colors.foreground, fontSize: 15, lineHeight: 24, flex: 1 },
      segmentTextActive: { fontWeight: "500" as const },
      wordActive: {
        color: theme.colors.accentForeground,
        backgroundColor: theme.colors.accent,
        fontWeight: "700" as const,
      },
    }),
    [layout.compact, theme],
  );
  hostStatusRef.current = hostStatus;

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
  }, []);

  const clearLoadingSegments = useCallback(() => {
    loadingSegmentCounts.current.clear();
    setLoadingSegments(new Set());
  }, []);

  const updateLoadingSegment = useCallback(
    (token: number, unit: ConversationSpeechUnit, change: 1 | -1) => {
      if (playbackToken.current !== token) return;
      const keys = new Set(
        unit.parts.map((part) => `${part.responseId}:${part.segmentIndex}`),
      );
      for (const key of keys) {
        const nextCount = (loadingSegmentCounts.current.get(key) ?? 0) + change;
        if (nextCount > 0) loadingSegmentCounts.current.set(key, nextCount);
        else loadingSegmentCounts.current.delete(key);
      }
      setLoadingSegments(new Set(loadingSegmentCounts.current.keys()));
    },
    [],
  );

  const clearConnectionRetry = useCallback(() => {
    if (connectionRetryTimer.current) clearTimeout(connectionRetryTimer.current);
    connectionRetryTimer.current = null;
    connectionRetryAttempt.current = 0;
  }, []);

  const scheduleConnectionRetry = useCallback(() => {
    if (connectionRetryTimer.current) return;
    const delay = Math.min(
      500 * 2 ** connectionRetryAttempt.current,
      CONNECTION_RETRY_MAX_DELAY_MS,
    );
    connectionRetryAttempt.current += 1;
    connectionRetryTimer.current = setTimeout(() => {
      connectionRetryTimer.current = null;
      void loadResponsesRef.current();
    }, delay);
  }, []);

  const loadResponses = useCallback(async () => {
    const requestToken = ++loadRequestToken.current;
    setRefreshing(true);
    try {
      const timeline = await getPaseoClient(hostId).agents.ref(agentId).timeline.refetch({
        direction: "tail",
        limit: 240,
        projection: "projected",
      });
      if (timeline.error) throw new Error(timeline.error);
      const next = timeline.entries
        .flatMap((entry): AssistantResponse[] => {
          if (entry.item.type !== "assistant_message") return [];
          const text = prepareTextForSpeech(entry.item.text);
          if (!text) return [];
          const segments = splitIntoSpeechSegments(text);
          if (segments.length === 0) return [];
          return [
            {
              id: entry.item.messageId ?? `${entry.seqStart}:${entry.seqEnd}`,
              text,
              timestamp: new Date(entry.timestamp),
              segments,
            },
          ];
        })
        .slice(-RESPONSE_LIMIT);
      if (loadRequestToken.current !== requestToken) return;
      clearConnectionRetry();
      setResponses(next);
      setError(null);
    } catch (nextError) {
      if (loadRequestToken.current !== requestToken) return;
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      if (hostStatusRef.current === "online" && isTransientConnectionError(message)) {
        scheduleConnectionRetry();
      }
    } finally {
      if (loadRequestToken.current === requestToken) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [agentId, clearConnectionRetry, hostId, scheduleConnectionRetry]);
  loadResponsesRef.current = loadResponses;

  useEffect(() => {
    setLoading(true);
    void loadResponsesRef.current();
  }, [agentId, hostId]);

  useEffect(() => {
    if (hostStatus !== "online") return;
    const timeline = getPaseoClient(hostId).agents.ref(agentId).timeline;
    const unsubscribe = timeline.subscribe(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void loadResponses(), 250);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [agentId, hostId, hostStatus, loadResponses]);

  useEffect(() => {
    return () => {
      loadRequestToken.current += 1;
      playbackToken.current += 1;
      loadingSegmentCounts.current.clear();
      clearConnectionRetry();
      clearHighlightTimer();
      stopActiveAudio();
    };
  }, [agentId, clearConnectionRetry, clearHighlightTimer]);

  useEffect(() => {
    const previous = previousHost.current;
    previousHost.current = { id: hostId, status: hostStatus };
    if (hostStatus !== "online") {
      clearConnectionRetry();
      return;
    }
    if (previous.id === hostId && previous.status !== "online") {
      void loadResponses();
    }
  }, [clearConnectionRetry, hostId, hostStatus, loadResponses]);

  const retryLoadResponses = useCallback(() => {
    clearConnectionRetry();
    void loadResponses();
  }, [clearConnectionRetry, loadResponses]);

  const scrollToSegment = useCallback((responseId: string, segmentIndex: number) => {
    const responseY = responseOffsets.current.get(responseId);
    const listY = listOffsets.current.get(responseId);
    const segmentY = segmentOffsets.current.get(`${responseId}:${segmentIndex}`);
    if (responseY === undefined || listY === undefined || segmentY === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, responseY + listY + segmentY - 88),
      animated: true,
    });
  }, []);

  const stop = useCallback(() => {
    playbackToken.current += 1;
    clearLoadingSegments();
    clearHighlightTimer();
    const stoppedImmediately = stopActiveAudio();
    setPlayback({ status: "idle" });
    toast.show(
      stoppedImmediately ? "已停止朗读" : "已停止后续内容，当前音频分段结束后停止",
      { variant: "info" },
    );
  }, [clearHighlightTimer, clearLoadingSegments, toast]);

  const startChunkHighlight = useCallback(
    (token: number, unit: ConversationSpeechUnit, durationMs: number) => {
      clearHighlightTimer();
      const weightedTokens = unit.parts.flatMap((part) =>
        tokenizeSpeechText(part.text).map((speechToken, tokenIndex) => ({
          part,
          speechToken,
          tokenIndex,
        })),
      );
      const totalWeight = weightedTokens.reduce(
        (sum, item) => sum + item.speechToken.weight,
        0,
      );
      let elapsedWeight = 0;
      const steps = weightedTokens.flatMap((item) => {
        const atMs =
          totalWeight > 0 ? Math.round((elapsedWeight / totalWeight) * durationMs) : 0;
        elapsedWeight += item.speechToken.weight;
        return item.speechToken.isWord ? [{ ...item, atMs }] : [];
      });
      const startedAt = Date.now();
      let stepIndex = 0;
      let activeSegmentKey = "";
      const scheduleNext = () => {
        const step = steps[stepIndex];
        if (!step || playbackToken.current !== token) return;
        const delay = Math.max(0, step.atMs - (Date.now() - startedAt));
        highlightTimer.current = setTimeout(() => {
          if (playbackToken.current !== token) return;
          setPlayback({
            status: "speaking",
            responseId: step.part.responseId,
            responseIndex: step.part.responseIndex,
            segmentIndex: step.part.segmentIndex,
            tokenIndex: step.tokenIndex,
          });
          const segmentKey = `${step.part.responseId}:${step.part.segmentIndex}`;
          if (segmentKey !== activeSegmentKey) {
            activeSegmentKey = segmentKey;
            scrollToSegment(step.part.responseId, step.part.segmentIndex);
          }
          stepIndex += 1;
          scheduleNext();
        }, delay);
      };
      scheduleNext();
    },
    [clearHighlightTimer, scrollToSegment],
  );

  const speakFrom = useCallback(
    async (responseIndex: number, segmentIndex: number) => {
      const token = ++playbackToken.current;
      setPlaybackError(null);
      clearLoadingSegments();
      clearHighlightTimer();
      stopActiveAudio();
      const units = buildConversationSpeechUnits(responses, responseIndex, segmentIndex);
      if (units.length === 0) return;
      let failedUnit: ConversationSpeechUnit | null = null;

      try {
        await runPrefetchedPlayback({
          items: units,
          lookahead: PREFETCH_LOOKAHEAD,
          shouldContinue: () => playbackToken.current === token,
          onPreparing: (unit) => {
            setPlayback({
              status: "preparing",
              responseId: unit.responseId,
              responseIndex: unit.responseIndex,
              segmentIndex: unit.segmentIndex,
              tokenIndex: null,
            });
            scrollToSegment(unit.responseId, unit.segmentIndex);
          },
          async prepare(unit) {
            updateLoadingSegment(token, unit, 1);
            try {
              const audio = await client.rpc(synthesizeSpeechRpc, {
                text: unit.text,
                voice: voice || undefined,
                speed,
              });
              return { audio, playback: await prepareAudio(client, audio) };
            } catch (nextError) {
              failedUnit = unit;
              throw nextError;
            } finally {
              updateLoadingSegment(token, unit, -1);
            }
          },
          onPlaying: (prepared, unit) => {
            setPlayback({
              status: "speaking",
              responseId: unit.responseId,
              responseIndex: unit.responseIndex,
              segmentIndex: unit.segmentIndex,
              tokenIndex: null,
            });
            scrollToSegment(unit.responseId, unit.segmentIndex);
            startChunkHighlight(token, unit, prepared.audio.durationMs);
          },
          async play(prepared) {
            await prepared.playback.play();
            clearHighlightTimer();
          },
          dispose(prepared) {
            prepared.playback.dispose();
          },
        });
        if (playbackToken.current === token) {
          clearLoadingSegments();
          setPlayback({ status: "idle" });
          toast.show("已从上到下朗读完成", { variant: "success" });
        }
      } catch (nextError) {
        if (playbackToken.current !== token) return;
        clearLoadingSegments();
        clearHighlightTimer();
        setPlayback({ status: "idle" });
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        const retryUnit = failedUnit ?? units[0];
        setPlaybackError({
          message,
          responseIndex: retryUnit.responseIndex,
          segmentIndex: retryUnit.segmentIndex,
        });
        toast.error(message);
      }
    },
    [
      clearHighlightTimer,
      clearLoadingSegments,
      client,
      responses,
      scrollToSegment,
      speed,
      startChunkHighlight,
      toast,
      updateLoadingSegment,
      voice,
    ],
  );

  const isActive = playback.status !== "idle";

  if (loading) return <Loading />;

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>连续朗读</Text>
            <Text style={styles.hint}>
              首段快速生成，播放时自动准备下一大段；自动清理 Markdown、链接、代码和装饰字符，点击任意句子可从那里继续。
            </Text>
          </View>
          <View style={styles.headerActions}>
            <ActionButton
              label={refreshing ? "刷新中" : "刷新"}
              icon="RefreshCw"
              disabled={isActive || refreshing}
              onPress={retryLoadResponses}
              styles={styles}
              theme={theme}
            />
            {isActive ? (
              <ActionButton
                label="停止"
                icon="Square"
                active
                onPress={stop}
                styles={styles}
                theme={theme}
              />
            ) : (
              <ActionButton
                label="从顶部开始"
                icon="Play"
                active
                disabled={responses.length === 0}
                onPress={() => void speakFrom(0, 0)}
                styles={styles}
                theme={theme}
              />
            )}
          </View>
        </View>

        <View style={styles.controls} accessibilityLabel="朗读设置">
          <ChoiceRow<string>
            label="声音"
            options={VOICE_OPTIONS}
            value={voice}
            disabled={isActive}
            onChange={setVoice}
            styles={styles}
          />
          <ChoiceRow<number>
            label="语速"
            options={SPEED_OPTIONS}
            value={speed}
            disabled={isActive}
            onChange={setSpeed}
            styles={styles}
          />
        </View>

        {error ? (
          <View style={styles.errorPanel} accessibilityRole="alert">
            <Text selectable style={styles.errorText}>
              {error}
              {isTransientConnectionError(error)
                ? "\n连接恢复后会自动重试，也可以立即手动重试。"
                : "\n请检查后手动重试。"}
            </Text>
            <ActionButton
              label={refreshing ? "重试中" : "重试"}
              icon="RefreshCw"
              disabled={refreshing}
              onPress={retryLoadResponses}
              styles={styles}
              theme={theme}
            />
          </View>
        ) : null}
        {playbackError ? (
          <View style={styles.errorPanel} accessibilityRole="alert">
            <Text selectable style={styles.errorText}>
              朗读失败：{playbackError.message}
              {isTransientConnectionError(playbackError.message)
                ? "\n当前页面和阅读位置已保留，请从失败位置重试。"
                : "\n请从失败位置重试。"}
            </Text>
            <ActionButton
              label="重试朗读"
              icon="Play"
              disabled={isActive}
              onPress={() =>
                void speakFrom(playbackError.responseIndex, playbackError.segmentIndex)
              }
              styles={styles}
              theme={theme}
            />
          </View>
        ) : null}
        {responses.length === 0 ? (
          <Text style={styles.empty}>当前会话还没有可朗读的助手回复。</Text>
        ) : (
          responses.map((response, responseIndex) => {
            const responseActive = playback.status !== "idle" && playback.responseId === response.id;
            return (
              <View
                key={response.id}
                onLayout={(event: LayoutChangeEvent) => {
                  responseOffsets.current.set(response.id, event.nativeEvent.layout.y);
                }}
                style={styles.card}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>回复 {responseIndex + 1}</Text>
                  <Text style={styles.timestamp}>{formatTimestamp(response.timestamp)}</Text>
                </View>
                <View
                  onLayout={(event: LayoutChangeEvent) => {
                    listOffsets.current.set(response.id, event.nativeEvent.layout.y);
                  }}
                  style={styles.segmentList}
                >
                  {response.segments.map((segment, segmentIndex) => {
                    const segmentActive = responseActive && playback.segmentIndex === segmentIndex;
                    const segmentSpeaking = segmentActive && playback.status === "speaking";
                    const segmentLoading = loadingSegments.has(
                      `${response.id}:${segmentIndex}`,
                    );
                    const tokens = tokenizeSpeechText(segment.text);
                    return (
                      <Pressable
                        key={segment.id}
                        testID={`read-aloud-segment-${responseIndex}-${segmentIndex}`}
                        accessibilityRole="button"
                        accessibilityLabel={
                          segmentLoading
                            ? `正在加载第 ${segmentIndex + 1} 句：${segment.text}`
                            : segmentActive
                            ? `${segmentSpeaking ? "正在朗读" : "正在准备"}第 ${segmentIndex + 1} 句：${segment.text}`
                            : `从第 ${segmentIndex + 1} 句开始连续朗读`
                        }
                        accessibilityHint="将继续朗读这句话之后的全部回复"
                        accessibilityState={{ selected: segmentActive, busy: segmentLoading }}
                        onLayout={(event: LayoutChangeEvent) => {
                          segmentOffsets.current.set(
                            `${response.id}:${segmentIndex}`,
                            event.nativeEvent.layout.y,
                          );
                        }}
                        onPress={() => void speakFrom(responseIndex, segmentIndex)}
                        style={[
                          styles.segment,
                          segmentActive && styles.segmentActive,
                          segmentActive && styles.segmentActiveMarker,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentNumber,
                            segmentActive && styles.segmentNumberActive,
                          ]}
                        >
                          {segmentIndex + 1}
                        </Text>
                        <Text
                          selectable
                          style={[
                            styles.segmentText,
                            segmentActive && styles.segmentTextActive,
                          ]}
                        >
                          {tokens.map((token, tokenIndex) => (
                            <Text
                              key={`${token.start}:${token.end}`}
                              testID={
                                segmentSpeaking && playback.tokenIndex === tokenIndex
                                  ? "read-aloud-active-word"
                                  : undefined
                              }
                              style={
                                segmentSpeaking && playback.tokenIndex === tokenIndex
                                  ? styles.wordActive
                                  : undefined
                              }
                            >
                              {token.text}
                            </Text>
                          ))}
                        </Text>
                        {segmentLoading ? (
                          <ActivityIndicator size="small" color={theme.colors.accent} />
                        ) : (
                          <Icon
                            name={segmentActive ? "AudioLines" : "Play"}
                            size={16}
                            color={
                              segmentActive
                                ? theme.colors.accent
                                : theme.colors.foregroundMuted
                            }
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function ChoiceRow<Value extends string | number>({
  label,
  options,
  value,
  disabled,
  onChange,
  styles,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  disabled: boolean;
  onChange(value: Value): void;
  styles: Record<string, object>;
}) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}：${option.label}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                selected && styles.chipActive,
                disabled && styles.buttonDisabled,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  active = false,
  disabled = false,
  onPress,
  styles,
  theme,
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onPress(): void;
  styles: Record<string, object>;
  theme: PluginScreenProps["theme"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Icon
        name={icon}
        size={15}
        color={active ? theme.colors.accentForeground : theme.colors.foregroundMuted}
      />
      <Text style={active ? styles.buttonTextActive : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function formatTimestamp(value: Date) {
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
