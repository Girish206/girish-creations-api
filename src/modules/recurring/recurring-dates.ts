// Dates are "YYYY-MM-DD" strings here, as expenses store them (UTC midnight),
// so a time zone can never move one to the day before or after.

export type Frequency = "monthly" | "weekly";

const pad = (n: number) => String(n).padStart(2, "0");

export function toDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  // month is 1-12; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The day after `day` that a recurring expense next falls on. Monthly ones
// keep their day of the month, on the last day when a month is shorter (a
// 31st is on 28/29 Feb, then back on 31 Mar).
export function nextOccurrence(day: string, frequency: Frequency, dayOfMonth?: number | null): string {
  const [year, month, date] = day.split("-").map(Number);
  if (frequency === "weekly") {
    const next = new Date(Date.UTC(year, month - 1, date + 7));
    return toDay(next);
  }
  const wanted = dayOfMonth ?? date;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(wanted, daysInMonth(nextYear, nextMonth)))}`;
}

// Today where the app's people are (India), as "YYYY-MM-DD".
export function todayInIndia(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
