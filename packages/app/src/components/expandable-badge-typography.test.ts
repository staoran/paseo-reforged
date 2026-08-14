import { describe, expect, it } from "vitest";

import { darkTheme } from "@/styles/theme";
import { createExpandableBadgeTextStyle } from "./expandable-badge-typography";

describe("expandable badge typography", () => {
  it("uses workspace font family, size, and line height", () => {
    const theme = {
      ...darkTheme,
      fontFamily: {
        ...darkTheme.fontFamily,
        workspace: "Workspace Test Font",
      },
      fontSize: {
        ...darkTheme.fontSize,
        base: 13,
      },
      workspaceFontSize: {
        ...darkTheme.workspaceFontSize,
        base: 19,
      },
    };

    expect(createExpandableBadgeTextStyle(theme)).toEqual({
      fontFamily: "Workspace Test Font",
      fontSize: 19,
      lineHeight: 27,
      fontWeight: darkTheme.fontWeight.normal,
    });
  });
});
