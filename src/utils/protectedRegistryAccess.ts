export function registerProtectedRegistryAccessClick(history: number[], now: number) {
  const next = [...history.filter((time) => Number.isFinite(time) && now - time <= 3000 && time <= now), now];
  return { triggered: next.length >= 5, history: next.length >= 5 ? [] : next };
}
