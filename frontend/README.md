# Dawn Finance frontend

Next.js (App Router, TypeScript) landing page for the Dawn Finance draft. Static content, no backend.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Demo app (`/app`)

Mocked-data demo UI. Developer controls: `/app?dev=1` or Shift+D. All chain access is in `src/lib/dawn/` (`client.ts` entry, `mock.ts` now, `real.ts` viem stub, env `NEXT_PUBLIC_DAWN_*`, `NEXT_PUBLIC_DAWN_MODE=real` to select it). Pure math is in `src/lib/dawn/math.ts`.

```
npm test        # vitest
```

Haircuts, margin and the continuity band in `src/lib/dawn/params.ts` are illustrative placeholders.
