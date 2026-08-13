import { describe, expect, it } from "vitest";
import { createCompactMarkdownStyles, createMarkdownStyles } from "./markdown-styles";
import { darkTheme } from "./theme";

describe("createMarkdownStyles", () => {
  it("uses workspace typography for prose while keeping code on the mono axis", () => {
    const workspaceTheme = {
      ...darkTheme,
      fontFamily: {
        ...darkTheme.fontFamily,
        workspace: "Workspace Sans",
        mono: "Code Mono",
      },
      workspaceFontSize: {
        ...darkTheme.workspaceFontSize,
        sm: 17,
        base: 19,
        "3xl": 31,
      },
    };

    const styles = createMarkdownStyles(workspaceTheme);

    expect(styles.body).toMatchObject({
      fontFamily: "Workspace Sans",
      fontSize: 19,
      lineHeight: Math.round(19 * 1.4),
      letterSpacing: 0,
    });
    expect(styles.heading1).toMatchObject({
      fontFamily: "Workspace Sans",
      fontSize: 31,
    });
    expect(styles.td).toMatchObject({
      fontFamily: "Workspace Sans",
      fontSize: 17,
      lineHeight: Math.round(17 * 1.4),
      letterSpacing: 0,
    });
    expect(styles.code_inline).toMatchObject({
      fontFamily: "Code Mono",
      fontSize: darkTheme.fontSize.code,
      lineHeight: darkTheme.lineHeight.diff,
      letterSpacing: 0,
    });
  });

  it("preserves semantic typography while separating line and block spacing", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.strong).toMatchObject({ fontWeight: darkTheme.fontWeight.bold });
    expect(styles.text).not.toHaveProperty("fontFamily");
    expect(styles.text).not.toHaveProperty("fontSize");
    expect(styles.text).toMatchObject({ letterSpacing: 0 });
    expect(styles.paragraph.marginBottom).toBeGreaterThan(0);
    expect(styles.code_block).toMatchObject({ letterSpacing: 0 });
    expect(styles.fence).toMatchObject({ letterSpacing: 0 });
    expect(styles.th).toMatchObject({
      lineHeight: Math.round(darkTheme.workspaceFontSize.sm * 1.4),
      letterSpacing: 0,
    });
  });

  it("applies shrink-and-wrap constraints to long markdown text and links", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
    });

    expect(styles.paragraph).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      width: "100%",
      flexWrap: "wrap",
    });

    expect(styles.text).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.link).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });

    expect(styles.blocklink).toMatchObject({
      flexShrink: 1,
      minWidth: 0,
      overflowWrap: "anywhere",
    });
  });

  it("keeps assistant markdown text selectable on web", () => {
    const styles = createMarkdownStyles(darkTheme);

    expect(styles.body).toMatchObject({
      userSelect: "text",
    });
    expect(styles.text).toMatchObject({
      userSelect: "text",
    });
    expect(styles.heading1).toMatchObject({
      userSelect: "text",
    });
    expect(styles.link).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_inline).toMatchObject({
      userSelect: "text",
    });
    expect(styles.code_block).toMatchObject({
      userSelect: "text",
    });
    expect(styles.fence).toMatchObject({
      userSelect: "text",
    });
    expect(styles.bullet_list_icon).toMatchObject({
      userSelect: "text",
    });
    expect(styles.ordered_list_icon).toMatchObject({
      userSelect: "text",
    });
  });

  it("uses the mono typography tokens directly for inline and block code", () => {
    const styles = createMarkdownStyles(darkTheme);
    const compactStyles = createCompactMarkdownStyles(darkTheme);

    expect(styles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: darkTheme.lineHeight.diff,
    });
    expect(styles.code_block).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: darkTheme.lineHeight.diff,
    });
    expect(styles.fence).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: darkTheme.lineHeight.diff,
    });
    expect(compactStyles.code_inline).toMatchObject({
      fontFamily: darkTheme.fontFamily.mono,
      fontSize: darkTheme.fontSize.code,
      lineHeight: darkTheme.lineHeight.diff,
    });
  });
});
