import React, { useMemo } from "react";
import type { TextStyle } from "react-native";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MermaidDiagram } from "@/components/mermaid/mermaid-diagram";

interface MarkdownFenceBlockProps {
  code: string;
  language: string | null | undefined;
  isClosed: boolean;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

function isMermaidLanguage(info: string | null | undefined): boolean {
  return info?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

export function MarkdownFenceBlock({
  code,
  language,
  isClosed,
  inheritedStyles,
  textStyle,
}: MarkdownFenceBlockProps) {
  const fallback = useMemo(
    () => (
      <HighlightedCodeBlock
        code={code}
        language={language}
        inheritedStyles={inheritedStyles}
        textStyle={textStyle}
      />
    ),
    [code, inheritedStyles, language, textStyle],
  );

  if (!isMermaidLanguage(language) || !isClosed) {
    return fallback;
  }

  return <MermaidDiagram source={code} fallback={fallback} />;
}
