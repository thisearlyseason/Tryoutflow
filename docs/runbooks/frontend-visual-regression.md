# Frontend visual regression

TryoutFlow keeps canonical Chromium screenshots for the public authentication shell, role-aware application shell, tryout lifecycle, evidence-first decision tools, Game-Day workspaces, and administration surfaces.

## Compare the tracked baseline

Provision the local deterministic demo account, then run:

```bash
TRYOUTFLOW_LOCAL_DEMO_PASSWORD='<local demo password>' corepack npm run demo:local
TRYOUTFLOW_LOCAL_DEMO_PASSWORD='<local demo password>' corepack npm run test:visual
```

Comparison mode is the only mode used by the production-readiness controller. It must never modify tracked PNGs.

## Intentionally update a baseline

1. Run `npm run test:visual` without update mode and inspect every failed screenshot and diff.
2. Confirm each change matches the approved design and contains synthetic data only.
3. Run `npm run test:visual:update` intentionally with the local demo password available.
4. Review every staged PNG diff; reject unexpected copy, data, layout, or browser artifacts.
5. Re-run `npm run test:visual` twice before committing the new baseline.

Do not mask unstable product content. Stabilize the fixture or the rendering source instead. Never accept a baseline from a retry, a skipped scenario, or an environment with production data.
