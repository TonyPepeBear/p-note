export const ASSET_PAGE_SIZE = 20;

export type AssetSummary = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  created_at: number;
  url: string;
};

export type AssetList = {
  items: AssetSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};
