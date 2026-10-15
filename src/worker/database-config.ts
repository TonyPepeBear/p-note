import { validConfig, type DatabaseConfig } from '../shared/databases';

const ordered = (value: unknown): unknown => Array.isArray(value)
  ? value.map(ordered)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
    : value;
export const sameConfigValue = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

// 欄位結構共用一個版本；檢視則依識別碼合併，各自保留其他裝置的變更。
export function mergeConfig(previous: DatabaseConfig, current: DatabaseConfig, requested: DatabaseConfig): DatabaseConfig | null {
  const propertiesChanged = !sameConfigValue(previous.properties, requested.properties);
  if (propertiesChanged && !sameConfigValue(previous.properties, current.properties)) return null;
  const before = new Map(previous.views.map(view => [view.id, view]));
  const desired = new Map(requested.views.map(view => [view.id, view]));
  const merged = new Map(current.views.map(view => [view.id, view]));
  const orderChanged = !sameConfigValue([...before.keys()], [...desired.keys()]);
  if (orderChanged) {
    const retained = (id: string) => before.has(id) && desired.has(id) && merged.has(id);
    if (!sameConfigValue([...before.keys()].filter(retained), [...merged.keys()].filter(retained))) return null;
  }
  for (const id of new Set([...before.keys(), ...desired.keys()])) {
    if (sameConfigValue(before.get(id), desired.get(id))) continue;
    if (!sameConfigValue(before.get(id), merged.get(id))) return null;
    const view = desired.get(id);
    if (view) merged.set(id, view);
    else merged.delete(id);
  }
  const views = orderChanged
    ? [...requested.views.filter(view => merged.has(view.id)).map(view => merged.get(view.id)!),
      ...current.views.filter(view => !before.has(view.id) && !desired.has(view.id))]
    : [...merged.values()];
  const result = { properties: propertiesChanged ? requested.properties : current.properties, views };
  return validConfig(result) ? result : null;
}
