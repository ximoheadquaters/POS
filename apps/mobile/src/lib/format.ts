export function formatMoney(value: string, currency = 'PHP'): string {
  const [whole, fraction = '00'] = value.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency === 'PHP' ? '₱' : `${currency} `}${grouped}.${fraction.padEnd(2, '0')}`;
}

export function todayRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
