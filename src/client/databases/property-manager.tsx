import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  BUILTIN,
  OPTION_COLORS,
  PROPERTY_TYPES,
  type DatabaseConfig,
  type Property,
} from "../../shared/databases";
import { PropertyIcon } from "./fields";
import { move, type ConfigSession, type SaveConfig } from "./utils";

type Props = {
  session?: ConfigSession;
  disabled: boolean;
  onClose: () => void;
  onSave: SaveConfig;
};
export function PropertyManager({
  session,
  disabled: parentDisabled,
  onClose,
  onSave,
}: Props) {
  const [config, setConfig] = useState<DatabaseConfig>({
    properties: [],
    views: [],
  });
  const [properties, setProperties] = useState<Property[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<Property["type"]>("text");
  const [remove, setRemove] = useState<string>();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const previous = useRef("");
  useEffect(() => {
    if (!session) return;
    setConfig(session.config);
    setProperties(structuredClone(session.config.properties));
    previous.current = session.previous;
    setNewName("");
    setNewType("text");
    setRemove(undefined);
    setFailure("");
  }, [session]);
  const disabled = parentDisabled || busy;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    try {
      await action();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveConfig = async (next: DatabaseConfig) => {
    if (!session) return;
    const saved = await onSave(next, previous.current, session.generation);
    previous.current = JSON.stringify(saved);
    setConfig(saved);
    setProperties(structuredClone(saved.properties));
  };
  return (
    <>
      <Modal
        opened={!!session}
        onClose={onClose}
        title="管理欄位"
        size="lg"
        transitionProps={{
          onEntered: () => {
            if (session?.field)
              document
                .querySelector<HTMLInputElement>(
                  '[data-property="' + session.field + '"] input',
                )
                ?.focus();
          },
        }}
        classNames={{
          content: "database-dialog",
          header: "database-dialog-header",
          body: "database-dialog-body",
        }}
        closeButtonProps={{ "aria-label": "關閉欄位管理" }}
      >
        <Stack gap="md">
          {failure && (
            <Alert color="red" role="alert">
              {failure}
            </Alert>
          )}
          <Text size="sm" c="dimmed">
            自訂筆記的屬性與順序。已有內容的欄位如需變更類型，請新增另一個欄位。
          </Text>
          <div className="database-field-list">
            {!properties.length && (
              <Text className="database-settings-empty" size="sm" c="dimmed">
                尚未新增屬性。新增日期、標籤或其他欄位，讓筆記更好整理。
              </Text>
            )}
            {properties.map((p, index) => (
              <div
                className="database-field-editor"
                key={p.id}
                data-property={p.id}
              >
                <div className="database-field-editor-main">
                  <PropertyIcon type={p.type} />
                  <TextInput
                    autoFocus={session?.field === p.id}
                    data-autofocus={session?.field === p.id || undefined}
                    aria-label={"欄位名稱 " + (index + 1)}
                    value={p.name}
                    onChange={(e) =>
                      setProperties((items) =>
                        items.map((x) =>
                          x.id === p.id ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <NativeSelect
                    aria-label={"欄位類型 " + (index + 1)}
                    value={p.type}
                    data={Object.entries(PROPERTY_TYPES).map(
                      ([value, label]) => ({ value, label }),
                    )}
                    onChange={(e) =>
                      setProperties((items) =>
                        items.map((x) =>
                          x.id === p.id
                            ? {
                                ...x,
                                type: e.target.value as Property["type"],
                                options: [],
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  <div className="database-field-actions">
                    <Button
                      variant="subtle"
                      className="database-icon-button"
                      aria-label={"上移 " + p.name}
                      title="上移欄位"
                      disabled={index === 0}
                      onClick={() => setProperties(move(properties, index, -1))}
                    >
                      <IconArrowUp size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="subtle"
                      className="database-icon-button"
                      aria-label={"下移 " + p.name}
                      title="下移欄位"
                      disabled={index === properties.length - 1}
                      onClick={() => setProperties(move(properties, index, 1))}
                    >
                      <IconArrowDown size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      color="red"
                      variant="subtle"
                      className="database-icon-button"
                      aria-label={"刪除 " + p.name}
                      title={"刪除 " + p.name}
                      onClick={() => setRemove(p.id)}
                    >
                      <IconTrash size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {["select", "multiSelect"].includes(p.type) && (
                  <div className="database-options-editor">
                    <Text
                      size="xs"
                      c="dimmed"
                      className="database-section-caption"
                    >
                      選項
                    </Text>
                    {p.options.map((o, i) => (
                      <Group
                        className="database-option-row"
                        key={o.id}
                        gap="xs"
                      >
                        <TextInput
                          aria-label={"選項 " + p.name + " " + (i + 1)}
                          value={o.name}
                          onChange={(e) =>
                            setProperties((items) =>
                              items.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      options: x.options.map((option) =>
                                        option.id === o.id
                                          ? { ...option, name: e.target.value }
                                          : option,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <NativeSelect
                          aria-label={"選項顏色 " + p.name + " " + (i + 1)}
                          value={o.color ?? "gray"}
                          data={[...OPTION_COLORS]}
                          onChange={(e) =>
                            setProperties((items) =>
                              items.map((item) =>
                                item.id === p.id
                                  ? {
                                      ...item,
                                      options: item.options.map((option) =>
                                        option.id === o.id
                                          ? {
                                              ...option,
                                              color: e.target
                                                .value as (typeof OPTION_COLORS)[number],
                                            }
                                          : option,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="subtle"
                          color="red"
                          className="database-icon-button"
                          aria-label={"移除選項 " + o.name}
                          title={"移除選項 " + o.name}
                          onClick={() =>
                            setProperties((items) =>
                              items.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      options: x.options.filter(
                                        (option) => option.id !== o.id,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          <IconX size={14} aria-hidden="true" />
                        </Button>
                      </Group>
                    ))}
                    <TextInput
                      aria-label={"新增選項 " + p.name}
                      placeholder="＋ 新增選項，按 Enter 確認"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !e.currentTarget.value.trim())
                          return;
                        e.preventDefault();
                        const name = e.currentTarget.value.trim();
                        setProperties((items) =>
                          items.map((x) =>
                            x.id === p.id
                              ? {
                                  ...x,
                                  options: [
                                    ...x.options,
                                    {
                                      id: crypto.randomUUID(),
                                      name,
                                      color: "blue",
                                    },
                                  ],
                                }
                              : x,
                          ),
                        );
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <form
            className="database-new-field"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const p: Property = {
                  id: crypto.randomUUID(),
                  name: newName.trim(),
                  type: newType,
                  options: [],
                };
                const next = [...properties, p];
                await saveConfig({
                  properties: next,
                  views: config.views.map((v) => ({
                    ...v,
                    columns: [...v.columns, p.id],
                  })),
                });
                setNewName("");
              });
            }}
          >
            <div className="database-new-field-row">
              <TextInput
                label="新欄位名稱"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={100}
              />
              <NativeSelect
                label="新欄位類型"
                value={newType}
                data={Object.entries(PROPERTY_TYPES).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(e) => setNewType(e.target.value as Property["type"])}
              />
              <Button
                type="submit"
                variant="default"
                leftSection={<IconPlus size={14} aria-hidden="true" />}
                disabled={disabled}
              >
                新增欄位
              </Button>
            </div>
          </form>
          <div className="database-dialog-footer">
            <Text size="xs" c="dimmed">
              刪除欄位後，原值仍保留於筆記與備份。
            </Text>
            <Button
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const order = properties.map((p) => p.id);
                  const next = {
                    properties,
                    views: config.views.map((v) => ({
                      ...v,
                      columns: [
                        ...v.columns.filter((id) =>
                          BUILTIN.some((p) => p.id === id),
                        ),
                        ...order.filter((id) => v.columns.includes(id)),
                      ],
                    })),
                  };
                  await saveConfig(next);
                  onClose();
                })
              }
            >
              儲存欄位
            </Button>
          </div>
        </Stack>
      </Modal>
      <Modal
        opened={!!session && !!remove}
        onClose={() => setRemove(undefined)}
        title="刪除欄位"
        classNames={{
          content: "database-dialog",
          header: "database-dialog-header",
          body: "database-dialog-body",
        }}
      >
        <Stack>
          <Text>
            刪除「{properties.find((p) => p.id === remove)?.name}
            」？原值保留於備份及筆記資料，不再顯示。
          </Text>
          <Group className="database-dialog-footer">
            <Button variant="default" onClick={() => setRemove(undefined)}>
              取消刪除
            </Button>
            <Button
              color="red"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const next = properties.filter((p) => p.id !== remove);
                  await saveConfig({
                    properties: next,
                    views: config.views.map((v) => ({
                      ...v,
                      columns: v.columns.filter((id) => id !== remove),
                      widths: Object.fromEntries(
                        Object.entries(v.widths ?? {}).filter(
                          ([id]) => id !== remove,
                        ),
                      ),
                      filters: v.filters.filter((f) => f.property !== remove),
                      sorts: v.sorts.filter((s) => s.property !== remove),
                    })),
                  });
                  setRemove(undefined);
                })
              }
            >
              確認刪除欄位
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
