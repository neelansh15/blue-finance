# Blue Finance frontend

Next.js (App Router, TypeScript) landing page for the Blue Finance draft. Static content, no backend.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Demo app (`/app`)

Mocked-data demo UI. Developer controls: `/app?dev=1` or Shift+D. All chain access is in `src/lib/blue/` (`client.ts` entry, `mock.ts` now, `real.ts` viem stub, env `NEXT_PUBLIC_BLUE_*`, `NEXT_PUBLIC_BLUE_MODE=real` to select it). Pure math is in `src/lib/blue/math.ts`.

```
npm test        # vitest
```

Haircuts, margin and the continuity band in `src/lib/blue/params.ts` are illustrative placeholders.
