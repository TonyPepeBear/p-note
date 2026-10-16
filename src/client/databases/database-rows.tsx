import { useState } from "react";
import { Anchor, Button, Checkbox, Menu, Table, Text } from "@mantine/core";
import { IconDots, IconExternalLink } from "@tabler/icons-react";
import { today, type PageRow } from "../../shared/pages";
import {
  BUILTIN,
  displayValue,
  readValues,
  type DatabaseConfig,
  type DatabaseView,
  type PropertyOption,
} from "../../shared/databases";
import { FieldInput, PropertyIcon } from "./fields";
import { OptionPill } from "./option-input";
import { PageIconPicker } from "../page-icon";

type Props = {
  config: DatabaseConfig;
  view: DatabaseView;
  rows: PageRow[];
  readOnly: boolean;
  iconDisabled: boolean;
  focusedRow: string;
  selectedRows: string[];
  onSelection: (ids: string[]) => void;
  onStatus: (value: string) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onFilterColumn: (id: string) => void;
  onViewChange: (patch: Partial<DatabaseView>) => void;
  onEditProperty: (field: string) => void;
  onCreateOption: (property: string, name: string) => Promise<PropertyOption>;
  onRowAction: (
    action: "duplicate" | "delete" | "move",
    rows: PageRow[],
  ) => void;
};
export function DatabaseRows({
  config,
  view,
  rows,
  readOnly,
  iconDisabled,
  focusedRow,
  selectedRows,
  onSelection,
  onStatus,
  onOpen,
  onCreate,
  onViewChange,
  onEditProperty,
  onCreateOption,
  onRowAction,
  onFilterColumn,
}: Props) {
  const fields = [...BUILTIN, ...config.properties];
  const [resizing, setResizing] = useState<{ id: string; width: number }>();
  const columns = ["title", ...view.columns.filter((id) => id !== "title")];
  const width = (id: string) =>
    resizing?.id === id
      ? resizing.width
      : (view.widths?.[id] ?? (id === "title" ? 240 : 160));
  const select = (row: PageRow) => (
    <Checkbox
      aria-label={"選取筆記 " + row.title}
      checked={selectedRows.includes(row.id)}
      disabled={iconDisabled}
      onChange={(e) =>
        onSelection(
          e.currentTarget.checked
            ? [...selectedRows, row.id]
            : selectedRows.filter((id) => id !== row.id),
        )
      }
    />
  );
  const menu = (row: PageRow) => (
    <Menu withinPortal position="bottom-start">
      <Menu.Target>
        <button
          type="button"
          className="database-row-menu"
          aria-label={"列選單 " + row.title}
          disabled={iconDisabled}
        >
          <IconDots size={15} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onRowAction("duplicate", [row])}>
          複製筆記
        </Menu.Item>
        <Menu.Item onClick={() => onRowAction("move", [row])}>
          移動筆記
        </Menu.Item>
        <Menu.Item color="red" onClick={() => onRowAction("delete", [row])}>
          刪除筆記
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const resize = (id: string) => (
    <div
      role="separator"
      aria-label={"調整欄寬 " + fields.find((p) => p.id === id)?.name}
      aria-orientation="vertical"
      aria-valuenow={width(id)}
      aria-valuemin={80}
      aria-valuemax={1200}
      tabIndex={iconDisabled ? -1 : 0}
      className="database-resize-handle"
      onKeyDown={(e) => {
        if (iconDisabled || !["ArrowLeft", "ArrowRight"].includes(e.key))
          return;
        e.preventDefault();
        onViewChange({
          widths: {
            ...view.widths,
            [id]: Math.max(
              80,
              Math.min(1200, width(id) + (e.key === "ArrowRight" ? 20 : -20)),
            ),
          },
        });
      }}
      onPointerDown={(e) => {
        if (iconDisabled) return;
        e.preventDefault();
        e.stopPropagation();
        const handle = e.currentTarget,
          start = e.clientX,
          initial = width(id);
        let current = initial;
        handle.setPointerCapture(e.pointerId);
        setResizing({ id, width: initial });
        const move = (event: PointerEvent) => {
          current = Math.round(
            Math.max(80, Math.min(1200, initial + event.clientX - start)),
          );
          setResizing({ id, width: current });
        };
        const done = (event: PointerEvent) => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", done);
          handle.removeEventListener("pointercancel", cancel);
          if (handle.hasPointerCapture(event.pointerId))
            handle.releasePointerCapture(event.pointerId);
          setResizing(undefined);
          onViewChange({ widths: { ...view.widths, [id]: current } });
        };
        const cancel = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", done);
          handle.removeEventListener("pointercancel", cancel);
          setResizing(undefined);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", done);
        handle.addEventListener("pointercancel", cancel);
      }}
    />
  );
  return (
    <div
      className="database-scroll"
      id="database-view-panel"
      role="tabpanel"
      aria-labelledby={"database-view-" + view.id}
      data-testid="database-rows"
    >
      {view.layout === "table" ? (
        <Table
          className={"database-table" + (view.wrap ? " database-wrap" : "")}
          withColumnBorders
          style={{
            width: columns.reduce((sum, id) => sum + width(id), 0) + 72,
          }}
        >
          <colgroup>
            {columns.map((id) => (
              <col key={id} style={{ width: width(id) }} />
            ))}
            <col style={{ width: 72 }} />
          </colgroup>
          <Table.Thead>
            <Table.Tr>
              {columns.map((id) => {
                const field = fields.find((p) => p.id === id)!;
                return (
                  <Table.Th key={id} data-column={id}>
                    <Menu withinPortal position="bottom-start">
                      <Menu.Target>
                        <button
                          type="button"
                          className="database-column-heading"
                          aria-label={"欄位選單 " + field.name}
                          disabled={iconDisabled}
                        >
                          <PropertyIcon type={field.type} />
                          <span>{field.name}</span>
                        </button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          onClick={() =>
                            onViewChange({
                              sorts: [
                                { property: id, direction: "asc" },
                                ...view.sorts.filter((s) => s.property !== id),
                              ],
                            })
                          }
                        >
                          升冪
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            onViewChange({
                              sorts: [
                                { property: id, direction: "desc" },
                                ...view.sorts.filter((s) => s.property !== id),
                              ],
                            })
                          }
                        >
                          降冪
                        </Menu.Item>
                        <Menu.Item
                          disabled={view.filters.length >= 20}
                          onClick={() => onFilterColumn(id)}
                        >
                          篩選此欄
                        </Menu.Item>
                        <Menu.Item
                          disabled={id === "title"}
                          onClick={() =>
                            onViewChange({
                              columns: view.columns.filter((key) => key !== id),
                            })
                          }
                        >
                          隱藏欄位
                        </Menu.Item>
                        <Menu.Item
                          disabled={!config.properties.some((p) => p.id === id)}
                          onClick={() => onEditProperty(id)}
                        >
                          編輯欄位
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    {resize(id)}
                  </Table.Th>
                );
              })}
              <Table.Th className="database-row-tools">
                <Checkbox
                  aria-label="選取全部筆記"
                  checked={
                    rows.length > 0 &&
                    rows.every((row) => selectedRows.includes(row.id))
                  }
                  indeterminate={
                    rows.some((row) => selectedRows.includes(row.id)) &&
                    !rows.every((row) => selectedRows.includes(row.id))
                  }
                  disabled={iconDisabled || !rows.length}
                  onChange={(e) =>
                    onSelection(
                      e.currentTarget.checked
                        ? [
                            ...new Set([
                              ...selectedRows,
                              ...rows.map((r) => r.id),
                            ]),
                          ]
                        : selectedRows.filter(
                            (id) => !rows.some((row) => row.id === id),
                          ),
                    )
                  }
                />
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr
                key={row.id}
                data-testid="database-row"
                data-selected={selectedRows.includes(row.id) || undefined}
              >
                {columns.map((id) => (
                  <Table.Td key={id} data-column={id}>
                    {id === "title" ? (
                      <div className="database-title-cell">
                        <PageIconPicker
                          page={row}
                          className="database-row-icon"
                          disabled={iconDisabled}
                        />
                        <FieldInput
                          row={row}
                          property={{
                            id: "title",
                            name: "名稱",
                            type: "text",
                            options: [],
                          }}
                          status={onStatus}
                          disabled={readOnly}
                          wrap={view.wrap}
                          autoFocus={row.id === focusedRow}
                        />
                        <Anchor
                          className="database-open-row"
                          aria-label={"開啟 " + row.title}
                          title={"開啟 " + row.title}
                          href={"/?page=" + row.id}
                          onClick={(e) => {
                            e.preventDefault();
                            onOpen(row.id);
                          }}
                        >
                          <IconExternalLink size={14} />
                          <span className="database-visually-hidden">
                            開啟 {row.title}
                          </span>
                        </Anchor>
                      </div>
                    ) : id === "created_at" || id === "updated_at" ? (
                      <Text size="xs">{today(row[id])}</Text>
                    ) : (
                      <FieldInput
                        row={row}
                        property={config.properties.find((p) => p.id === id)!}
                        status={onStatus}
                        disabled={readOnly}
                        wrap={view.wrap}
                        onCreateOption={onCreateOption}
                      />
                    )}
                  </Table.Td>
                ))}
                <Table.Td className="database-row-tools">
                  <div>
                    {select(row)}
                    {menu(row)}
                  </div>
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td colSpan={columns.length + 1}>
                <Button
                  className="database-add-row"
                  variant="subtle"
                  aria-label="新增資料列"
                  disabled={iconDisabled}
                  onClick={onCreate}
                >
                  ＋ 新增
                </Button>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      ) : (
        <div className={"database-list" + (view.wrap ? " database-wrap" : "")}>
          <div className="database-list-selection">
            <Checkbox
              aria-label="選取全部筆記"
              checked={
                rows.length > 0 &&
                rows.every((row) => selectedRows.includes(row.id))
              }
              disabled={iconDisabled || !rows.length}
              onChange={(e) =>
                onSelection(
                  e.currentTarget.checked ? rows.map((r) => r.id) : [],
                )
              }
            />
          </div>
          {rows.map((row) => (
            <div
              className="database-list-row"
              key={row.id}
              data-testid="database-row"
            >
              <div className="database-list-title">
                <PageIconPicker
                  page={row}
                  className="database-row-icon"
                  disabled={iconDisabled}
                />
                <Anchor
                  className="database-list-link"
                  href={"/?page=" + row.id}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(row.id);
                  }}
                >
                  {row.title}
                </Anchor>
              </div>
              <div className="database-list-values">
                {columns
                  .filter((id) => id !== "title")
                  .map((id) => {
                    const field = fields.find((p) => p.id === id)!;
                    const property = config.properties.find((p) => p.id === id);
                    const value = readValues(row.property_values)[id] ?? null;
                    return (
                      <span
                        key={id}
                        className="database-list-value"
                        title={field.name}
                      >
                        <PropertyIcon type={field.type} />
                        <span>{field.name}：</span>
                        {id === "created_at" || id === "updated_at"
                          ? today(row[id])
                          : property &&
                              ["select", "multiSelect"].includes(property.type)
                            ? (Array.isArray(value) ? value : [value]).map(
                                (value) => {
                                  const option = property.options.find(
                                    (o) => o.id === value,
                                  );
                                  return (
                                    option && (
                                      <OptionPill
                                        key={option.id}
                                        option={option}
                                      />
                                    )
                                  );
                                },
                              )
                            : displayValue(value, property)}
                      </span>
                    );
                  })}
              </div>
              <div className="database-row-tools">
                {select(row)}
                {menu(row)}
              </div>
            </div>
          ))}
          <Button
            variant="subtle"
            aria-label="新增資料列"
            disabled={iconDisabled}
            onClick={onCreate}
          >
            ＋ 新增
          </Button>
        </div>
      )}
    </div>
  );
}
