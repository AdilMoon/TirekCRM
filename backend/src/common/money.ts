/** Money enters and leaves the API as decimal strings. No binary floating-point arithmetic. */
export function cents(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value)) throw new Error('Invalid monetary value');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function totalForItems(items: { quantity: number; unitPrice: string }[]): string {
  return money(items.reduce((sum, item) => sum + cents(item.unitPrice) * BigInt(item.quantity), 0n));
}
