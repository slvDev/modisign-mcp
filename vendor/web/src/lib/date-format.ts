// generated from the Modisign monorepo, do not edit
export const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function isCalendarDate(value: string) {
  const time = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time)
    && new Date(time).toISOString().slice(0, 10) === value;
}

// UTC+14 accepts a date once it has begun anywhere on Earth.
export function latestStartedDate() {
  return new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10);
}
