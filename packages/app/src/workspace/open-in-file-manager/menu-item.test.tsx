/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isElectron: true,
  localServerId: "local-host",
  targetQueries: [] as boolean[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("lucide-react-native", () => ({ FolderOpen: () => null }));
vi.mock("react-native-unistyles", () => ({ withUnistyles: (component: unknown) => component }));
vi.mock("@/constants/platform", () => ({ getIsElectron: () => state.isElectron }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock("@/hooks/use-is-local-daemon", () => ({
  useIsLocalDaemon: (serverId: string) => serverId === state.localServerId,
}));
vi.mock("@/workspace/desktop-open-targets", () => ({
  openDesktopTarget: vi.fn(),
  useDesktopOpenTargets: ({ isLocalExecution }: { isLocalExecution: boolean }) => {
    state.targetQueries.push(isLocalExecution);
    return {
      targets: isLocalExecution
        ? [{ id: "file-manager", label: "File Manager", kind: "file-manager" }]
        : [],
    };
  },
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("button", { type: "button", "data-testid": testID }, children),
}));

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { OpenInFileManagerMenuItem } = await import("./menu-item");

describe("OpenInFileManagerMenuItem", () => {
  beforeEach(() => {
    state.isElectron = true;
    state.localServerId = "local-host";
    state.targetQueries = [];
  });

  afterEach(cleanup);

  it("shows the file manager target for the local Electron host", () => {
    const view = render(
      <OpenInFileManagerMenuItem serverId="local-host" path=" C:\\repo " testID="open" />,
    );

    expect(view.getByTestId("open")).toBeTruthy();
    expect(state.targetQueries).toEqual([true]);
  });

  it("hides remote host paths in Electron", () => {
    const view = render(
      <OpenInFileManagerMenuItem serverId="remote-host" path="/srv/repo" testID="open" />,
    );

    expect(view.queryByTestId("open")).toBeNull();
    expect(state.targetQueries).toEqual([false]);
  });

  it("hides local paths outside Electron", () => {
    state.isElectron = false;
    const view = render(
      <OpenInFileManagerMenuItem serverId="local-host" path="/repo" testID="open" />,
    );

    expect(view.queryByTestId("open")).toBeNull();
    expect(state.targetQueries).toEqual([false]);
  });
});
