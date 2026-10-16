import { describe, expect, it } from "vitest";
import {
  BUILTIN,
  initialConfig,
  initialView,
  selectRows,
  validConfig,
} from "../../src/shared/databases";
import type { PageRow } from "../../src/shared/pages";
const record = (id: string, date: string): PageRow => ({
  id,
  title: id,
  owner_id: "owner",
  kind: "note",
  icon: null,
  parent_id: "db",
  journal_date: null,
  sync_generation: "generation",
  metadata_revision: 0,
  created_at: Date.parse(date),
  updated_at: Date.parse(date),
  deleted_at: null,
});
describe("DB-15：日期與檢視設定", () => {
  it("DB-15：內建日期以台北日界套用相等、不等及前後篩選，排序仍比較原始時間", () => {
    expect(BUILTIN.find((p) => p.id === "created_at")?.type).toBe("date");
    const rows = [
      record("甲", "2026-10-14T15:59:59Z"),
      record("乙", "2026-10-14T16:00:00Z"),
      record("丙", "2026-10-15T15:59:59Z"),
      record("丁", "2026-10-15T16:00:00Z"),
    ];
    for (const field of ["created_at", "updated_at"])
      for (const [operator, expected] of [
        ["eq", ["乙", "丙"]],
        ["neq", ["甲", "丁"]],
        ["lt", ["甲"]],
        ["gt", ["丁"]],
      ] as const) {
        expect(
          selectRows(
            rows,
            {
              ...initialView("view"),
              filters: [{ property: field, operator, value: "2026-10-15" }],
            },
            "",
          ).map((row) => row.id),
        ).toEqual(expected);
      }
    expect(
      selectRows(
        rows,
        {
          ...initialView("view"),
          sorts: [{ property: "created_at", direction: "desc" }],
        },
        "",
      ).map((row) => row.id),
    ).toEqual(["丁", "丙", "乙", "甲"]);
  });
  it("DB-15：舊設定相容，拒絕非法顏色、欄寬、未知欄位及換行型別", () => {
    const config = initialConfig();
    config.properties.push({
      id: "p",
      name: "標籤",
      type: "select",
      options: [{ id: "o", name: "選項", color: "blue" }],
    });
    config.views[0].widths = { title: 240, p: 160 };
    config.views[0].wrap = true;
    expect(validConfig(config)).toBe(true);
    for (const widths of [
      { title: 79 },
      { title: 1201 },
      { title: NaN },
      { unknown: 100 },
      { title: "160" },
    ])
      expect(
        validConfig({ ...config, views: [{ ...config.views[0], widths }] }),
      ).toBe(false);
    expect(
      validConfig({ ...config, views: [{ ...config.views[0], wrap: "yes" }] }),
    ).toBe(false);
    expect(
      validConfig({
        ...config,
        properties: [
          {
            ...config.properties[0],
            options: [{ id: "o", name: "選項", color: "invalid" }],
          },
        ],
      }),
    ).toBe(false);
    const legacy = { ...initialView("v") };
    delete legacy.widths;
    delete legacy.wrap;
    expect(
      validConfig({
        properties: [
          {
            id: "p",
            name: "標籤",
            type: "select",
            options: [{ id: "o", name: "選項" }],
          },
        ],
        views: [legacy],
      }),
    ).toBe(true);
  });
});

it('DB-05：選項排序、空值及未完成篩選一致', () => {
  const properties = [{ id: 'p', name: '選項', type: 'select' as const, options: [{ id: 'z', name: '第一' }, { id: 'a', name: '第二' }] }];
  const rows = ['unset', 'empty', 'first', 'second'].map((id, i) => ({ ...record(id, '2026-01-01'), property_values: JSON.stringify(i === 0 ? {} : { p: ['', 'z', 'a'][i - 1] }) }));
  const view = { ...initialView('v'), sorts: [{ property: 'p', direction: 'asc' as const }] };
  expect(selectRows(rows, view, '', properties).map(r => r.id)).toEqual(['first', 'second', 'empty', 'unset']);
  expect(selectRows(rows, { ...view, sorts: [{ property: 'p', direction: 'desc' }] }, '', properties).map(r => r.id)).toEqual(['second', 'first', 'empty', 'unset']);
  expect(selectRows(rows, { ...view, filters: [{ property: 'p', operator: 'eq', value: '' }] }, '', properties)).toHaveLength(4);
  expect(selectRows(rows, { ...view, filters: [{ property: 'p', operator: 'eq', value: 'false' }] }, '', [{ id: 'p', name: '勾選', type: 'checkbox', options: [] }]).map(r => r.id)).toContain('unset');
});
