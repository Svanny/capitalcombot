# Tech Stack

- TypeScript ESM project, package manager `pnpm@10.32.1`, Node.js 25+ per README.
- Electron + electron-vite app. Entrypoints: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`; built main output configured as `out/main/index.js`.
- React 19 renderer, Vite 7/electron-vite 5, `@vitejs/plugin-react`.
- Vitest 4 with globals; config uses Node test environment globally plus renderer setup file `src/renderer/src/test/setup.ts` for Testing Library/jest-dom/jsdom-oriented tests.
- Main/preload bundles use `externalizeDepsPlugin`; preload builds CJS library output and externalizes `electron`.
- Path aliases: `@main -> src/main`, `@renderer -> src/renderer/src`, `@shared -> src/shared` in electron-vite and Vitest.
- Runtime storage/security deps: `electron-store`, `keytar`, local redaction/state-integrity helpers.
- Packaging: `electron-builder`; platform scripts in `scripts/package-*.{sh,mjs}`; release artifacts go to `release/`.