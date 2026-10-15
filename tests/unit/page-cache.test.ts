import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cachedPage, cachedVersions, rememberPage } from '../../src/client/page-cache';
import type { PageInfo } from '../../src/shared/pages';
const rows = new Map<string, string>();
const page: PageInfo = { id: 'note', owner_id: 'owner', title: '本機頁面', icon: null, kind: 'note', parent_id: null, journal_date: null, sync_generation: 'g1', metadata_revision: 0, created_at: 0, updated_at: 0, deleted_at: null, room: 'room', ancestors: [] };
beforeEach(() => { rows.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value), get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null }); });
afterEach(() => vi.unstubAllGlobals());
it('CACHE-PAGE-01：擁有者隔離且未下載／損毀索引不能冒充可離線頁面', () => {
  rememberPage(page); expect(cachedPage(page.id)).toEqual(page);
  expect(() => cachedPage('unknown')).toThrow('尚未下載'); rows.set('p-note:owner', 'other');
  expect(() => cachedPage(page.id)).toThrow('尚未下載'); rows.set('p-note:owner','owner');
  for (const value of ['{', JSON.stringify({ ...page, title: 123 }), JSON.stringify({ ...page, ancestors: null }), JSON.stringify({ ...page, ancestors: [null] }), JSON.stringify({ ...page, journal_date: 123 }), JSON.stringify({ ...page, owner_id: 'other' })]) {
    rows.set('p-note:page:owner:note', value); expect(() => cachedPage(page.id)).toThrow('尚未下載');
  }
  rows.set('p-note:page:owner:note', JSON.stringify(page)); rows.delete('p-note:scope:owner:note:g1');
  const current = { ...page, sync_generation: 'g2' }; rememberPage(current);
  expect(cachedPage(page.id)).toEqual(current); expect(cachedVersions(current)).toEqual([page]);
  rows.set('p-note:scope:owner:note:foreign', JSON.stringify({ ...page, owner_id: 'other', sync_generation: 'foreign' }));
  rows.set('p-note:scope:owner:note:broken', '{');
  rows.set('p-note:scope:owner:note:forged', JSON.stringify({ ...page, sync_generation: 'different-key' }));
  expect(cachedVersions(current)).toEqual([page]);
});

it('CACHE-PAGE-02：離線頁面與保留草稿都保留 emoji，舊版快取預設沒有圖示', () => {
  const original = { ...page, icon: '👩🏽‍💻' };
  rememberPage(original);
  expect(cachedPage(page.id).icon).toBe('👩🏽‍💻');
  const current = { ...original, sync_generation: 'g2', icon: '🇹🇼' };
  rememberPage(current);
  expect(cachedPage(page.id).icon).toBe('🇹🇼');
  expect(cachedVersions(current)[0].icon).toBe('👩🏽‍💻');

  const { icon: _icon, ...legacy } = page;
  rows.set('p-note:page:owner:note', JSON.stringify(legacy));
  expect(cachedPage(page.id).icon).toBeNull();
});

it('CACHE-PAGE-03：損毀的圖示不能冒充已下載頁面', () => {
  rememberPage(page);
  for (const icon of ['', '一般文字', '🌟🌟', '<img>', 42, {}, true]) {
    rows.set('p-note:page:owner:note', JSON.stringify({ ...page, icon }));
    expect(() => cachedPage(page.id)).toThrow('尚未下載');
  }
  rows.set('p-note:page:owner:note', JSON.stringify({ ...page, ancestors: [{ ...page, id: 'parent', icon: '損毀圖示' }] }));
  expect(() => cachedPage(page.id)).toThrow('尚未下載');
});

it('CACHE-PAGE-04：較舊 metadata 回應不能蓋回圖示，移除與新版本仍可保存', () => {
  const newer = { ...page, icon: '🚀', metadata_revision: 2 };
  rememberPage(newer);
  rememberPage({ ...page, icon: '🌟', metadata_revision: 1 });
  expect(cachedPage(page.id)).toEqual(newer);

  const removed = { ...newer, icon: null, metadata_revision: 3 };
  rememberPage(removed);
  expect(cachedPage(page.id).icon).toBeNull();

  const restored = { ...page, icon: '🌱', sync_generation: 'g2', metadata_revision: 0 };
  rememberPage(restored);
  expect(cachedPage(page.id)).toEqual(restored);
  expect(cachedVersions(restored)).toEqual([removed]);
});
