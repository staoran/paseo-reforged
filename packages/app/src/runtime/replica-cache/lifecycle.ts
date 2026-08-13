import type { AppStateStatus } from "react-native";

interface NativeAppStateSource {
  addEventListener: (
    event: "change",
    listener: (state: AppStateStatus) => void,
  ) => { remove: () => void };
}

interface VisibilitySource {
  visibilityState: string;
  addEventListener: (event: "visibilitychange", listener: () => void) => void;
  removeEventListener: (event: "visibilitychange", listener: () => void) => void;
}

interface PageHideSource {
  addEventListener: (event: "pagehide", listener: () => void) => void;
  removeEventListener: (event: "pagehide", listener: () => void) => void;
}

type ReplicaCacheLifecycleInput =
  | {
      platform: "native";
      appState: NativeAppStateSource;
      flush: () => void;
    }
  | {
      platform: "web";
      document: VisibilitySource;
      window: PageHideSource;
      flush: () => void;
    };

/** Registers the platform lifecycle events that request a best-effort cache flush */
export function registerReplicaCacheLifecycle(input: ReplicaCacheLifecycleInput): () => void {
  if (input.platform === "native") {
    const subscription = input.appState.addEventListener("change", (nextState) => {
      if (nextState === "inactive" || nextState === "background") input.flush();
    });
    return () => subscription.remove();
  }

  const handleVisibilityChange = () => {
    if (input.document.visibilityState === "hidden") input.flush();
  };
  input.document.addEventListener("visibilitychange", handleVisibilityChange);
  input.window.addEventListener("pagehide", input.flush);
  return () => {
    input.document.removeEventListener("visibilitychange", handleVisibilityChange);
    input.window.removeEventListener("pagehide", input.flush);
  };
}
