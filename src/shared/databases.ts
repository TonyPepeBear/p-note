import { validDate, type PageRow } from "./pages";

export const PROPERTY_TYPES = {
  text: "文字",
  number: "數字",
  date: "日期",
  select: "單選",
  multiSelect: "多選",
  checkbox: "勾選",
  url: "網址",
} as const;
export type PropertyType = keyof typeof PROPERTY_TYPES;
export type Property = {
  id: string;
  name: string;
  type: PropertyType;
  options: { id: string; name: string }[];
};
export type PropertyValue = string | number | boolean | string[] | null;
export type Values = Record<string, PropertyValue>;
export type Filter = { property: string; operator: string; value: string };
export type DatabaseView = {
  id: string;
  name: string;
  layout: "table" | "list";
  columns: string[];
  filters: Filter[];
  filterMode: "and" | "or";
  sorts: { property: string; direction: "asc" | "desc" }[];
};
export type DatabaseConfig = { properties: Property[]; views: DatabaseView[] };
export type DatabaseData = {
  page: PageRow;
  config: DatabaseConfig;
  rows: PageRow[];
};
export const BUILTIN = [
  { id: "title", name: "名稱", type: "text" },
  { id: "created_at", name: "建立時間", type: "number" },
  { id: "updated_at", name: "更新時間", type: "number" },
] as const;
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[\w-]{1,80}$/.test(v);
const name = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= 100;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const unique = (list: string[]) => new Set(list).size === list.length;
const allowed = (v: object, keys: string[]) =>
  Object.keys(v).every((key) => keys.includes(key));
export function operators(type: string): string[] {
  return [
    "eq",
    "neq",
    "empty",
    "notEmpty",
    ...(type === "text" || type === "url" || type === "multiSelect"
      ? ["contains"]
      : []),
    ...(type === "number" || type === "date" ? ["gt", "lt"] : []),
  ];
}
export const OPERATOR_NAMES: Record<string, string> = {
  eq: "等於",
  neq: "不等於",
  contains: "包含",
  empty: "為空",
  notEmpty: "不為空",
  gt: "大於",
  lt: "小於",
};
export function validConfig(v: unknown): v is DatabaseConfig {
  if (new TextEncoder().encode(JSON.stringify(v)).length > 64 * 1024) return false;
  if (
    !object(v) ||
    !allowed(v, ["properties", "views"]) ||
    !Array.isArray(v.properties) ||
    v.properties.length > 50 ||
    !Array.isArray(v.views) ||
    !v.views.length ||
    v.views.length > 20
  )
    return false;
  const ids = new Set<string>(BUILTIN.map((p) => p.id));
  const types = new Map<string, string>(BUILTIN.map((p) => [p.id, p.type]));
  for (const p of v.properties) {
    if (
      !object(p) ||
      !allowed(p, ["id", "name", "type", "options"]) ||
      !id(p.id) ||
      ids.has(p.id) ||
      !name(p.name) ||
      typeof p.type !== "string" ||
      !Object.hasOwn(PROPERTY_TYPES, p.type) ||
      !Array.isArray(p.options) ||
      p.options.length > 100
    )
      return false;
    if (!["select", "multiSelect"].includes(p.type) && p.options.length)
      return false;
    const options = new Set<string>();
    for (const o of p.options) {
      if (
        !object(o) ||
        !allowed(o, ["id", "name"]) ||
        !id(o.id) ||
        options.has(o.id) ||
        !name(o.name)
      )
        return false;
      options.add(o.id);
    }
    ids.add(p.id);
    types.set(p.id, p.type);
  }
  if (!unique(v.properties.map((p) => p.name))) return false;
  const views = new Set<string>();
  for (const w of v.views) {
    if (
      !object(w) ||
      !allowed(w, [
        "id",
        "name",
        "layout",
        "columns",
        "filters",
        "filterMode",
        "sorts",
      ]) ||
      !id(w.id) ||
      views.has(w.id) ||
      !name(w.name) ||
      !["table", "list"].includes(String(w.layout)) ||
      !["and", "or"].includes(String(w.filterMode)) ||
      !Array.isArray(w.columns) ||
      !w.columns.includes("title") ||
      !w.columns.every((c) => typeof c === "string" && ids.has(c)) ||
      !unique(w.columns) ||
      !Array.isArray(w.filters) ||
      w.filters.length > 20 ||
      !Array.isArray(w.sorts) ||
      w.sorts.length > 20
    )
      return false;
    for (const f of w.filters)
      if (
        !object(f) ||
        !allowed(f, ["property", "operator", "value"]) ||
        typeof f.property !== "string" ||
        !ids.has(f.property) ||
        typeof f.operator !== "string" ||
        !operators(types.get(f.property)!).includes(f.operator) ||
        typeof f.value !== "string" ||
        f.value.length > 2000
      )
        return false;
    for (const s of w.sorts)
      if (
        !object(s) ||
        !allowed(s, ["property", "direction"]) ||
        typeof s.property !== "string" ||
        !ids.has(s.property) ||
        !["asc", "desc"].includes(String(s.direction))
      )
        return false;
    views.add(w.id);
  }
  return true;
}
export function validValue(
  p: Property,
  value: unknown,
): value is PropertyValue {
  if (value === null) return true;
  if (p.type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (p.type === "checkbox") return typeof value === "boolean";
  if (p.type === "multiSelect")
    return (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every(
        (x) => typeof x === "string" && p.options.some((o) => o.id === x),
      ) &&
      unique(value)
    );
  if (typeof value !== "string" || value.length > 2000) return false;
  if (p.type === "date") return value === "" || validDate(value);
  if (p.type === "select")
    return value === "" || p.options.some((o) => o.id === value);
  if (p.type === "url" && value) {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  return true;
}
export function readConfig(text: string): DatabaseConfig {
  const value: unknown = JSON.parse(text);
  if (!validConfig(value)) throw new Error("資料庫設定無效");
  return value;
}
export function readValues(text?: string): Values {
  const value: unknown = JSON.parse(text ?? "{}");
  if (
    !object(value) ||
    Object.entries(value).some(
      ([key, v]) =>
        !id(key) ||
        !(
          v === null ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (typeof v === "string" && v.length <= 2000) ||
          (Array.isArray(v) &&
            v.length <= 100 &&
            v.every((x) => typeof x === "string" && id(x)))
        ),
    )
  )
    throw new Error("筆記欄位無效");
  return value as Values;
}
export function initialView(id: string, name = "全部筆記"): DatabaseView {
  return {
    id,
    name,
    layout: "table",
    columns: ["title"],
    filters: [],
    filterMode: "and",
    sorts: [],
  };
}
export function initialConfig(): DatabaseConfig {
  return { properties: [], views: [initialView(crypto.randomUUID())] };
}
export function fieldValue(row: PageRow, field: string): PropertyValue {
  return field === "title"
    ? row.title
    : field === "created_at"
      ? row.created_at
      : field === "updated_at"
        ? row.updated_at
        : (readValues(row.property_values)[field] ?? null);
}
export function displayValue(value: PropertyValue, p?: Property): string {
  if (value === null) return "";
  if (p && ["select", "multiSelect"].includes(p.type))
    return (Array.isArray(value) ? value : [value])
      .map((v) => p.options.find((o) => o.id === v)?.name ?? "")
      .join("、");
  return Array.isArray(value)
    ? value.join("、")
    : typeof value === "boolean"
      ? value
        ? "是"
        : "否"
      : String(value);
}
export function selectRows(
  rows: PageRow[],
  view: DatabaseView,
  query: string,
): PageRow[] {
  const match = (row: PageRow, f: Filter) => {
    const v = fieldValue(row, f.property);
    const empty = v === null || v === "" || (Array.isArray(v) && !v.length);
    if (f.operator === "empty") return empty;
    if (f.operator === "notEmpty") return !empty;
    const same = Array.isArray(v)
      ? v.includes(f.value)
      : String(v ?? "") === f.value;
    if (f.operator === "eq") return same;
    if (f.operator === "neq") return !same;
    if (f.operator === "contains")
      return Array.isArray(v)
        ? v.includes(f.value)
        : String(v ?? "")
            .toLocaleLowerCase()
            .includes(f.value.toLocaleLowerCase());
    if (empty) return false;
    return f.operator === "gt"
      ? typeof v === "number"
        ? v > Number(f.value)
        : String(v) > f.value
      : typeof v === "number"
        ? v < Number(f.value)
        : String(v) < f.value;
  };
  return rows
    .filter(
      (row) =>
        row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        (!view.filters.length ||
          (view.filterMode === "or"
            ? view.filters.some((f) => match(row, f))
            : view.filters.every((f) => match(row, f)))),
    )
    .sort((a, b) => {
      for (const sort of view.sorts) {
        const x = fieldValue(a, sort.property),
          y = fieldValue(b, sort.property);
        const result =
          x === y
            ? 0
            : x === null
              ? 1
              : y === null
                ? -1
                : typeof x === "number" && typeof y === "number"
                  ? x - y
                  : String(x).localeCompare(String(y), "zh-TW");
        if (result) return sort.direction === "asc" ? result : -result;
      }
      return a.created_at - b.created_at || a.id.localeCompare(b.id);
    });
}
