import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { ChatSelectionAction } from "./actions";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
  onSelectionAction?: (text: string, action: ChatSelectionAction) => void;
}

export function AssistantSelectionCopySurface({
  children,
  style,
}: AssistantSelectionCopySurfaceProps) {
  return <View style={style}>{children}</View>;
}
