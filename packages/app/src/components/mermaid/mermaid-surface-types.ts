import type { StyleProp, ViewStyle } from "react-native";
import type { MermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";

export type MermaidRenderStatus = "error" | "loading" | "ready";

export interface MermaidSurfaceProps {
  source: string;
  theme: MermaidRenderTheme;
  onStatusChange: (status: MermaidRenderStatus) => void;
  style?: StyleProp<ViewStyle>;
}
