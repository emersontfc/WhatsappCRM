import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { publicConfig } from './shared/publicConfig.ts';

export default defineConfig(({mode}) => {
  const env = publicConfig(loadEnv(mode, '.', 'VITE_'));
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: 'AGENTX_PUBLIC_',
    define: Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-ui': ['lucide-react', 'sonner', 'clsx', 'tailwind-merge', 'motion']
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/whatsapp_sessions_data/**',
          '**/uploads/**',
          '**/scratch/**',
          '**/*.log',
          '**/*.json',
          '**/.gemini/**',
        ],
      },
    },
  };
});
