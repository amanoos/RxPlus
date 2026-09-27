/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PrimeUI Community License key. Build-time: inlined into the client bundle. */
  readonly VITE_PRIMEUI_LICENSE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  /** Set by Nitro while prerendering pages during the build. */
  readonly prerender?: boolean;
}
