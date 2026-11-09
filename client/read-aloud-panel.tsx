import type {
  PluginClientContext,
  PluginScreenProps,
} from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent, ScrollView as NativeScrollView } from "react-native";
import { Pressable, Text, View } from "react-native";
import { synthesizeSpeechRpc } from "../shared/speech";
import {
  buildConversationSpeechUnits,
  buildSpeechHighlightSteps,
  prepareTextForSpeech,
  splitIntoSpeechSegments,
  tokenizeSpeechText,
  type SpeechSegment,
} from "../shared/text";
import { playAudio, stopActiveAudio } from "./audio";

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

const RESPONSE_LIMIT = 30;

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
  return function ReadAloudScreen({ params, theme, layout }: PluginScreenProps) {
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
        theme={theme}
        layout={layout}
      />
    );
  };
}

function ReadAloudPanelContent({
  agentId,
  client,
  theme,
  layout,
}: Pick<PluginScreenProps, "theme" | "layout"> & {
  agentId: string;
  client: PluginClientContext;
}) {
  const toast = useToast();
  const [responses, setResponses] = useState<AssistantResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({ status: "idle" });
  const [voice, setVoice] = useState<string>("female-shaonv");
  const [speed, setSpeed] = useState(1);
  const playbackToken = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      error: {
        color: theme.colors.statusDanger,
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
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

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
  }, []);

  const loadResponses = useCallback(async () => {
    try {
      const timeline = await client.paseo.agents.ref(agentId).timeline.refetch({
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
      setResponses(next);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [agentId, client.paseo.agents]);

  useEffect(() => {
    setLoading(true);
    void loadResponses();
    const timeline = client.paseo.agents.ref(agentId).timeline;
    const unsubscribe = timeline.subscribe(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void loadResponses(), 250);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      clearHighlightTimer();
      playbackToken.current += 1;
      stopActiveAudio();
    };
  }, [agentId, clearHighlightTimer, client.paseo.agents, loadResponses]);

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
    clearHighlightTimer();
    const stoppedImmediately = stopActiveAudio();
    setPlayback({ status: "idle" });
    toast.show(
      stoppedImmediately ? "已停止朗读" : "已停止后续内容，当前音频分段结束后停止",
      { variant: "info" },
    );
  }, [clearHighlightTimer, toast]);

  const startWordHighlight = useCallback(
    (
      token: number,
      location: {
        responseId: string;
        responseIndex: number;
        segmentIndex: number;
        text: string;
      },
      durationMs: number,
    ) => {
      clearHighlightTimer();
      const steps = buildSpeechHighlightSteps(location.text, durationMs);
      const startedAt = Date.now();
      let stepIndex = 0;
      const scheduleNext = () => {
        const step = steps[stepIndex];
        if (!step || playbackToken.current !== token) return;
        const delay = Math.max(0, step.atMs - (Date.now() - startedAt));
        highlightTimer.current = setTimeout(() => {
          if (playbackToken.current !== token) return;
          setPlayback({
            status: "speaking",
            responseId: location.responseId,
            responseIndex: location.responseIndex,
            segmentIndex: location.segmentIndex,
            tokenIndex: step.tokenIndex,
          });
          stepIndex += 1;
          scheduleNext();
        }, delay);
      };
      scheduleNext();
    },
    [clearHighlightTimer],
  );

  const speakFrom = useCallback(
    async (responseIndex: number, segmentIndex: number) => {
      const token = ++playbackToken.current;
      clearHighlightTimer();
      stopActiveAudio();
      const units = buildConversationSpeechUnits(responses, responseIndex, segmentIndex);
      if (units.length === 0) return;

      const firstUnit = units[0];
      setPlayback({
        status: "preparing",
        responseId: firstUnit.responseId,
        responseIndex: firstUnit.responseIndex,
        segmentIndex: firstUnit.segmentIndex,
        tokenIndex: null,
      });
      scrollToSegment(firstUnit.responseId, firstUnit.segmentIndex);

      const synthesize = async (text: string) => {
        try {
          return {
            audio: await client.rpc(synthesizeSpeechRpc, {
              text,
              voice: voice || undefined,
              speed,
            }),
          } as const;
        } catch (rpcError) {
          return { error: rpcError } as const;
        }
      };

      try {
        let prepared = await synthesize(firstUnit.text);
        for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
          if (playbackToken.current !== token) return;
          if ("error" in prepared) throw prepared.error;

          const unit = units[unitIndex];
          const nextUnit = units[unitIndex + 1];
          const nextAudio = nextUnit ? synthesize(nextUnit.text) : null;
          setPlayback({
            status: "speaking",
            responseId: unit.responseId,
            responseIndex: unit.responseIndex,
            segmentIndex: unit.segmentIndex,
            tokenIndex: null,
          });
          scrollToSegment(unit.responseId, unit.segmentIndex);
          startWordHighlight(token, unit, prepared.audio.durationMs);
          await playAudio(client, prepared.audio);
          clearHighlightTimer();
          if (playbackToken.current !== token) return;

          if (nextAudio && nextUnit) {
            setPlayback({
              status: "preparing",
              responseId: nextUnit.responseId,
              responseIndex: nextUnit.responseIndex,
              segmentIndex: nextUnit.segmentIndex,
              tokenIndex: null,
            });
            prepared = await nextAudio;
          }
        }
        if (playbackToken.current === token) {
          setPlayback({ status: "idle" });
          toast.show("已从上到下朗读完成", { variant: "success" });
        }
      } catch (nextError) {
        if (playbackToken.current !== token) return;
        clearHighlightTimer();
        setPlayback({ status: "idle" });
        toast.error(nextError instanceof Error ? nextError.message : String(nextError));
      }
    },
    [
      clearHighlightTimer,
      client,
      responses,
      scrollToSegment,
      speed,
      startWordHighlight,
      toast,
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
              按对话顺序从上往下连续朗读；自动清理 Markdown、链接、代码和装饰字符，点击任意句子可从那里继续。
            </Text>
          </View>
          <View style={styles.headerActions}>
            <ActionButton
              label="刷新"
              icon="RefreshCw"
              disabled={isActive}
              onPress={() => void loadResponses()}
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

        {error ? <Text style={styles.error}>{error}</Text> : null}
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
                    const tokens = tokenizeSpeechText(segment.text);
                    return (
                      <Pressable
                        key={segment.id}
                        testID={`read-aloud-segment-${responseIndex}-${segmentIndex}`}
                        accessibilityRole="button"
                        accessibilityLabel={
                          segmentActive
                            ? `${segmentSpeaking ? "正在朗读" : "正在准备"}第 ${segmentIndex + 1} 句：${segment.text}`
                            : `从第 ${segmentIndex + 1} 句开始连续朗读`
                        }
                        accessibilityHint="将继续朗读这句话之后的全部回复"
                        accessibilityState={{ selected: segmentActive }}
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
                        <Icon
                          name={segmentActive ? "AudioLines" : "Play"}
                          size={16}
                          color={
                            segmentActive ? theme.colors.accent : theme.colors.foregroundMuted
                          }
                        />
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
