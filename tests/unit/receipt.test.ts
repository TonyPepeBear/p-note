import { expect, it } from 'vitest';
import { isCurrentReceipt } from '../../src/shared/receipt';

it('UNIT-ACK-01：只有目前提交的有效持久確認可以標記儲存', () => {
  const valid = { type: 'persisted', id: 'latest', checkpoint: 2 };
  expect(isCurrentReceipt('latest', valid)).toBe(true);
  for (const invalid of [null, {}, { ...valid, type: 'synced' }, { ...valid, id: 'old' }, { ...valid, checkpoint: -1 }, { ...valid, checkpoint: '2' }]) {
    expect(isCurrentReceipt('latest', invalid)).toBe(false);
  }
  expect(isCurrentReceipt(undefined, valid)).toBe(false);
});
