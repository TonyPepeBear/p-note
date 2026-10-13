import { IMAGE_LIMIT, IMAGE_RULE, IMAGE_TYPES, imageType } from '../shared/image';

export async function uploadImage(file: File): Promise<string> {
  if (!navigator.onLine) throw new Error('圖片上傳需要連線，請連線後重試');
  if (!file.size || file.size > IMAGE_LIMIT || !IMAGE_TYPES.includes(file.type)) throw new Error(IMAGE_RULE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (imageType(bytes) !== file.type) throw new Error(IMAGE_RULE);
  const preview = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = preview; await image.decode();
  } catch { throw new Error('圖片內容無法解碼，請選擇完整 JPEG／PNG／WebP／GIF 原檔'); }
  finally { URL.revokeObjectURL(preview); }
  let response: Response;
  try {
    response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
  } catch { throw new Error('圖片上傳失敗，請重試'); }
  const result = await response.json() as { url?: string; message?: string };
  if (!response.ok || !result.url) throw new Error(result.message ?? '圖片上傳失敗，請重試');
  return result.url;
}
