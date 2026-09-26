/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Vardena API, e.g. `/api/v1` (same origin by default). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
