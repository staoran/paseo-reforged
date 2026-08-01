import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { prepareMermaidSource } from "@/components/mermaid/mermaid-source";
import { parseAndValidateMermaidSvg } from "@/components/mermaid/mermaid-svg";
import {
  createMermaidConfig,
  type MermaidRenderTheme,
} from "@/components/mermaid/mermaid-render-theme";
import type { MermaidSurfaceProps } from "@/components/mermaid/mermaid-surface-types";
import { useStableMermaidRenderTheme } from "@/components/mermaid/use-stable-mermaid-render-theme";
import {
  createMermaidPanZoom,
  type MermaidPanZoomController,
} from "@/mermaid/panzoom/mermaid-pan-zoom";

let nextDiagramId = 1;
let renderQueue = Promise.resolve();

function renderMermaid(source: string, theme: MermaidRenderTheme): Promise<SVGSVGElement> {
  const prepared = prepareMermaidSource(source);
  if (!prepared.ok) {
    return Promise.reject(new Error(`Mermaid source rejected: ${prepared.reason}`));
  }

  const diagramId = `paseo-mermaid-${nextDiagramId++}`;
  const render = async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(createMermaidConfig(theme));
    const { svg } = await mermaid.render(diagramId, prepared.source);
    const svgNode = parseAndValidateMermaidSvg(svg);
    svgNode.style.display = "block";
    svgNode.style.height = "auto";
    svgNode.style.maxWidth = "100%";
    svgNode.style.userSelect = "text";
    return svgNode;
  };

  const result = renderQueue.then(render, render);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function MermaidSurface({
  source,
  theme,
  onStatusChange,
  style,
  viewport,
}: MermaidSurfaceProps) {
  const hostRef = useRef<View>(null);
  const panZoomRef = useRef<MermaidPanZoomController | null>(null);
  const viewportRef = useRef(viewport);
  const stableTheme = useStableMermaidRenderTheme(theme);
  const viewportCommand = viewport?.command;
  const viewportMode = viewport?.mode;
  viewportRef.current = viewport;

  useEffect(() => {
    let active = true;
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host) {
      onStatusChange("error");
      return;
    }

    onStatusChange("loading");
    void renderMermaid(source, stableTheme).then(
      (svg) => {
        if (!active) return undefined;
        host.replaceChildren(svg);
        if (viewportRef.current) {
          try {
            panZoomRef.current = createMermaidPanZoom(host, svg);
          } catch {
            host.replaceChildren();
            onStatusChange("error");
            return undefined;
          }
          panZoomRef.current.setMode(viewportRef.current.mode);
          if (viewportRef.current.command) {
            panZoomRef.current.execute(viewportRef.current.command);
          }
        }
        onStatusChange("ready");
        return undefined;
      },
      () => {
        if (!active) return undefined;
        host.replaceChildren();
        onStatusChange("error");
        return undefined;
      },
    );

    return () => {
      active = false;
      panZoomRef.current?.destroy();
      panZoomRef.current = null;
      host.replaceChildren();
    };
  }, [onStatusChange, source, stableTheme]);

  useEffect(() => {
    if (viewportMode) panZoomRef.current?.setMode(viewportMode);
    if (viewportCommand) panZoomRef.current?.execute(viewportCommand);
  }, [viewportCommand, viewportMode]);

  return <View ref={hostRef} style={style} />;
}
