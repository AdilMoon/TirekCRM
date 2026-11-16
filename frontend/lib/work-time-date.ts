const almaty = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const offsetFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Almaty', timeZoneName: 'longOffset',
});

export function almatyDateTime(date: Date): string {
  const parts = Object.fromEntries(almaty.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function almatyInstant(value: string): string {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Проверьте введённые данные');
  const estimate = Date.parse(value + ':00Z');
  if (!Number.isFinite(estimate)) throw new Error('Проверьте введённые данные');
  // Check both offsets around a clock change. Ambiguous local time needs a different input.
  const offsets = new Set([-86400000, 86400000].map(delta => {
    const zone = offsetFormat.formatToParts(new Date(estimate + delta)).find(part => part.type === 'timeZoneName')?.value;
    return zone?.replace('GMT', '') || '+00:00';
  }));
  const candidates = [...offsets].map(offset => new Date(value + ':00' + offset))
    .filter(date => Number.isFinite(+date) && almatyDateTime(date) === value);
  if (candidates.length !== 1) throw new Error('Укажите однозначное время по Алматы');
  return candidates[0].toISOString();
}
