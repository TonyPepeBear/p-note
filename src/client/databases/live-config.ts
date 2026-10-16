import { useEffect, useRef, useState } from "react";
import type { DatabaseConfig } from "../../shared/databases";
import { registerDraft } from "../api";
import { request } from "./utils";

type Edit = (config: DatabaseConfig) => DatabaseConfig;
// 同一分頁的快速修改依序送出；未確認的編輯保留於草稿，不讓輪詢覆蓋。
export function useLiveConfig(
  id: string,
  source: DatabaseConfig,
  generation: string,
) {
  const base = useRef({ config: source, generation });
  const edits = useRef<Edit[]>([]);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const [draft, setDraft] = useState<DatabaseConfig>();
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const flush = async (): Promise<void> => {
    if (pending.current) return pending.current;
    if (!edits.current.length) return;
    setSaving(true);
    setFailure("");
    const work = (async () => {
      while (edits.current.length) {
        const batch = [...edits.current];
        const previous = base.current;
        const next = batch.reduce(
          (config, edit) => edit(config),
          previous.config,
        );
        const saved = await request("/api/databases/" + id + "/config", {
          config: next,
          previous: JSON.stringify(previous.config),
          generation: previous.generation,
        });
        base.current = {
          config: JSON.parse(saved.database_config),
          generation: saved.sync_generation,
        };
        edits.current.splice(0, batch.length);
        setDraft(
          edits.current.reduce(
            (config, edit) => edit(config),
            base.current.config,
          ),
        );
      }
    })()
      .catch((error: Error) => {
        setFailure(error.message);
        throw error;
      })
      .finally(() => {
        pending.current = undefined;
        setSaving(false);
      });
    pending.current = work;
    return work;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () =>
      registerDraft(
        () => flushRef.current(),
        () => edits.current.length > 0,
      ),
    [],
  );
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (edits.current.length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    addEventListener("beforeunload", leaving);
    return () => removeEventListener("beforeunload", leaving);
  }, []);
  useEffect(() => {
    if (!edits.current.length && !pending.current) {
      base.current = { config: source, generation };
      setDraft(undefined);
    }
  }, [source, generation]);
  const edit = (change: Edit) => {
    edits.current.push(change);
    setDraft(
      edits.current.reduce(
        (config, change) => change(config),
        base.current.config,
      ),
    );
    void flush().catch(() => {});
  };
  const discard = () => {
    if (pending.current) return;
    edits.current = [];
    base.current = { config: source, generation };
    setDraft(undefined);
    setFailure("");
  };
  return { config: draft ?? source, edit, flush, discard, failure, saving };
}
