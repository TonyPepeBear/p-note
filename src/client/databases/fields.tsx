import { useEffect, useRef, useState } from "react";
import { Anchor, Button, Checkbox, Group, MultiSelect, NativeSelect, Text, TextInput } from "@mantine/core";
import { IconCalendar, IconCheck, IconDatabase, IconHash, IconLink, IconListDetails, IconTypography } from "@tabler/icons-react";
import { navigate, registerDraft } from "../api";
import type { PageInfo, PageRow } from "../../shared/pages";
import { readConfig, readValues, type Property, type PropertyValue } from "../../shared/databases";
import { useDatabase } from "./use-database";
import { request, useOnline } from "./utils";

export function PropertyIcon({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = type === "number" ? IconHash
    : type === "date" ? IconCalendar
    : type === "checkbox" ? IconCheck
    : type === "url" ? IconLink
    : type === "select" || type === "multiSelect" ? IconListDetails
    : IconTypography;
  return <Icon size={size} stroke={1.6} aria-hidden="true" />;
}

export function FieldInput({
  row,
  property,
  status,
  disabled = false,
}: {
  row: PageRow;
  property: Property;
  status: (text: string) => void;
  disabled?: boolean;
}) {
  const value =
    property.id === "title"
      ? row.title
      : (readValues(row.property_values)[property.id] ?? null);
  const [draft, setDraft] = useState<PropertyValue>(value);
  const dirty = useRef(false);
  const editGeneration = useRef(row.sync_generation);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const pending = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [JSON.stringify(value)]);
  const save = async (next = draft) => {
    if (pending.current) await pending.current;
    if (!dirty.current) return;
    if (!navigator.onLine || disabled) throw new Error("欄位修改需要連線");
    setBusy(true);
    status("儲存中");
    setFailure("");
    const work = request("/api/pages/" + row.id + "/properties", {
      property: property.id,
      value: next,
      generation: editGeneration.current,
    })
      .then(() => {
        dirty.current = false;
        status("已儲存");
      })
      .catch((e: Error) => {
        setFailure(e.message);
        status(e.message);
        throw e;
      })
      .finally(() => {
        setBusy(false);
        pending.current = undefined;
      });
    pending.current = work;
    await work;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () =>
      registerDraft(
        () => saveRef.current(),
        () => dirty.current,
      ),
    [],
  );
  const change = (v: PropertyValue, immediately = false) => {
    setDraft(v);
    if (!dirty.current) editGeneration.current = row.sync_generation;
    dirty.current = true;
    status("尚未儲存");
    if (immediately) void save(v).catch(() => {});
  };
  const input = {
    "aria-label": property.name,
    disabled: disabled || !online || busy,
  };
  return (
    <div className="property-input">
      {property.type === "checkbox" ? (
        <Checkbox
          {...input}
          checked={draft === true}
          onChange={(e) => change(e.currentTarget.checked, true)}
        />
      ) : property.type === "select" ? (
        <NativeSelect
          {...input}
          value={typeof draft === "string" ? draft : ""}
          data={[
            { value: "", label: "未設定" },
            ...property.options.map((o) => ({ value: o.id, label: o.name })),
          ]}
          onChange={(e) => change(e.target.value, true)}
        />
      ) : property.type === "multiSelect" ? (
        <MultiSelect
          {...input}
          value={Array.isArray(draft) ? draft : []}
          data={property.options.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => change(v, true)}
          searchable
          clearable
        />
      ) : (
        <TextInput
          {...input}
          type={
            property.type === "date"
              ? "date"
              : property.type === "number"
                ? "number"
                : property.type === "url"
                  ? "url"
                  : "text"
          }
          value={
            typeof draft === "string" || typeof draft === "number" ? draft : ""
          }
          onChange={(e) =>
            change(
              property.type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            )
          }
          onBlur={() => void save().catch(() => {})}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save().catch(() => {});
            }
          }}
        />
      )}
      {failure && (
        <Button
          size="compact-xs"
          color="red"
          variant="subtle"
          onClick={() => void save().catch(() => {})}
          disabled={!online || busy}
        >
          重試保存
        </Button>
      )}
      {failure && (
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={busy}
          onClick={() => {
            dirty.current = false;
            setDraft(value);
            setFailure("");
            status("已放棄欄位修改");
          }}
        >
          放棄欄位修改
        </Button>
      )}
    </div>
  );
}

export function NoteProperties({
  page,
  readOnly = false,
}: {
  page: PageInfo;
  readOnly?: boolean;
}) {
  const parent = page.ancestors?.at(-1);
  const { data, error } = useDatabase(
    parent?.database_config ? parent.id : undefined,
  );
  const online = useOnline();
  const [status, setStatus] = useState("");
  if (!parent?.database_config) return null;
  const config = data?.config ?? readConfig(parent.database_config);
  const row = data?.rows.find((r) => r.id === page.id) ?? page;
  return (
    <section className="note-properties" aria-label="筆記屬性">
      <Group className="note-properties-header" justify="space-between">
        <Anchor
          href={"/?page=" + parent.id}
          onClick={(e) => {
            e.preventDefault();
            void navigate(parent.id).catch((e) => setStatus(e.message));
          }}
        >
          <IconDatabase size={14} aria-hidden="true" />
          返回 {parent.title}
        </Anchor>
        <Text size="xs" c="dimmed" role="status" data-testid="property-status">
          {status}
        </Text>
      </Group>
      {!online && (
        <Text size="sm" c="orange">
          欄位修改需要連線
        </Text>
      )}
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <div className="properties-grid">
        {config.properties.map((p) => (
          <div className="note-property-row" key={p.id}>
            <div className="note-property-label">
              <PropertyIcon type={p.type} />
              <span>{p.name}</span>
            </div>
            <FieldInput
              row={row}
              property={p}
              status={setStatus}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
