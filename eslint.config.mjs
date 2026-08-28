import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These workspaces load server-backed data in effects after route hydration.
      // The state changes occur as part of async data synchronization, not derived render state.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/app/control/control-client.tsx'],
    rules: {
      // The onboarding payload is created from FormData before being normalized by the RPC boundary.
      '@typescript-eslint/no-wrapper-object-types': 'off',
    },
  },
  {
    files: [
      'src/app/dashboard/dashboard-studio.tsx',
      'src/app/dashboard/relatorios/studio/report-studio-client.tsx',
    ],
    rules: {
      // Donut stops are built with a render-local cumulative cursor. The variable is not state,
      // is recreated on every render and never escapes the pure chart formatting function.
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: [
      'src/app/dashboard/**/bank-cnab-multi-workspace.tsx',
      'src/app/dashboard/**/bank-cnab-reviewed-workspace.tsx',
      'src/app/dashboard/**/bank-cnab-workspace-v2.tsx',
      'src/app/dashboard/**/bank-homologation-workspace.tsx',
      'src/app/dashboard/**/financial-accounts-workspace.tsx',
      'src/app/dashboard/**/fiscal-documents-workspace.tsx',
      'src/app/dashboard/**/fiscal-settings-workspace.tsx',
      'src/app/dashboard/**/itau-bolecode-workspace.tsx',
      'src/app/dashboard/**/receivable-boleto-action-modal.tsx',
      'src/app/dashboard/**/sale-workspace.tsx',
      'src/app/dashboard/financeiro/boleto/**/page.tsx',
    ],
    rules: {
      // Transitional debt: these established workspaces predate the route-consolidation pass and
      // still use plain internal anchors. Keep the exception file-scoped so new ThorGestao screens
      // continue to enforce Next.js Link while each legacy workspace is migrated deliberately.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  // Supabase Edge Functions run on Deno and are validated with `deno check` in their
  // fiscal workflows. Keep the Next.js ESLint rules scoped to the web/Node application.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'desktop-pdv/**', 'supabase/functions/**', 'next-env.d.ts']),
]);
