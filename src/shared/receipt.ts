export function isCurrentReceipt(id: string | undefined, value: unknown): boolean {
  return id !== undefined && value !== null && typeof value === 'object'
    && 'type' in value && value.type === 'persisted'
    && 'id' in value && value.id === id
    && 'checkpoint' in value && typeof value.checkpoint === 'number'
    && Number.isSafeInteger(value.checkpoint) && value.checkpoint > 0;
}
