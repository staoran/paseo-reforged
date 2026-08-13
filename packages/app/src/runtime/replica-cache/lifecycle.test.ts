import { describe, expect, it, vi } from "vitest";
import type { AppStateStatus } from "react-native";
import { registerReplicaCacheLifecycle } from "./lifecycle";

describe("registerReplicaCacheLifecycle", () => {
  it("flushes on native inactive/background transitions and removes the listener", () => {
    const remove = vi.fn();
    const flush = vi.fn();
    const appState = {
      listener: ((_state: AppStateStatus) => undefined) as (state: AppStateStatus) => void,
      addEventListener(_event: "change", listener: (state: AppStateStatus) => void) {
        this.listener = listener;
        return { remove };
      },
      emit(state: AppStateStatus) {
        this.listener(state);
      },
    };
    const unsubscribe = registerReplicaCacheLifecycle({
      platform: "native",
      appState,
      flush,
    });

    appState.emit("active");
    appState.emit("inactive");
    appState.emit("background");
    expect(flush).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("flushes only when web is hidden or pagehide fires and removes both listeners", () => {
    const flush = vi.fn();
    const documentSource = {
      visibilityState: "visible",
      listener: (() => undefined) as () => void,
      addEventListener(_event: "visibilitychange", listener: () => void) {
        this.listener = listener;
      },
      removeEventListener: vi.fn(),
      emit() {
        this.listener();
      },
    };
    const windowSource = {
      listener: (() => undefined) as () => void,
      addEventListener(_event: "pagehide", listener: () => void) {
        this.listener = listener;
      },
      removeEventListener: vi.fn(),
      emit() {
        this.listener();
      },
    };
    const unsubscribe = registerReplicaCacheLifecycle({
      platform: "web",
      document: documentSource,
      window: windowSource,
      flush,
    });
    const visibilityListener = documentSource.listener;

    documentSource.emit();
    expect(flush).not.toHaveBeenCalled();
    documentSource.visibilityState = "hidden";
    documentSource.emit();
    windowSource.emit();
    expect(flush).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(documentSource.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      visibilityListener,
    );
    expect(windowSource.removeEventListener).toHaveBeenCalledWith("pagehide", flush);
  });
});
