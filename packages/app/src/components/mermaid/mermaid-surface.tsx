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

export function MermaidSurface({ source, theme, onStatusChange, style }: MermaidSurfaceProps) {
  const hostRef = useRef<View>(null);
  const stableTheme = useStableMermaidRenderTheme(theme);

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
      host.replaceChildren();
    };
  }, [onStatusChange, source, stableTheme]);

  return <View ref={hostRef} style={style} />;
}
