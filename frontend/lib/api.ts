export async function apiResponse(path: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } }); } catch { throw new Error('Не удалось связаться с сервером'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.code === 'VALIDATION_ERROR' ? 'Проверьте введённые данные' : response.status === 429 ? 'Слишком много запросов. Попробуйте позже.' : body.message ?? 'Не удалось связаться с сервером';
    const error = new Error(message) as Error & { status: number };
    error.status = response.status; throw error;
  }
  return response;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return (await apiResponse(path, options)).json();
}
