import { useEffect, useRef, useState } from "react";
import { Menu } from "@mantine/core";
import { IconDatabase, IconFileText, IconPlus } from "@tabler/icons-react";

export function CreateMenu({ disabled, sidebar = false, onNote, onDatabase, onOpenChange }: {
  disabled: boolean;
  sidebar?: boolean;
  onNote: () => void;
  onDatabase: () => void;
  onOpenChange: (opened: boolean) => void;
}) {
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const change = (value: boolean) => {
    const next = value && !disabled;
    if (next) restoreFocus.current = false;
    setOpened(next);
    onOpenChange(next);
  };
  useEffect(() => {
    if (disabled) { setOpened(false); onOpenChange(false); }
  }, [disabled, onOpenChange]);
  useEffect(() => {
    if (!opened) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      restoreFocus.current = true;
      setOpened(false);
      onOpenChange(false);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [opened, onOpenChange]);
  useEffect(() => () => onOpenChange(false), [onOpenChange]);
  const label = sidebar ? "新增私人頁面" : "新增";
  return <Menu opened={opened && !disabled} onChange={change} disabled={disabled}
    position="bottom-end" width={192} withinPortal withInitialFocusPlaceholder={false}
    closeOnEscape={false} returnFocus={false} onExitTransitionEnd={() => {
      // 手機抽屜恢復焦點陷阱後，再將取消選單的焦點交還加號。
      if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus(); }
    }}>
    <Menu.Target>
      <button ref={trigger} type="button" disabled={disabled} className={"pn-icon-button " + (sidebar ? "pn-sidebar-create-button" : "pn-create-button")}
        aria-label={label} title={label}>
        <IconPlus size={18} />{!sidebar && <span>新增</span>}
      </button>
    </Menu.Target>
    <Menu.Dropdown className="pn-create-menu" aria-label="新增">
      <Menu.Item disabled={disabled} leftSection={<IconFileText size={17} />} onClick={onNote}>新增筆記</Menu.Item>
      <Menu.Item disabled={disabled} leftSection={<IconDatabase size={17} />} onClick={onDatabase}>新增資料庫</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
}
