/**
 * Vite Library Build Configuration
 * 
 * Generates:
 * - dist/avatar-chat-widget.umd.cjs  (for <script> tags)
 * - dist/avatar-chat-widget.js       (ES module for npm)
 * - dist/avatar-chat-widget.d.ts     (TypeScript definitions)
 * - dist/style.css                    (widget styles, if any external)
 * 
 * Usage:
 *   npm run build:lib
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    // Generate TypeScript declaration files
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
      outDir: 'dist',
      include: ['src/widget.ts', 'src/types/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    }),
  ],

  build: {
    // Library mode
    lib: {
      // Entry point for the library
      entry: resolve(__dirname, 'src/widget.ts'),
      
      // Global variable name for UMD/IIFE builds
      name: 'AvatarChat',
      
      // Output file names (without extension)
      fileName: (format) => {
        if (format === 'umd') return 'avatar-chat-widget.umd.cjs';
        if (format === 'es') return 'avatar-chat-widget.js';
        return `avatar-chat-widget.${format}.js`;
      },
      
      // Build both UMD (script tags) and ES (npm) formats
      formats: ['umd', 'es'],
    },

    // Output directory
    outDir: 'dist',
    
    // Clean output directory before build
    emptyDir: true,

    // Rollup options
    rollupOptions: {
      // External dependencies that shouldn't be bundled
      // Note: We bundle everything for the UMD build so it works standalone
      external: [],
      
      output: {
        // Global variable names for external dependencies (if any)
        globals: {},
        
        // Ensure CSS is extracted
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'avatar-chat-widget.css';
          }
          return assetInfo.name || 'assets/[name]-[hash][extname]';
        },
        
        // Preserve export names
        exports: 'named',
        
        // Interop settings for better CommonJS compatibility
        interop: 'auto',
        
        // Force single bundle (no code splitting for library)
        inlineDynamicImports: true,
      },
    },

    // Minification
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove console.log in production (keep errors and warnings)
        pure_funcs: ['console.debug', 'console.log'],
        drop_debugger: true,
      },
      mangle: {
        // Don't mangle these to keep stack traces readable
        reserved: ['AvatarChat', 'AvatarChatElement'],
      },
      format: {
        comments: false,
      },
    },

    // Generate sourcemaps for debugging
    sourcemap: true,

    // Chunk size warnings
    chunkSizeWarningLimit: 2000,

    // Don't copy public folder for lib build
    copyPublicDir: false,

    // Target modern browsers for smaller bundle
    target: 'es2020',
  },

  // Define replacements
  define: {
    // Replace version placeholder
    '__VERSION__': JSON.stringify(process.env.npm_package_version || '0.0.0'),
  },

  // Resolve settings
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
