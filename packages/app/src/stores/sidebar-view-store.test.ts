import { beforeEach, describe, expect, it } from "vitest";
import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { useSidebarOrderStore } from "./sidebar-order-store";
import {
  createSidebarViewStorage,
  hasActiveSidebarLabelFilter,
  migrateSidebarViewState,
  SIDEBAR_UNLABELLED_LABEL_KEY,
  useSidebarViewStore,
} from "./sidebar-view-store";

interface MemoryStorage extends StateStorage<Promise<void>> {
  reads: string[];
}

function createMemoryStorage(entries: Record<string, string | null>): MemoryStorage {
  const reads: string[] = [];
  return {
    reads,
    getItem: async (name) => {
      reads.push(name);
      return entries[name] ?? null;
    },
    setItem: async (name, value) => {
      entries[name] = value;
    },
    removeItem: async (name) => {
      entries[name] = null;
    },
  };
}

describe("sidebar view store", () => {
  beforeEach(() => {
    useSidebarViewStore.setState({
      workspaceSort: "created",
      workspaceSortInitialized: true,
      showBackground: false,
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("toggles multiple hosts into and out of the filter", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);

    store.toggleHostFilter("host-a");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);

    store.clearHostFilters();

    expect(useSidebarViewStore.getState().hostFilters).toEqual([]);
  });

  it("keeps host filters that still point at available hosts", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    store.reconcileHostFilters(["host-a", "host-b", "host-c"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);
  });

  it("drops a host filter after that host is removed", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("removed-host");

    store.reconcileHostFilters(["host-a"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a"]);
  });

  it("migrates legacy per-host group modes to the new global mode", () => {
    expect(
      migrateSidebarViewState({
        groupModeByServerId: {
          "host-a": "project",
          "host-b": "status",
        },
      }),
    ).toEqual({
      workspaceSort: "created",
      workspaceSortInitialized: false,
      showBackground: false,
      groupMode: "status",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("migrates a pre-v2 single host filter to the multi-host list", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        hostFilter: "host-a",
      }),
    ).toEqual({
      workspaceSort: "created",
      workspaceSortInitialized: false,
      showBackground: false,
      groupMode: "status",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("keeps current persisted sidebar view state during version migration", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        hostFilters: ["host-a", "host-b"],
      }),
    ).toEqual({
      workspaceSort: "created",
      workspaceSortInitialized: false,
      showBackground: false,
      groupMode: "status",
      hostFilters: ["host-a", "host-b"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("clears only the label facet", () => {
    useSidebarViewStore.setState({
      groupMode: "status",
      hostFilters: ["host-a"],
      labelFilter: { labels: ["urgent", "blocked"] },
    });

    useSidebarViewStore.getState().clearLabelFilter();

    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      hostFilters: ["host-a"],
      labelFilter: { labels: [] },
    });
  });

  it("toggles a label on and off under one normalized identity", () => {
    const { toggleLabelFilter } = useSidebarViewStore.getState();
    const labels = () => useSidebarViewStore.getState().labelFilter.labels;

    toggleLabelFilter("Urgent");
    expect(labels()).toEqual(["urgent"]);
    expect(hasActiveSidebarLabelFilter(useSidebarViewStore.getState().labelFilter)).toBe(true);

    toggleLabelFilter(" URGENT ");
    expect(labels()).toEqual([]);
    expect(hasActiveSidebarLabelFilter(useSidebarViewStore.getState().labelFilter)).toBe(false);
  });

  it("filters Unlabelled alongside real labels without colliding with one", () => {
    const { toggleLabelFilter } = useSidebarViewStore.getState();

    toggleLabelFilter(SIDEBAR_UNLABELLED_LABEL_KEY);
    toggleLabelFilter("Urgent");
    expect(useSidebarViewStore.getState().labelFilter).toEqual({
      labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent"],
    });
  });

  it("drops deleted labels from the active filter but retains Unlabelled", () => {
    useSidebarViewStore.setState({
      labelFilter: { labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent", "removed"] },
    });

    useSidebarViewStore.getState().reconcileLabelFilter(["Urgent"]);

    expect(useSidebarViewStore.getState().labelFilter).toEqual({
      labels: [SIDEBAR_UNLABELLED_LABEL_KEY, "urgent"],
    });
  });

  it("re-keys a persisted label filter through the normalized identity, without duplicates", () => {
    expect(
      migrateSidebarViewState({
        labelFilter: { labels: [" Urgent ", "BLOCKED", "urgent"], match: "all" },
      }).labelFilter,
    ).toEqual({ labels: ["urgent", "blocked"] });
  });

  it("toggles multiple projects into and out of the filter", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("project-a");
    store.toggleProjectFilter("project-b");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-a", "project-b"]);

    store.toggleProjectFilter("project-a");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["project-b"]);

    store.clearProjectFilters();

    expect(useSidebarViewStore.getState().projectFilters).toEqual([]);
  });

  it("keeps the other facets when the project filter is cleared", () => {
    useSidebarViewStore.setState({
      groupMode: "status",
      hostFilters: ["host-a"],
      projectFilters: ["project-a"],
      labelFilter: { labels: ["urgent"] },
    });

    useSidebarViewStore.getState().clearProjectFilters();

    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilter: { labels: ["urgent"] },
    });
  });

  // The persisted schema is a `z.strictObject` behind `createValidatedPersistStorage`, so a key
  // the schema does not list fails the parse and takes every other sidebar setting down with it.
  it("carries a persisted project filter through the version migration", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "project",
        hostFilters: ["host-a"],
        projectFilters: ["project-a", "project-b"],
      }),
    ).toEqual({
      workspaceSort: "created",
      workspaceSortInitialized: false,
      showBackground: false,
      groupMode: "project",
      hostFilters: ["host-a"],
      projectFilters: ["project-a", "project-b"],
      labelFilter: { labels: [] },
    });
  });

  it("never keeps project filters from state the schema rejects", () => {
    expect(migrateSidebarViewState({ projectFilters: "project-a" })).toEqual({
      workspaceSort: "created",
      workspaceSortInitialized: false,
      showBackground: false,
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("falls back to the legacy storage key when the new key is empty", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": null,
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view", "sidebar-group-mode"]);
  });

  it("uses the new storage key without reading the legacy key when current state exists", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-b": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view"]);
  });
});

it("defaults to Created and persists the Last prompt choice across migration", () => {
  expect(migrateSidebarViewState({}).workspaceSort).toBe("created");
  expect(
    migrateSidebarViewState({ workspaceSort: "lastPrompt", groupMode: "status" }),
  ).toMatchObject({ workspaceSort: "lastPrompt", groupMode: "status" });
});

it("retains the manual sorting preference on reload", () => {
  expect(migrateSidebarViewState({ workspaceSort: "manual" }).workspaceSort).toBe("manual");
});

describe("Workspace sort initialization", () => {
  it.each(["view-first", "order-first"] as const)(
    "preserves legacy Manual order after both stores hydrate %s",
    async (hydrationOrder) => {
      /** Controlled reads reproduce either asynchronous hydration order */
      const viewRead = Promise.withResolvers<string | null>();
      const orderRead = Promise.withResolvers<string | null>();
      const originalViewStorage = useSidebarViewStore.persist.getOptions().storage;
      const originalOrderStorage = useSidebarOrderStore.persist.getOptions().storage;
      useSidebarViewStore.setState({ workspaceSort: "created", workspaceSortInitialized: false });
      useSidebarViewStore.persist.setOptions({
        storage: createJSONStorage(() => ({
          getItem: () => viewRead.promise,
          setItem: () => {},
          removeItem: () => {},
        })),
      });
      useSidebarOrderStore.persist.setOptions({
        storage: createJSONStorage(() => ({
          getItem: () => orderRead.promise,
          setItem: () => {},
          removeItem: () => {},
        })),
      });
      try {
        /** Neither store may decide the migration before the other has finished reading */
        const viewHydration = useSidebarViewStore.persist.rehydrate();
        const orderHydration = useSidebarOrderStore.persist.rehydrate();
        const viewValue = JSON.stringify({ state: { groupMode: "project" }, version: 8 });
        const orderValue = JSON.stringify({
          state: { workspaceOrderByProject: { project: ["host:second", "host:first"] } },
          version: 3,
        });
        if (hydrationOrder === "view-first") {
          viewRead.resolve(viewValue);
          await viewHydration;
          expect(useSidebarViewStore.getState().workspaceSortInitialized).toBe(false);
          orderRead.resolve(orderValue);
        } else {
          orderRead.resolve(orderValue);
          await orderHydration;
          expect(useSidebarViewStore.getState().workspaceSortInitialized).toBe(false);
          viewRead.resolve(viewValue);
        }
        await Promise.all([viewHydration, orderHydration]);
        expect(useSidebarViewStore.getState().workspaceSort).toBe("manual");
        expect(useSidebarViewStore.getState().workspaceSortInitialized).toBe(true);
        expect(useSidebarOrderStore.getState().workspaceOrderByProject.project).toEqual([
          "host:second",
          "host:first",
        ]);
        useSidebarViewStore.getState().setWorkspaceSort("lastPrompt");
        await useSidebarOrderStore.persist.rehydrate();
        expect(useSidebarViewStore.getState().workspaceSort).toBe("lastPrompt");
      } finally {
        useSidebarViewStore.persist.setOptions({ storage: originalViewStorage });
        useSidebarOrderStore.persist.setOptions({ storage: originalOrderStorage });
      }
    },
  );
});
