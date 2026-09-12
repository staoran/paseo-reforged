import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopDaemonTransportUrl,
  createDesktopDaemonTransportFactory,
  createDesktopWebSocketTransportFactory,
} from "./desktop-daemon-transport";
import { createFakeLocalDaemonTransportRpc } from "./test-local-daemon-transport-rpc";

const LOCAL_URL = "paseo+desktop://socket?path=%2Ftmp%2Fpaseo.sock";

describe("desktop-daemon-transport", () => {
  it("uses the main-process event as readiness when it races registration", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    const onOpen = vi.fn();
    transport.onOpen(onOpen);

    rpc.resolveListen(cleanup);
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");
    rpc.emitEvent({ sessionId, kind: "open" });
    expect(onOpen).toHaveBeenCalledTimes(1);

    rpc.resolveRegistration();
    await Promise.resolve();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not start a session when listener setup finishes after close", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();

    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    transport.close();

    rpc.resolveListen(cleanup);
    await Promise.resolve();
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(0);
    expect(rpc.closedSessions).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cancels a registered session while readiness is pending", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");

    transport.close();

    expect(rpc.closedSessions).toEqual([sessionId]);
  });

  it("passes Remote SSH parameters to the desktop transport bridge", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
    transportFactory!({ url });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(1);
    expect(rpc.openCalls[0]?.target).toEqual({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
  });

  it.each([0, 65536])("rejects an out-of-range Remote SSH port (%s)", (sshPort) => {
    const invalidPortTransportFactory = createDesktopDaemonTransportFactory(
      createFakeLocalDaemonTransportRpc(),
    );
    expect(invalidPortTransportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort,
    });

    expect(() => invalidPortTransportFactory!({ url })).toThrow("Invalid SSH transport target");
  });

  it("forwards remote WebSocket headers and protocols through the desktop bridge", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopWebSocketTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({
      url: "wss://daemon.example/ws",
      headers: { "X-Tenant": "acme", Authorization: "Bearer secret" },
      protocols: ["paseo.bearer.secret"],
    });

    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(1);
    const openCall = rpc.openCalls[0] as Record<string, unknown>;
    expect(openCall.sessionId).not.toBe("");
    expect(openCall.target).toEqual({
      transportType: "websocket",
      url: "wss://daemon.example/ws",
      headers: { "X-Tenant": "acme", Authorization: "Bearer secret" },
      protocols: ["paseo.bearer.secret"],
    });
    transport.close();
  });
});
