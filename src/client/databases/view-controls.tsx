import { useState, type ReactNode } from "react";
import {
  Button,
  Group,
  NativeSelect,
  Popover,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconGripVertical } from "@tabler/icons-react";
import {
  BUILTIN,
  OPERATOR_NAMES,
  operators,
  type DatabaseConfig,
  type DatabaseView,
} from "../../shared/databases";

export function ViewControls({
  section,
  config,
  view,
  update,
  children,
  disabled,
  opened,
  onOpenedChange,
}: {
  section: "filter" | "sort" | "display";
  config: DatabaseConfig;
  view: DatabaseView;
  update: (patch: Partial<DatabaseView>) => void;
  children: ReactNode;
  disabled: boolean;
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
}) {
  const fields = [...BUILTIN, ...config.properties];
  const [dragged, setDragged] = useState<string>();
  const ordered = [
    ...view.columns,
    ...fields.map((p) => p.id).filter((id) => !view.columns.includes(id)),
  ];
  const reorder = (source: string, target: string) => {
    const columns = [...view.columns];
    const from = columns.indexOf(source),
      to = columns.indexOf(target);
    if (source === "title" || target === "title" || from < 0 || to < 0) return;
    columns.splice(from, 1);
    columns.splice(to, 0, source);
    update({ columns });
  };
  return (
    <Popover
      opened={opened}
      onChange={onOpenedChange}
      position="bottom-end"
      width={section === "filter" ? 580 : 350}
      withinPortal
      shadow="md"
      trapFocus
    >
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown
        className="database-controls"
        style={{ maxWidth: "calc(100vw - 24px)" }}
      >
        <Stack gap="sm">
          <Text fw={600} size="sm">
            {section === "filter"
              ? "篩選"
              : section === "sort"
                ? "排序"
                : "檢視設定"}
          </Text>
          {section === "filter" && (
            <>
              <NativeSelect
                label="篩選組合"
                value={view.filterMode}
                disabled={disabled}
                data={[
                  { value: "and", label: "符合全部條件" },
                  { value: "or", label: "符合任一條件" },
                ]}
                onChange={(e) =>
                  update({ filterMode: e.target.value as "and" | "or" })
                }
              />
              {view.filters.map((filter, index) => {
                const field = fields.find((p) => p.id === filter.property)!;
                const change = (patch: Partial<typeof filter>) =>
                  update({
                    filters: view.filters.map((item, i) =>
                      i === index ? { ...item, ...patch } : item,
                    ),
                  });
                const options =
                  config.properties.find((p) => p.id === filter.property)
                    ?.options ?? [];
                const label = "篩選值 " + (index + 1);
                return (
                  <div className="database-filter-controls" key={index}>
                    <NativeSelect
                      label={"篩選欄位 " + (index + 1)}
                      value={filter.property}
                      disabled={disabled}
                      data={fields.map((p) => ({ value: p.id, label: p.name }))}
                      onChange={(e) =>
                        change({
                          property: e.target.value,
                          operator: "eq",
                          value: "",
                        })
                      }
                    />
                    <NativeSelect
                      label={"篩選條件 " + (index + 1)}
                      value={filter.operator}
                      disabled={disabled}
                      data={operators(field.type).map((value) => ({
                        value,
                        label: OPERATOR_NAMES[value],
                      }))}
                      onChange={(e) => change({ operator: e.target.value })}
                    />
                    {["select", "multiSelect", "checkbox"].includes(
                      field.type,
                    ) ? (
                      <NativeSelect
                        label={label}
                        value={filter.value}
                        disabled={
                          disabled ||
                          ["empty", "notEmpty"].includes(filter.operator)
                        }
                        data={[
                          { value: "", label: "請選擇" },
                          ...(field.type === "checkbox"
                            ? [
                                { value: "true", label: "是" },
                                { value: "false", label: "否" },
                              ]
                            : options.map((o) => ({
                                value: o.id,
                                label: o.name,
                              }))),
                        ]}
                        onChange={(e) => change({ value: e.target.value })}
                      />
                    ) : (
                      <TextInput
                        label={label}
                        type={
                          field.type === "date"
                            ? "date"
                            : field.type === "number"
                              ? "number"
                              : "text"
                        }
                        value={filter.value}
                        disabled={
                          disabled ||
                          ["empty", "notEmpty"].includes(filter.operator)
                        }
                        onChange={(e) => change({ value: e.target.value })}
                      />
                    )}
                    <Button
                      variant="subtle"
                      disabled={disabled}
                      aria-label={"移除篩選 " + (index + 1)}
                      onClick={() =>
                        update({
                          filters: view.filters.filter((_, i) => i !== index),
                        })
                      }
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="subtle"
                disabled={disabled || view.filters.length >= 20}
                onClick={() =>
                  update({
                    filters: [
                      ...view.filters,
                      { property: "title", operator: "contains", value: "" },
                    ],
                  })
                }
              >
                新增篩選
              </Button>
            </>
          )}
          {section === "sort" && (
            <>
              {view.sorts.map((sort, index) => (
                <Group key={index} wrap="nowrap" align="end">
                  <NativeSelect
                    label={"排序欄位 " + (index + 1)}
                    value={sort.property}
                    disabled={disabled}
                    data={fields.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(e) =>
                      update({
                        sorts: view.sorts.map((item, i) =>
                          i === index
                            ? { ...item, property: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <NativeSelect
                    label={"排序方向 " + (index + 1)}
                    value={sort.direction}
                    disabled={disabled}
                    data={[
                      { value: "asc", label: "升冪" },
                      { value: "desc", label: "降冪" },
                    ]}
                    onChange={(e) =>
                      update({
                        sorts: view.sorts.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                direction: e.target.value as "asc" | "desc",
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="subtle"
                    disabled={disabled}
                    aria-label={"移除排序 " + (index + 1)}
                    onClick={() =>
                      update({
                        sorts: view.sorts.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </Button>
                </Group>
              ))}
              <Button
                variant="subtle"
                disabled={disabled || view.sorts.length >= 20}
                onClick={() =>
                  update({
                    sorts: [
                      ...view.sorts,
                      { property: "title", direction: "asc" },
                    ],
                  })
                }
              >
                新增排序
              </Button>
            </>
          )}
          {section === "display" && (
            <>
              <NativeSelect
                label="檢視形式"
                value={view.layout}
                data={[
                  { value: "table", label: "表格" },
                  { value: "list", label: "清單" },
                ]}
                disabled={disabled}
                onChange={(e) =>
                  update({ layout: e.target.value as "table" | "list" })
                }
              />
              <Switch
                label="自動換行"
                checked={view.wrap ?? false}
                disabled={disabled}
                onChange={(e) => update({ wrap: e.currentTarget.checked })}
              />
              <Text size="xs" c="dimmed">
                顯示欄位與順序 · 拖曳或聚焦把手後按 ↑ ↓
              </Text>
              {ordered.map((id) => {
                const field = fields.find((p) => p.id === id)!;
                return (
                  <Group
                    key={id}
                    data-field-id={id}
                    wrap="nowrap"
                    draggable={
                      !disabled && id !== "title" && view.columns.includes(id)
                    }
                    onDragStart={() => setDragged(id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragged) reorder(dragged, id);
                      setDragged(undefined);
                    }}
                  >
                    <button
                      type="button"
                      className="database-drag-handle"
                      style={{ touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (
                          e.pointerType === "mouse" ||
                          disabled ||
                          id === "title" ||
                          !view.columns.includes(id)
                        )
                          return;
                        e.preventDefault();
                        const handle = e.currentTarget;
                        let target: string | undefined;
                        handle.setPointerCapture(e.pointerId);
                        const move = (event: PointerEvent) => {
                          target = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>("[data-field-id]")
                            ?.dataset.fieldId;
                        };
                        const done = () => {
                          cleanup();
                          if (target) reorder(id, target);
                        };
                        const cleanup = () => {
                          handle.removeEventListener("pointermove", move);
                          handle.removeEventListener("pointerup", done);
                          handle.removeEventListener("pointercancel", cleanup);
                        };
                        handle.addEventListener("pointermove", move);
                        handle.addEventListener("pointerup", done);
                        handle.addEventListener("pointercancel", cleanup);
                      }}
                      aria-label={"移動欄位 " + field.name}
                      disabled={
                        disabled || id === "title" || !view.columns.includes(id)
                      }
                      onKeyDown={(e) => {
                        if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
                        e.preventDefault();
                        const index = view.columns.indexOf(id);
                        const target =
                          view.columns[index + (e.key === "ArrowUp" ? -1 : 1)];
                        if (target) reorder(id, target);
                      }}
                    >
                      <IconGripVertical size={16} />
                    </button>
                    <Switch
                      style={{ flex: 1 }}
                      label={field.name}
                      checked={view.columns.includes(id)}
                      disabled={disabled || id === "title"}
                      onChange={(e) =>
                        update({
                          columns: e.currentTarget.checked
                            ? [...view.columns, id]
                            : view.columns.filter((key) => key !== id),
                        })
                      }
                    />
                  </Group>
                );
              })}
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
