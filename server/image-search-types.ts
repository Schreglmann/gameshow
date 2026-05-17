// Shared types for the multi-provider image search (DuckDuckGo, Wikimedia
// Commons, OpenVerse). Mirrors the OpenAPI schemas
// `ImageSearchProvider` / `ImageSearchResult` / `ImageSearchResponse`.

export type ImageSearchProvider = 'ddg' | 'commons';

export interface RawImageSearchResult {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  source: ImageSearchProvider;
  title?: string;
  license?: string;
}

export interface ImageSearchResponse {
  results: RawImageSearchResult[];
  partial: boolean;
  errors?: Record<ImageSearchProvider, string>;
  page: number;
  // True when at least one provider returned a full page — implies more results
  // may exist on the next page.
  hasMore: boolean;
}
