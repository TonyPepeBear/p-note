import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconFilter, IconPlus } from "@tabler/icons-react";
import { BUILTIN, OPERATOR_NAMES, operators, type DatabaseConfig, type DatabaseView } from "../../shared/databases";
import { PropertyIcon } from "./fields";
import { move, type ConfigSession, type SaveConfig } from "./utils";

export type ViewSession = ConfigSession & { view: DatabaseView; section: string };
type Props = {
  session?: ViewSession;
  disabled: boolean;
  onClose: () => void;
  onSave: SaveConfig;
  onSelected: (id: string) => void;
};
export function ViewSettings({ session, disabled: parentDisabled, onClose, onSave, onSelected }: Props) {
  const [editingView, setEditingView] = useState<DatabaseView>();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEditingView(session && structuredClone(session.view));
    setFailure("");
  }, [session]);
  const config: DatabaseConfig = session?.config ?? { properties: [], views: [] };
  const fields = [...BUILTIN, ...config.properties];
  const disabled = parentDisabled || busy;
  const updateView = (value: Partial<DatabaseView>) =>
    setEditingView((view) => view && { ...view, ...value });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    try { await action(); }
    catch (error) { setFailure((error as Error).message); }
    finally { setBusy(false); }
  };
  const saveConfig = async (next: DatabaseConfig) => {
    if (session) await onSave(next, session.previous, session.generation);
  };
  return (
      <Modal
        opened={!!session}
        onClose={() => onClose()}
        title="檢視設定"
        size="lg"
        transitionProps={{ onEntered: () => {
          if (session?.section) document.getElementById(session?.section)?.scrollIntoView({ block: "start" });
        } }}
        classNames={{ content: "database-dialog", header: "database-dialog-header", body: "database-dialog-body" }}
      >
        {session && editingView && (
          <Stack gap="lg">
            {failure && <Alert color="red" role="alert">{failure}</Alert>}
            <section className="database-settings-section">
              <div className="database-view-details">
            <TextInput
              label="檢視名稱"
              value={editingView.name}
              onChange={(e) => updateView({ name: e.target.value })}
              maxLength={100}
            />
            <NativeSelect
              label="檢視形式"
              value={editingView.layout}
              data={[
                { value: "table", label: "表格" },
                { value: "list", label: "清單" },
              ]}
              onChange={(e) =>
                updateView({ layout: e.target.value as "table" | "list" })
              }
            />
              </div>
            </section>
            <section className="database-settings-section">
            <Text className="database-section-title" fw={500}>顯示欄位與順序</Text>
            {editingView.columns.map((id, i) => (
              <Group className="database-visible-field" key={id} gap="xs">
                <PropertyIcon type={fields.find((p) => p.id === id)?.type ?? "text"} size={14} />
                <Text className="database-visible-field-name" size="sm">{fields.find((p) => p.id === id)?.name}</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  className="database-icon-button"
                  disabled={i === 0}
                  aria-label={"上移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, -1) })
                  }
                >
                  <IconArrowUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  className="database-icon-button"
                  disabled={i === editingView.columns.length - 1}
                  aria-label={"下移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, 1) })
                  }
                >
                  <IconArrowDown size={14} aria-hidden="true" />
                </Button>
                {id !== "title" && (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      updateView({
                        columns: editingView.columns.filter((x) => x !== id),
                      })
                    }
                  >
                    隱藏 {fields.find((p) => p.id === id)?.name}
                  </Button>
                )}
              </Group>
            ))}
            {fields
              .filter((p) => !editingView.columns.includes(p.id))
              .map((p) => (
                <Button
                  variant="subtle"
                  key={p.id}
                  onClick={() =>
                    updateView({ columns: [...editingView.columns, p.id] })
                  }
                >
                  顯示 {p.name}
                </Button>
              ))}
            </section>
            <section className="database-settings-section" id="database-filter-settings">
            <Text className="database-section-title" fw={500}><IconFilter size={15} aria-hidden="true" /> 篩選</Text>
            <NativeSelect
              className="database-filter-mode"
              label="篩選組合"
              value={editingView.filterMode}
              data={[
                { value: "and", label: "符合全部條件" },
                { value: "or", label: "符合任一條件" },
              ]}
              onChange={(e) =>
                updateView({ filterMode: e.target.value as "and" | "or" })
              }
            />
            {editingView.filters.map((f, i) => (
              <div className="database-filter-row" key={i}>
                  <NativeSelect
                    label={"篩選欄位 " + (i + 1)}
                    value={f.property}
                    data={fields.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(e) =>
                      updateView({
                        filters: editingView.filters.map((x, n) =>
                          n === i
                            ? { ...x, property: e.target.value, operator: "eq" }
                            : x,
                        ),
                      })
                    }
                  />
                  <NativeSelect
                    label={"篩選條件 " + (i + 1)}
                    value={f.operator}
                    data={operators(
                      fields.find((p) => p.id === f.property)!.type,
                    ).map((value) => ({ value, label: OPERATOR_NAMES[value] }))}
                    onChange={(e) =>
                      updateView({
                        filters: editingView.filters.map((x, n) =>
                          n === i ? { ...x, operator: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  {["select", "multiSelect", "checkbox"].includes(
                    fields.find((p) => p.id === f.property)!.type,
                  ) ? (
                    <NativeSelect
                      label={"篩選值 " + (i + 1)}
                      value={f.value}
                      disabled={["empty", "notEmpty"].includes(f.operator)}
                      data={[
                        { value: "", label: "請選擇" },
                        ...(config.properties.find((p) => p.id === f.property)
                          ?.type === "checkbox"
                          ? [
                              { value: "true", label: "是" },
                              { value: "false", label: "否" },
                            ]
                          : (config.properties
                              .find((p) => p.id === f.property)
                              ?.options.map((o) => ({
                                value: o.id,
                                label: o.name,
                              })) ?? [])),
                      ]}
                      onChange={(e) =>
                        updateView({
                          filters: editingView.filters.map((x, n) =>
                            n === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  ) : (
                    <TextInput
                      label={"篩選值 " + (i + 1)}
                      value={f.value}
                      disabled={["empty", "notEmpty"].includes(f.operator)}
                      onChange={(e) =>
                        updateView({
                          filters: editingView.filters.map((x, n) =>
                            n === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  )}
                  <Button
                    variant="subtle"
                    onClick={() =>
                      updateView({
                        filters: editingView.filters.filter((_, n) => n !== i),
                      })
                    }
                  >
                    移除篩選 {i + 1}
                  </Button>
              </div>
            ))}
            {!editingView.filters.length && <Text className="database-settings-empty" size="sm" c="dimmed">顯示全部筆記。新增條件可縮小範圍。</Text>}
            <Button
              variant="subtle"
              leftSection={<IconPlus size={14} aria-hidden="true" />}
              onClick={() =>
                updateView({
                  filters: [
                    ...editingView.filters,
                    { property: "title", operator: "contains", value: "" },
                  ],
                })
              }
            >
              新增篩選
            </Button>
            </section>
            <section className="database-settings-section" id="database-sort-settings">
            <Text className="database-section-title" fw={500}><IconArrowsSort size={15} aria-hidden="true" /> 排序</Text>
            {editingView.sorts.map((s, i) => (
              <Group className="database-sort-row" key={i} align="end" gap="xs">
                <NativeSelect
                  label={"排序欄位 " + (i + 1)}
                  value={s.property}
                  data={fields.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) =>
                    updateView({
                      sorts: editingView.sorts.map((x, n) =>
                        n === i ? { ...x, property: e.target.value } : x,
                      ),
                    })
                  }
                />
                <NativeSelect
                  label={"排序方向 " + (i + 1)}
                  value={s.direction}
                  data={[
                    { value: "asc", label: "升序" },
                    { value: "desc", label: "降序" },
                  ]}
                  onChange={(e) =>
                    updateView({
                      sorts: editingView.sorts.map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              direction: e.target.value as "asc" | "desc",
                            }
                          : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="subtle"
                  onClick={() =>
                    updateView({
                      sorts: editingView.sorts.filter((_, n) => n !== i),
                    })
                  }
                >
                  移除排序 {i + 1}
                </Button>
              </Group>
            ))}
            {!editingView.sorts.length && <Text className="database-settings-empty" size="sm" c="dimmed">依預設順序顯示筆記。</Text>}
            <Button
              variant="subtle"
              leftSection={<IconPlus size={14} aria-hidden="true" />}
              onClick={() =>
                updateView({
                  sorts: [
                    ...editingView.sorts,
                    { property: "title", direction: "asc" },
                  ],
                })
              }
            >
              新增排序
            </Button>
            </section>
            <Group className="database-dialog-footer">
              <Button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const next = config.views.some(
                      (v) => v.id === editingView.id,
                    )
                      ? config.views.map((v) =>
                          v.id === editingView.id ? editingView : v,
                        )
                      : [...config.views, editingView];
                    await saveConfig({ ...config, views: next });
                    onSelected(editingView.id);
                    onClose();
                  })
                }
              >
                儲存檢視
              </Button>
              {config.views.some((v) => v.id === editingView.id) && (
                <Button
                  variant="subtle"
                  color="red"
                  disabled={disabled || config.views.length === 1}
                  onClick={() =>
                    void run(async () => {
                      await saveConfig({
                        ...config,
                        views: config.views.filter(
                          (v) => v.id !== editingView.id,
                        ),
                      });
                      onClose();
                    })
                  }
                >
                  刪除檢視
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>
  );
}
