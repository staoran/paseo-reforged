import type { StyleProp, ViewStyle } from "react-native";
import type { MermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";

export type MermaidRenderStatus = "error" | "loading" | "ready";
export type MermaidViewportMode = "pan" | "select";

export interface MermaidViewportCommand {
  id: number;
  type: "fit" | "reset" | "zoom-in" | "zoom-out";
}

export interface MermaidViewportConfig {
  command: MermaidViewportCommand | null;
  mode: MermaidViewportMode;
}

export interface MermaidSurfaceProps {
  source: string;
  theme: MermaidRenderTheme;
  onStatusChange: (status: MermaidRenderStatus) => void;
  style?: StyleProp<ViewStyle>;
  viewport?: MermaidViewportConfig;
}
