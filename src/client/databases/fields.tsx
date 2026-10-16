import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  Button,
  Checkbox,
  Group,
  Textarea,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconLoader2,
  IconCalendar,
  IconCheck,
  IconHash,
  IconLink,
  IconListDetails,
  IconTypography,
} from "@tabler/icons-react";
import { navigate, registerDraft } from "../api";
import { PageIcon } from "../page-icon";
import type { PageInfo, PageRow } from "../../shared/pages";
import {
  readConfig,
  readValues,
  type Property,
  type PropertyOption,
  type PropertyValue,
} from "../../shared/databases";
import { OptionInput } from "./option-input";
import { useLiveConfig } from "./live-config";
import { useDatabase } from "./use-database";
import { RequestError, request, useOnline } from "./utils";

export function PropertyIcon({
  type,
  size = 15,
}: {
  type: string;
  size?: number;
}) {
  const Icon =
    type === "number"
      ? IconHash
      : type === "date"
        ? IconCalendar
        : type === "checkbox"
          ? IconCheck
          : type === "url"
            ? IconLink
            : type === "select" || type === "multiSelect"
              ? IconListDetails
              : IconTypography;
  return <Icon size={size} stroke={1.6} aria-hidden="true" />;
}

export function FieldInput({
  row,
  property,
  status,
  disabled = false,
  wrap = false,
  autoFocus = false,
  onCreateOption,
}: {
  row: PageRow;
  property: Property;
  status: (text: string) => void;
  disabled?: boolean;
  wrap?: boolean;
  autoFocus?: boolean;
  onCreateOption?: (property: string, name: string) => Promise<PropertyOption>;
}) {
  const value =
    property.id === "title"
      ? row.title
      : (readValues(row.property_values)[property.id] ?? null);
  const [draft, setDraft] = useState<PropertyValue>(value);
  const dirty = useRef(false);
  const rejected = useRef(false);
  const latestDraft = useRef(value);
  const version = useRef(0);
  const [saved, setSaved] = useState(false);
  const editGeneration = useRef(row.sync_generation);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const pending = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    if (!dirty.current && !rejected.current) { setDraft(value); latestDraft.current = value; }
  }, [JSON.stringify(value)]);
  const save = async () => {
    while (pending.current) await pending.current.catch(() => {});
    if (!dirty.current) return;
    if (!navigator.onLine || disabled) throw new Error("欄位修改需要連線");
    const savingVersion = version.current;
    const next = latestDraft.current;
    setSaved(false);
    setBusy(true);
    status("儲存中");
    setFailure("");
    const work = request("/api/pages/" + row.id + "/properties", {
      property: property.id,
      value: next,
      generation: editGeneration.current,
    })
      .then(() => {
        if (version.current === savingVersion) dirty.current = false;
        setSaved(!dirty.current);
        status(dirty.current ? "尚未儲存" : "已儲存");
      })
      .catch((e: Error) => {
        if (e instanceof RequestError && [400, 409].includes(e.status) && version.current === savingVersion) {
          dirty.current = false;
          rejected.current = true;
        }
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
    latestDraft.current = v;
    rejected.current = false;
    setFailure("");
    version.current++;
    setSaved(false);
    if (!dirty.current) editGeneration.current = row.sync_generation;
    dirty.current = true;
    status("尚未儲存");
    if (immediately) void save().catch(() => {});
  };
  const input = {
    "aria-label": property.name,
    disabled: disabled || !online,
  };
  return (
    <div
      className="property-input"
      data-save-state={
        failure ? "error" : busy ? "saving" : saved ? "saved" : "draft"
      }
    >
      {property.type === "checkbox" ? (
        <Checkbox
          {...input}
          checked={draft === true}
          onChange={(e) => change(e.currentTarget.checked, true)}
        />
      ) : property.type === "select" || property.type === "multiSelect" ? (
        <OptionInput
          property={property}
          value={draft}
          disabled={input.disabled}
          onChange={(v) => change(v, true)}
          onCreate={onCreateOption}
        />
      ) : wrap && property.type === "text" ? (
        <Textarea
          {...input}
          autosize
          minRows={1}
          autoFocus={autoFocus}
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void save().catch(() => {})}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              property.id === "title" &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void save().catch(() => {});
            }
          }}
        />
      ) : (
        <TextInput
          {...input}
          autoFocus={autoFocus}
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
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save().catch(() => {});
            }
          }}
        />
      )}
      <span
        className="database-cell-status"
        role="status"
        aria-label={
          failure ? failure : busy ? "儲存中" : saved ? "已儲存" : undefined
        }
        title={failure || (busy ? "儲存中" : saved ? "已儲存" : "")}
      >
        {failure ? (
          <IconAlertCircle size={13} />
        ) : busy ? (
          <IconLoader2 size={13} />
        ) : saved ? (
          <IconCheck size={13} />
        ) : null}
      </span>
      {failure && (
        <Button
          size="compact-xs"
          color="red"
          variant="subtle"
          onClick={() => { dirty.current = true; rejected.current = false; editGeneration.current = row.sync_generation; void save().catch(() => {}); }}
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
            rejected.current = false;
            latestDraft.current = value;
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
  const fallback = useMemo(
    () =>
      parent?.database_config
        ? readConfig(parent.database_config)
        : { properties: [], views: [] },
    [parent?.database_config],
  );
  const source = data?.config ?? fallback;
  const live = useLiveConfig(
    parent?.id ?? "",
    source,
    data?.page.sync_generation ?? parent?.sync_generation ?? "",
  );
  if (!parent?.database_config) return null;
  const config = live.config;
  const createOption = async (
    property: string,
    name: string,
  ): Promise<PropertyOption> => {
    const existing = live.config.properties
      .find((p) => p.id === property)
      ?.options.find((option) => option.name === name);
    if (existing) {
      await live.flush();
      return existing;
    }
    const option: PropertyOption = {
      id: crypto.randomUUID(),
      name,
      color: "blue",
    };
    live.edit((config) => ({
      ...config,
      properties: config.properties.map((p) =>
        p.id === property ? { ...p, options: [...p.options, option] } : p,
      ),
    }));
    await live.flush();
    return option;
  };
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
          <PageIcon page={data?.page ?? parent} size={14} />
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
      {live.failure && (
        <Text size="sm" c="red" role="alert">
          {live.failure}
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={live.saving}
            onClick={() => {
              live.discard();
              setStatus("已放棄選項修改");
            }}
          >
            放棄選項修改
          </Button>
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
              onCreateOption={createOption}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
