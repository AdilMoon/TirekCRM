import { apiResponse } from './api';

export async function downloadCsv(path: string, filename: string) {
  const response = await apiResponse(path, { redirect: 'error' });
  if (!/^text\/csv(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
    throw new Error('Не удалось скачать отчёт');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
