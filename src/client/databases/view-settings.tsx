import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Modal,
  NativeSelect,
  Stack,
  TextInput,
} from "@mantine/core";
import type { DatabaseView } from "../../shared/databases";
import type { ConfigSession, SaveConfig } from "./utils";
export type ViewSession = ConfigSession & {
  view: DatabaseView;
  section: string;
};
export function ViewSettings({
  session,
  disabled,
  onClose,
  onSave,
  onSelected,
}: {
  session?: ViewSession;
  disabled: boolean;
  onClose: () => void;
  onSave: SaveConfig;
  onSelected: (id: string) => void;
}) {
  const [view, setView] = useState<DatabaseView>();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setView(session && structuredClone(session.view));
    setFailure("");
  }, [session]);
  return (
    <Modal
      opened={!!session}
      onClose={onClose}
      title="檢視設定"
      size="sm"
      classNames={{ content: "database-dialog" }}
    >
      {view && session && (
        <Stack>
          {failure && <Alert color="red">{failure}</Alert>}
          <TextInput
            label="檢視名稱"
            value={view.name}
            maxLength={100}
            onChange={(e) => setView({ ...view, name: e.target.value })}
          />
          <NativeSelect
            label="檢視形式"
            value={view.layout}
            data={[
              { value: "table", label: "表格" },
              { value: "list", label: "清單" },
            ]}
            onChange={(e) =>
              setView({ ...view, layout: e.target.value as "table" | "list" })
            }
          />
          <Button
            disabled={disabled || busy || !view.name.trim()}
            onClick={() => {
              setBusy(true);
              setFailure("");
              const views = session.config.views.some((v) => v.id === view.id)
                ? session.config.views.map((v) => (v.id === view.id ? view : v))
                : [...session.config.views, view];
              void onSave(
                { ...session.config, views },
                session.previous,
                session.generation,
              )
                .then(() => {
                  onSelected(view.id);
                  onClose();
                })
                .catch((e: Error) => setFailure(e.message))
                .finally(() => setBusy(false));
            }}
          >
            儲存檢視
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
