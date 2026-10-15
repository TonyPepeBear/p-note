// Unicode 的完整 emoji 序列涵蓋 ZWJ、膚色、旗幟及 keycap；單一符號允許省略 emoji 變體選擇符。
const emoji = new RegExp('^(?:\\p{RGI_Emoji}|[\\p{Emoji}--\\p{Emoji_Component}]\\uFE0F?)$', 'v');

export function isPageIcon(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 64 && emoji.test(value));
}
