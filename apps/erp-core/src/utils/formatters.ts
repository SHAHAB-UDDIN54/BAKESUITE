/**
 * Regional formatting utilities for BakeSuite ERP.
 * Strictly implements Pakistani business conventions:
 * - Currency: 'Rs 1,250,000.00'
 * - Date: 'DD-MM-YYYY'
 * - Timezone: Asia/Karachi (UTC+05:00)
 */

export function formatPKR(amount: number): string {
  const parts = amount.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Rs ${intPart}.${parts[1]}`;
}

export function formatDatePK(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  // Format in Asia/Karachi timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // en-GB naturally produces DD/MM/YYYY, convert to DD-MM-YYYY
  return formatter.format(d).replace(/\//g, '-');
}
