// RFC 4180 quoting, with spreadsheet formula protection for user text.
export function csvText(value: string) {
  const dangerous = /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]|^[\u0000-\u001f\u007f]/u.test(value);
  return '"' + (dangerous ? "'" + value : value).replace(/"/g, '""') + '"';
}
