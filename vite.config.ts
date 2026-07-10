// vite.config.ts
import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: '0.0.0.0',
    https: true,
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.logs in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
        passes: 2
      },
      mangle: {
        safari10: true
      },
      format: {
        comments: false
      }
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Split node_modules by package
          if (id.includes('node_modules')) {
            // Avatar renderers - heavy 3D libraries
            if (id.includes('@myned-ai/gsplat-flame-avatar-renderer')) {
              return 'avatar-flame';
            }
            // Utility library
            if (id.includes('jszip')) {
              return 'jszip';
            }
            // All other vendor code
            return 'vendor';
          }

          // Split by functional area for better caching
          if (id.includes('/services/')) {
            return 'services';
          }
          if (id.includes('/utils/')) {
            return 'utils';
          }
          if (id.includes('/avatar/')) {
            return 'avatar';
          }
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    // Increase chunk size warning limit (avatar renderers are large)
    chunkSizeWarningLimit: 1000,
    // Enable source maps for debugging (can disable in production)
    sourcemap: false,
    // Optimize CSS
    cssCodeSplit: true,
    // Better tree-shaking
    modulePreload: {
      polyfill: false
    }
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['jszip'],
    exclude: ['@myned-ai/gsplat-flame-avatar-renderer']
  }
})