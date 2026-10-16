import { useState } from "react";
import { Badge, Combobox, TextInput, useCombobox } from "@mantine/core";
import {
  OPTION_COLORS,
  type Property,
  type PropertyOption,
  type PropertyValue,
} from "../../shared/databases";
export function OptionPill({ option }: { option: PropertyOption }) {
  return (
    <Badge
      className="database-option-pill"
      color={
        option.color ??
        OPTION_COLORS[(option.id.charCodeAt(0) || 0) % OPTION_COLORS.length]
      }
      variant="light"
      radius="sm"
      style={{ textTransform: "none", flexShrink: 0 }}
    >
      {option.name}
    </Badge>
  );
}
export function OptionInput({
  property,
  value,
  disabled,
  onChange,
  onCreate,
}: {
  property: Property;
  value: PropertyValue;
  disabled: boolean;
  onChange: (value: PropertyValue) => void;
  onCreate?: (property: string, name: string) => Promise<PropertyOption>;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const combo = useCombobox({
    onDropdownClose: () => {
      combo.resetSelectedOption();
      setSearch("");
    },
  });
  const selected = Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
  const choose = (id: string) => {
    onChange(
      property.type === "multiSelect"
        ? selected.includes(id)
          ? selected.filter((v) => v !== id)
          : [...selected, id]
        : id,
    );
    if (property.type === "select") combo.closeDropdown();
  };
  const options = property.options.filter((o) =>
    o.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="database-option-cell">
      <div className="database-option-values">
        {selected.map((id) => {
          const option = property.options.find((o) => o.id === id);
          return option && <OptionPill key={id} option={option} />;
        })}
      </div>
      <Combobox
        store={combo}
        withinPortal
        onOptionSubmit={(id) => {
          if (id !== "$create") {
            choose(id);
            return;
          }
          if (!onCreate || creating) return;
          setCreating(true);
          setError("");
          void onCreate(property.id, search.trim())
            .then((option) => {
              choose(option.id);
              setSearch("");
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setCreating(false));
        }}
      >
        <Combobox.Target withExpandedAttribute>
          <TextInput
            aria-label={property.name}
            placeholder={selected.length ? "搜尋或新增…" : "選擇或建立…"}
            value={search}
            disabled={disabled || creating}
            onChange={(e) => {
              setSearch(e.target.value);
              combo.openDropdown();
              combo.updateSelectedOptionIndex();
            }}
            onFocus={() => combo.openDropdown()}
            onClick={() => combo.openDropdown()}
            onBlur={() => combo.closeDropdown()}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options>
            {options.map((option) => (
              <Combobox.Option
                value={option.id}
                key={option.id}
                active={selected.includes(option.id)}
              >
                <OptionPill option={option} />{" "}
                {selected.includes(option.id) ? "✓" : ""}
              </Combobox.Option>
            ))}
            {!!search.trim() &&
              !property.options.some((o) => o.name === search.trim()) &&
              onCreate && (
                <Combobox.Option
                  value="$create"
                  disabled={
                    creating ||
                    property.options.length >= 100 ||
                    search.trim().length > 100
                  }
                >
                  建立「{search.trim()}」
                </Combobox.Option>
              )}
            {property.type === "select" && (
              <Combobox.Option value="">未設定</Combobox.Option>
            )}
            {!options.length && !search.trim() && (
              <Combobox.Empty>輸入以建立選項</Combobox.Empty>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {error && (
        <span role="alert" className="database-cell-error">
          {error}
        </span>
      )}
    </div>
  );
}
