import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDashboardPolling } from "../src/lib/dashboardPolling";

describe("dashboard polling", () => {
  let page: EventTarget & { hidden: boolean };
  let windowEvents: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { hidden: false });
    windowEvents = Object.assign(new EventTarget(), { setInterval, clearInterval });
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", windowEvents);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads immediately, skips background ticks, and refreshes immediately on return", async () => {
    const refresh = vi.fn(async () => {});
    const stop = startDashboardPolling(refresh, 30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();

    windowEvents.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("skips overlapping requests and restores focus updates for a visible window", async () => {
    let complete = () => {};
    const refresh = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const stop = startDashboardPolling(refresh, 5_000);
    windowEvents.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    complete();
    await Promise.resolve();
    windowEvents.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    complete();
  });
});
