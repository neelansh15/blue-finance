# Dawn Finance frontend

Next.js (App Router, TypeScript) landing page for the Dawn Finance draft. Static content, no backend.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Demo app (`/app`)

Mocked-data demo UI. Developer controls: `/app?dev=1` or Shift+D. The demo uses the in-memory client in `src/lib/dawn/client.ts` and position math in `src/lib/dawn/math.ts`.

```
npm test        # vitest
```

Haircuts, margin and the continuity band are illustrative placeholders.
