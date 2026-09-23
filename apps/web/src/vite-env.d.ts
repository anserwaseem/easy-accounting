/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * override for the Jameel print face. default is the same-origin Worker
   * route `/fonts/jameel-noori-nastaleeq.woff2` (R2 behind it). only set this
   * for a different host — and that host must send CORP under COEP.
   */
  readonly VITE_URDU_PRINT_FONT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Vite aliases `renderer` at bundle time (see vite.config.ts). The apps/web
 * TypeScript program typechecks only the worker/shim shell — not the whole
 * desktop renderer — until Join/Sync UI is merged. These declarations keep
 * main.tsx compiling without pulling src/renderer into tsc.
 */
declare module 'renderer/routes' {
  import type { FC } from 'react';

  const AppRoutes: FC;
  export default AppRoutes;
}

declare module 'renderer/lib/invoicePrint/urduFont' {
  export function setUrduPrintFontUrl(url: string | null): void;
}

declare module 'renderer/styles/App.global.css';
