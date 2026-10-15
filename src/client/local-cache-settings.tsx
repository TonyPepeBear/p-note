import { useEffect, useState } from "react";
import { Group, Stack, Text, Title } from "@mantine/core";

type CacheEstimate = StorageEstimate & {
  usageDetails?: { indexedDB?: number; caches?: number };
};
type AvailableEstimate = CacheEstimate & { usage: number; quota: number };

function validBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (bytes >= 1000 && unit < units.length - 1) {
    bytes /= 1000;
    unit++;
  }
  return `${bytes.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function LocalCacheSettings() {
  const [estimate, setEstimate] = useState<AvailableEstimate | null>();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (typeof navigator.storage?.estimate !== "function") {
          if (active) setEstimate(null);
          return;
        }
        const result: CacheEstimate = await navigator.storage.estimate();
        if (active) setEstimate(validBytes(result.usage) && validBytes(result.quota)
          ? { ...result, usage: result.usage, quota: result.quota }
          : null);
      } catch {
        if (active) setEstimate(null);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const details = [
    { label: "IndexedDB", bytes: estimate?.usageDetails?.indexedDB },
    { label: "Cache Storage", bytes: estimate?.usageDetails?.caches },
  ].flatMap(({ label, bytes }) => validBytes(bytes) ? [{ label, bytes }] : []);

  return (
    <section className="settings-section" aria-labelledby="local-cache-title">
      <Title id="local-cache-title" order={2} size="sm">本地快取</Title>
      <div aria-live="polite">
        {estimate === undefined ? (
          <Text size="sm" c="dimmed" mt="sm" role="status">正在取得快取用量…</Text>
        ) : estimate === null ? (
          <Text size="sm" c="dimmed" mt="sm">此瀏覽器無法取得快取用量</Text>
        ) : (
          <>
            <Text size="xs" c="dimmed" mt="sm">已用空間／可用上限</Text>
            <Text size="sm" mt={4}>{formatBytes(estimate.usage)}／{formatBytes(estimate.quota)}</Text>
            <Text size="xs" c="dimmed" mt={4}>此網站在目前瀏覽器的儲存估計值，上限可能隨可用空間變動。</Text>
            {details.length > 0 && (
              <Stack component="dl" gap={8} mt="md" mb={0}>
                {details.map(({ label, bytes }) => (
                  <Group key={label} justify="space-between" gap="sm">
                    <Text component="dt" size="sm">{label}</Text>
                    <Text component="dd" size="sm" m={0}>{formatBytes(bytes)}</Text>
                  </Group>
                ))}
              </Stack>
            )}
          </>
        )}
      </div>
    </section>
  );
}
