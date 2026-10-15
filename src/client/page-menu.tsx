import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@mantine/core";
import { IconArrowsMove, IconDatabase, IconDots, IconHistory, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import type { PageRow } from "../shared/pages";

export type PageAction = "rename" | "move" | "delete" | "child" | "database" | "history";

export function PageMenu({ page, disabled, active, history, onAction, onOpenChange, children }: {
  page: PageRow;
  disabled: boolean;
  active?: boolean;
  history?: boolean;
  onAction: (action: PageAction, page: PageRow, trigger: HTMLButtonElement | null) => void;
  onOpenChange: (opened: boolean) => void;
  children?: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const change = (value: boolean) => { setOpened(value); onOpenChange(value); };
  useEffect(() => {
    if (disabled && opened) change(false);
    if (!opened) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 右鍵開啟到焦點陷阱就緒之間，也要能取消並返回實體按鈕。
      event.stopPropagation();
      restoreFocus.current = true;
      change(false);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [disabled, opened]);
  const action = (name: PageAction) => onAction(name, page, trigger.current);
  const button = <Menu.Target>
    <button ref={trigger} type="button" disabled={disabled} className={"pn-icon-button" + (children ? " pn-page-menu-trigger" : "")}
      aria-label={children ? "頁面操作：" + page.title : "頁面操作"} title="頁面操作">
      <IconDots size={children ? 18 : 20} />
    </button>
  </Menu.Target>;
  return <Menu opened={opened} onChange={(value) => { if (value) restoreFocus.current = false; change(value); }}
    disabled={disabled} position="bottom-end" width={220} closeOnEscape={false} returnFocus={false}
    onExitTransitionEnd={() => { if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus(); } }}
    middlewares={{ flip: true, shift: true, size: true }}>
    {children ? <Menu.ContextMenu disabled={disabled}>
      <div className="pn-note-row" data-active={active || undefined} data-disabled={disabled || undefined}
        onContextMenu={() => { if (!disabled) trigger.current?.focus(); }}>
        {children}{button}
      </div>
    </Menu.ContextMenu> : button}
    <Menu.Dropdown aria-label="頁面操作" className="pn-page-menu">
      <Menu.Label title={page.title}>{page.title}</Menu.Label>
      <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => action("rename")}>重新命名</Menu.Item>
      {history && !page.database_config && <Menu.Item leftSection={<IconHistory size={16} />} onClick={() => action("history")}>版本歷史</Menu.Item>}
      {page.kind === "note" && <>
        <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => action("child")}>新增子頁面</Menu.Item>
        {!page.database_config && <Menu.Item leftSection={<IconDatabase size={16} />} onClick={() => action("database")}>新增子資料庫</Menu.Item>}
        <Menu.Item leftSection={<IconArrowsMove size={16} />} onClick={() => action("move")}>移動頁面</Menu.Item>
      </>}
      <Menu.Divider />
      <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => action("delete")}>移到垃圾桶</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
}
