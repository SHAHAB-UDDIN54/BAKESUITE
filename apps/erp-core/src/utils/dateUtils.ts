/**
 * BakeSuite Centralized Business Date & Timezone Utilities
 * Enforces strict Asia/Karachi (PKT, UTC+5) timezone consistency across all ERP and ML operations.
 */

const KARACHI_TZ = 'Asia/Karachi';

/**
 * Returns current business date formatted as YYYY-MM-DD in Asia/Karachi timezone.
 */
export function getKarachiBusinessDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KARACHI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Adds or subtracts days to a YYYY-MM-DD date string without UTC shifting issues.
 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

/**
 * Computes difference in calendar days between two YYYY-MM-DD dates.
 */
export function diffDays(startDateStr: string, endDateStr: string): number {
  const [y1, m1, d1] = startDateStr.split('-').map(Number);
  const [y2, m2, d2] = endDateStr.split('-').map(Number);
  const dt1 = Date.UTC(y1, m1 - 1, d1);
  const dt2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24));
}

/**
 * Standard 35-day forward forecast horizon.
 * Day 1 is tomorrow (business_date + 1 day), Day 35 is business_date + 35 days (startDate + 34 days).
 */
export function getDefault35DayHorizon(baseDateStr?: string): { startDate: string; endDate: string } {
  const today = baseDateStr || getKarachiBusinessDate();
  const startDate = addDays(today, 1);
  const endDate = addDays(startDate, 34); // exactly 35 dates inclusive
  return { startDate, endDate };
}
