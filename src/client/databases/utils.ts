import { useEffect, useState } from "react";
import { api } from "../api";
import type { DatabaseConfig } from "../../shared/databases";

export type ConfigSession = {
  field?: string;
  config: DatabaseConfig;
  previous: string;
  generation: string;
};
export type SaveConfig = (next: DatabaseConfig, previous: string, generation: string) => Promise<DatabaseConfig>;

export function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target >= 0 && target < list.length)
    [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export async function request(path: string, body?: object) {
  const response = await api(path, body);
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? "資料庫操作失敗，請重試");
  return value;
}
export function useOnline() {
  const [online, set] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => set(navigator.onLine);
    addEventListener("online", changed);
    addEventListener("offline", changed);
    return () => {
      removeEventListener("online", changed);
      removeEventListener("offline", changed);
    };
  }, []);
  return online;
}
