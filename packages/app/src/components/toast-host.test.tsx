/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import { ToastViewport, useToastHost } from "./toast-host";

void testI18n;

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
  HEADER_INNER_HEIGHT: 40,
  HEADER_INNER_HEIGHT_MOBILE: 40,
  HEADER_TOP_PADDING_MOBILE: 0,
}));
vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      React.createElement("div", { "data-testid": testID }, children),
  },
  FadeIn: { duration: () => null },
  FadeOut: { duration: () => null },
}));

/** Shows a persistent error through the same toast host used by the app shell */
function PersistentErrorToast({ onManualDismiss }: { onManualDismiss: () => void }) {
  const { api, toast, dismiss } = useToastHost();
  useEffect(() => {
    api.show("Provider close failed", {
      variant: "error",
      durationMs: null,
      onDismiss: onManualDismiss,
    });
  }, [api, onManualDismiss]);
  return <ToastViewport toast={toast} onDismiss={dismiss} placement="panel" />;
}

describe("persistent error toast", () => {
  it("stays visible until its close button dismisses it", async () => {
    const onManualDismiss = vi.fn();
    render(<PersistentErrorToast onManualDismiss={onManualDismiss} />);

    expect((await screen.findByText("Provider close failed")).textContent).toBe(
      "Provider close failed",
    );
    expect(onManualDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onManualDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByText("Provider close failed")).toBeNull();
  });
});
