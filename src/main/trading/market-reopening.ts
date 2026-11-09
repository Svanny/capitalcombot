import type { AppError } from "../../shared/types";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Only a definite broker rejection is safe to retry. Never infer a retry from
// a timeout or unknown submission outcome, and never carry it into another run.
export function marketReopeningBefore(
  error: AppError,
  epic: string,
  now: number,
  nextRun: number,
): Date | null {
  if (error.code !== "CAPITAL_400" || !error.detail) return null;
  const prefix = `Rejected. ${epic} is currently closed. Timetable in place: UTC; `;
  if (!error.detail.startsWith(prefix)) return null;
  const timetable = error.detail.slice(prefix.length).replace(/\.$/, "");
  const openings: { day: number; minute: number }[] = [];
  const seen = new Set<string>();
  for (const entry of timetable.split(";")) {
    const match = entry.trim().match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (.+)$/);
    if (!match || seen.has(match[1])) return null;
    seen.add(match[1]);
    for (const range of match[2].split(",")) {
      const interval = range.trim().match(/^(?:(\d{2}):(\d{2}))?\s*-\s*(?:(\d{2}):(\d{2}))?$/);
      if (!interval || (!interval[1] && !interval[3])) return null;
      if ([interval[1], interval[3]].some((h) => h !== undefined && Number(h) > 23)
        || [interval[2], interval[4]].some((m) => m !== undefined && Number(m) > 59)) return null;
      if (interval[1]) openings.push({ day: days.indexOf(match[1]), minute: Number(interval[1]) * 60 + Number(interval[2]) });
    }
  }
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  for (let offset = 0; offset <= 7; offset++) {
    const day = (midnight.getUTCDay() + offset) % 7;
    const candidates = openings.filter((opening) => opening.day === day)
      .map((opening) => midnight.getTime() + offset * 86_400_000 + opening.minute * 60_000 + 5_000)
      .filter((at) => at > now && at < nextRun)
      .sort((a, b) => a - b);
    if (candidates.length) return new Date(candidates[0]);
  }
  return null;
}
