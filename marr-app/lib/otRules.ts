// OT time arithmetic shared by the welfare calculation (rule 3) and the OT & holiday-work form.
// Pure functions; times are minutes from midnight.

export type Interval = [number, number]; // start < end

const OT_ROUND_UP_MINUTES = 20; // per-day OT remainder: < 20 min dropped, >= 20 min rounds up to the next hour

export interface CheckTimes {
  time_in: string | null; // "HH:MM:SS"
  time_out: string | null;
}

/** "08:30:00" -> 510 */
export function toMinutes(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

/** 510 -> "08:30" */
export function minutesToHHMM(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * A day's worked intervals from its check-log rows. A row with both times is one interval; rows
 * holding only a check-in or only a check-out (TimeMint records them separately) are paired in
 * time order, each check-in with the next check-out. Unpaired times are ignored.
 */
export function workedIntervals(rows: CheckTimes[]): Interval[] {
  const intervals: Interval[] = [];
  const events: { t: number; kind: "in" | "out" }[] = [];
  for (const r of rows) {
    if (r.time_in && r.time_out) intervals.push([toMinutes(r.time_in), toMinutes(r.time_out)]);
    else if (r.time_in) events.push({ t: toMinutes(r.time_in), kind: "in" });
    else if (r.time_out) events.push({ t: toMinutes(r.time_out), kind: "out" });
  }
  events.sort((a, b) => a.t - b.t);
  let openIn: number | null = null;
  for (const ev of events) {
    if (ev.kind === "in") openIn ??= ev.t;
    else if (openIn !== null) {
      intervals.push([openIn, ev.t]);
      openIn = null;
    }
  }
  return mergeIntervals(intervals);
}

/** OT request window; a request ending past midnight counts up to the end of the day. */
export function otWindow(timeStart: string, timeEnd: string): Interval {
  const start = toMinutes(timeStart.length === 5 ? `${timeStart}:00` : timeStart);
  let end = toMinutes(timeEnd.length === 5 ? `${timeEnd}:00` : timeEnd);
  if (end <= start) end = 24 * 60;
  return [start, end];
}

/** The parts of `a` inside `b`. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const parts: Interval[] = [];
  for (const [as, ae] of a) for (const [bs, be] of b) {
    const s = Math.max(as, bs);
    const e = Math.min(ae, be);
    if (e > s) parts.push([s, e]);
  }
  return mergeIntervals(parts);
}

export function overlapMinutes(a: Interval[], b: Interval[]): number {
  return intersect(a, b).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Whole OT hours for one day: remainder < 20 min is dropped, >= 20 min rounds up. */
export function roundOtHours(minutes: number): number {
  const whole = Math.floor(minutes / 60);
  return minutes - whole * 60 >= OT_ROUND_UP_MINUTES ? whole + 1 : whole;
}
