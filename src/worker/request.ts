export async function bytes(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader(); if (!reader) throw new Error('缺少內容');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error('內容超限'); chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
export async function body(request: Request, limit = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('請使用 JSON');
  const value: unknown = JSON.parse(new TextDecoder().decode(await bytes(request, limit)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('無效內容');
  return value as Record<string, unknown>;
}
