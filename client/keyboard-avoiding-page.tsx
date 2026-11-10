import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useCallback, useRef, useState, type PropsWithChildren } from "react";
import { KeyboardAvoidingView, View, type StyleProp, type ViewStyle } from "react-native";

type KeyboardAvoidingPageProps = PropsWithChildren<{
  platform: PluginScreenProps["layout"]["platform"];
  style: StyleProp<ViewStyle>;
}>;

const contentStyle: ViewStyle = { flex: 1 };

export function KeyboardAvoidingPage({ children, platform, style }: KeyboardAvoidingPageProps) {
  const frameRef = useRef<View>(null);
  const [keyboardVerticalOffset, setKeyboardVerticalOffset] = useState(0);
  const measureOffset = useCallback(() => {
    if (platform !== "ios") return;
    // The plugin body starts below Paseo's header, while keyboard frames use screen coordinates.
    // Measure its stationary parent so keyboard padding cannot feed back into the offset.
    frameRef.current?.measureInWindow((_x, y) => setKeyboardVerticalOffset(y));
  }, [platform]);

  return (
    <View ref={frameRef} collapsable={false} style={style} onLayout={measureOffset}>
      <KeyboardAvoidingView
        style={contentStyle}
        behavior={platform === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
