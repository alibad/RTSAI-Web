/** The local gateway owns authorization. Public snapshots never get this capability. */
export async function ownerRequest<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const session = await fetch('/api/studio/session', { headers: { 'X-RTSAI-Local': '1' }, signal: options.signal });
  if (!session.ok) throw new Error('Gameplay editing is available in your local Studio.');
  const { capability } = await session.json();
  const response = await fetch(path, { method: options.method ?? 'GET', signal: options.signal,
    headers: { 'Content-Type': 'application/json', 'X-RTSAI-Owner': capability },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The local operation failed.');
  return data as T;
}
