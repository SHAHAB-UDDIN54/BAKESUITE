/**
 * BakeSuite ERP Standard Formatting Utilities
 */

/**
 * Format currency in Pakistani Rupees (PKR) convention:
 * Rs 1,250,000.00
 */
export function formatPKR(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) {
    return 'Rs 0.00';
  }
  const formatted = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return val < 0 ? `-Rs ${formatted}` : `Rs ${formatted}`;
}

/**
 * Format integer quantities with thousands separators
 */
export function formatQuantity(val: number | null | undefined, unit: string = 'PCS'): string {
  if (val === null || val === undefined || isNaN(val)) {
    return `0 ${unit}`;
  }
  return `${Math.round(val).toLocaleString('en-US')} ${unit}`;
}

/**
 * Format date and time in Pakistan time (Asia/Karachi)
 */
export function formatDatePK(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}