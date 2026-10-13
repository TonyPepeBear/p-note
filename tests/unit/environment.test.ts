import { expect, it, vi } from 'vitest';

it('ENV-01：可控時鐘不必等待真實日期', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    expect(new Date().toISOString()).toBe('2026-11-12T00:00:00.000Z');
  } finally {
    vi.useRealTimers();
  }
});
