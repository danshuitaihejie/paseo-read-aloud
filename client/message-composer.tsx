import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { getPaseoClient } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

interface MessageComposerProps extends Pick<PluginScreenProps, "theme" | "layout"> {
  hostId: string;
  agentId: string;
  online: boolean;
}

export function MessageComposer({ hostId, agentId, online, theme, layout }: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const toast = useToast();
  const sending = useMutation({
    mutationFn: (text: string) => getPaseoClient(hostId).agents.ref(agentId).send(text),
    retry: false,
    onSuccess() {
      setDraft("");
      toast.show("消息已发送", { variant: "success" });
    },
  });
  const text = draft.trim();
  const canSend = online && text.length > 0 && !sending.isPending;
  const styles = useMemo(
    () => ({
      root: {
        paddingHorizontal: layout.compact ? 12 : 20,
        paddingVertical: 12,
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      row: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8 },
      input: {
        flex: 1,
        minHeight: 44,
        maxHeight: 120,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        textAlignVertical: "top" as const,
      },
      send: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.accent,
      },
      disabled: { opacity: 0.45 },
      error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    }),
    [layout.compact, theme],
  );
  const buttonStyle = useMemo(() => [styles.send, !canSend && styles.disabled], [canSend, styles]);
  const accessibilityState = useMemo(
    () => ({ disabled: !canSend, busy: sending.isPending }),
    [canSend, sending.isPending],
  );

  const { mutate } = sending;
  const sendMessage = useCallback(() => {
    if (!canSend) return;
    mutate(text);
  }, [canSend, mutate, text]);

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="发送给当前 Agent 的消息"
          placeholder="继续询问 Agent…"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={draft}
          onChangeText={setDraft}
          editable={!sending.isPending}
          multiline
          numberOfLines={1}
          submitBehavior="newline"
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sending.isPending ? "正在发送消息" : "发送消息"}
          accessibilityState={accessibilityState}
          disabled={!canSend}
          onPress={sendMessage}
          style={buttonStyle}
        >
          {sending.isPending ? (
            <ActivityIndicator size="small" color={theme.colors.accentForeground} />
          ) : (
            <Icon name="ArrowUp" size={20} color={theme.colors.accentForeground} />
          )}
        </Pressable>
      </View>
      {sending.isError ? (
        <Text selectable accessibilityRole="alert" style={styles.error}>
          发送失败：{sending.error.message}。内容已保留，请重试。
        </Text>
      ) : null}
      {!online ? <Text style={styles.hint}>主机未连接，恢复连接后可发送。</Text> : null}
    </View>
  );
}
