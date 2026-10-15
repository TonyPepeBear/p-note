import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconPhoto } from "@tabler/icons-react";
import { ASSET_PAGE_SIZE, type AssetList, type AssetSummary } from "../shared/assets";
import { api } from "./api";
import "./settings.css";
import "./my-images.css";

const formats: Record<string, string> = {
  "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP", "image/gif": "GIF",
};

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} MiB`;
}

function ImageCard({ asset }: { asset: AssetSummary }) {
  const [failed, setFailed] = useState(false);
  return <article className="my-image-card" aria-label={asset.original_name}>
    <div className="my-image-preview">
      {failed ? <div className="my-image-unavailable" role="status">
        <IconPhoto size={24} stroke={1.5} aria-hidden="true" />
        <Text size="xs">縮圖無法載入</Text>
      </div> : <img src={`/api/assets/${encodeURIComponent(asset.id)}`} alt={asset.original_name}
        loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </div>
    <dl className="my-image-details">
      <div className="my-image-name"><dt>原始檔名</dt><dd>{asset.original_name}</dd></div>
      <div><dt>格式</dt><dd>{formats[asset.mime_type] ?? asset.mime_type}</dd></div>
      <div><dt>大小</dt><dd>{fileSize(asset.byte_size)}</dd></div>
      <div className="my-image-uploaded"><dt>上傳時間</dt><dd>
        <time dateTime={new Date(asset.created_at).toISOString()}>
          {new Date(asset.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}
        </time>
      </dd></div>
    </dl>
  </article>;
}

export function MyImages({ close, unauthorized }: { close: () => void; unauthorized: () => void }) {
  const [pageNumber, setPageNumber] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<AssetList>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const unauthorizedRef = useRef(unauthorized);
  unauthorizedRef.current = unauthorized;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setError("");
    setResult(undefined);
    void (async () => {
      const response = await api(`/api/assets?page=${pageNumber}&page_size=${ASSET_PAGE_SIZE}`, undefined, controller.signal);
      if (disposed) return;
      if (response.status === 401) {
        unauthorizedRef.current();
        return;
      }
      if (!response.ok) throw new Error("圖片列表載入失敗，請重試");
      const list = await response.json() as AssetList;
      if (disposed) return;
      // 還原可能讓總頁數減少，重新查詢當下的末頁。
      const last = Math.max(1, list.total_pages);
      if (pageNumber > last) { setPageNumber(last); return; }
      setResult(list);
    })().catch(() => {
      if (!disposed) setError("圖片列表載入失敗，請重試");
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; controller.abort(); };
  }, [pageNumber, retry]);

  return <section className="settings-page my-images-page" aria-label="我的圖片" aria-busy={loading}>
    <header className="settings-header">
      <Button className="settings-back" variant="subtle" color="gray" leftSection={<IconArrowLeft size={16} />} onClick={close}>
        返回文件
      </Button>
      <Title order={1} tabIndex={-1} ref={heading}>我的圖片</Title>
      <Text c="dimmed" size="sm" mt={8}>查看你上傳過的圖片，依上傳時間由新到舊排列。</Text>
    </header>
    {loading ? <Group className="settings-loading" gap="sm" role="status">
      <Loader size="sm" aria-label="載入圖片" /><Text size="sm" c="dimmed">載入圖片中…</Text>
    </Group> : error ? <Alert color="red" role="alert" title="無法載入圖片">
      {error}<Button variant="subtle" onClick={() => setRetry(current => current + 1)}>重試</Button>
    </Alert> : result && <>
      <Text size="sm" c="dimmed" mb="md" role="status">共 {result.total} 張圖片</Text>
      {!result.total ? <div className="settings-empty">
        <IconPhoto size={24} stroke={1.5} aria-hidden="true" />
        <Text size="sm" mt="sm">還沒有上傳圖片</Text>
        <Text size="sm" c="dimmed" mt={4}>在筆記或日記插入圖片後，就能在這裡查看。</Text>
      </div> : <>
        <div className="my-images-list">{result.items.map(asset => <ImageCard key={asset.id} asset={asset} />)}</div>
        <nav className="my-images-pagination" aria-label="圖片分頁">
          <Button variant="default" disabled={loading || pageNumber === 1} onClick={() => setPageNumber(current => current - 1)}>上一頁</Button>
          <Text size="sm" aria-live="polite">第 {result.page} / {result.total_pages} 頁</Text>
          <Button variant="default" disabled={loading || pageNumber >= result.total_pages} onClick={() => setPageNumber(current => current + 1)}>下一頁</Button>
        </nav>
      </>}
    </>}
  </section>;
}
