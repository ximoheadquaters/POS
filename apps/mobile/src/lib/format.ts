export function formatMoney(value: string, currency = 'PHP'): string {
  const num = Number(value);
  if (isNaN(num)) return `${currency === 'PHP' ? '₱' : `${currency} `}0.00`;
  const isNegative = num < 0;
  const fixed = Math.abs(num).toFixed(2);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'PHP' ? '₱' : `${currency} `;
  return `${isNegative ? '-' : ''}${symbol}${grouped}.${fraction}`;
}

export function formatDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function todayRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
