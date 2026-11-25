export function startDashboardPolling(refresh: () => Promise<unknown>, intervalMs: number) {
  let active = true;
  let refreshing = false;

  async function sync() {
    if (!active || refreshing || document.hidden) return;
    refreshing = true;
    try {
      await refresh();
    } catch (error) {
      console.error("Dashboard refresh failed:", error);
    } finally {
      refreshing = false;
    }
  }

  const timer = window.setInterval(sync, intervalMs);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  void sync();

  return () => {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
  };
}
