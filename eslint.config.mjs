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
  // Supabase Edge Functions run on Deno and are validated with `deno check` in their
  // fiscal workflows. Keep the Next.js ESLint rules scoped to the web/Node application.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'desktop-pdv/**', 'supabase/functions/**', 'next-env.d.ts']),
]);
