export function needsRestart({ healthy, everHealthy, elapsed, failures, startupGrace = 300_000 }) {
  return !healthy && (everHealthy ? failures >= 3 : elapsed >= startupGrace);
}
