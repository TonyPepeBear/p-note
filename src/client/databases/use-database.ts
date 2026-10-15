import { useCallback, useEffect, useRef, useState } from "react";
import { api, hasMetadataDrafts } from "../api";
import type { DatabaseData } from "../../shared/databases";

export function useDatabase(id?: string) {
  const [state, setState] = useState<{
    id?: string;
    data?: DatabaseData;
    error: string;
  }>({ id, error: "" });
  const loader = useRef<{ id?: string; load: () => Promise<void> }>(undefined);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    let etag: string | null = null;
    let controller: AbortController | undefined;
    let pending: Promise<void> | undefined;
    let following: Promise<void> | undefined;
    const read = async (ticket: number, signal: AbortSignal) => {
      try {
        const response = await api("/api/databases/" + id, undefined, signal, etag ? { "If-None-Match": etag } : undefined);
        if (!active || ticket !== sequence) return;
        if (response.status === 304) {
          setState((previous) => previous.error ? { ...previous, error: "" } : previous);
          return;
        }
        const value = await response.json();
        if (!active || ticket !== sequence) return;
        if (!response.ok) throw new Error(value.message ?? "資料庫操作失敗，請重試");
        // 只有實際採用的資料才能前移版本，否則草稿結束後會一直拿到 304。
        if (hasMetadataDrafts()) return;
        etag = response.headers.get("ETag");
        setState({ id, data: value as DatabaseData, error: "" });
      } catch (failure) {
        if (!active || ticket !== sequence || (failure as Error).name === "AbortError") return;
        setState((previous) => ({ ...previous, error: (failure as Error).message }));
        throw failure;
      }
    };
    const load = (): Promise<void> => {
      if (!active || !id || !navigator.onLine || document.visibilityState !== "visible" || hasMetadataDrafts()) return Promise.resolve();
      if (pending) return controller?.signal.aborted ? fresh() : pending;
      const ticket = ++sequence;
      controller = new AbortController();
      const work = read(ticket, controller.signal).finally(() => {
        if (pending === work) pending = undefined;
      });
      pending = work;
      return work;
    };
    const fresh = (): Promise<void> => {
      if (!pending) return load();
      if (!following) {
        // 保存後的刷新必須晚於既有 GET，不能採用保存前開始讀取的快照。
        sequence++;
        following = pending.catch(() => {}).then(() => {
          following = undefined;
          return load();
        });
      }
      return following;
    };
    const schedule = () => { void load().catch(() => {}); };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") schedule();
      else {
        sequence++;
        controller?.abort();
      }
    };
    const current = { id, load: fresh };
    loader.current = current;
    setState({ id, error: "" });
    schedule();
    const timer = setInterval(schedule, 3000);
    addEventListener("focus", schedule);
    addEventListener("online", schedule);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      active = false;
      sequence++;
      controller?.abort();
      if (loader.current === current) loader.current = undefined;
      clearInterval(timer);
      removeEventListener("focus", schedule);
      removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [id]);

  const refresh = useCallback(async () => {
    const current = loader.current;
    if (current && current.id === id) await current.load();
  }, [id]);
  return {
    data: state.id === id ? state.data : undefined,
    error: state.id === id ? state.error : "",
    refresh,
  };
}
