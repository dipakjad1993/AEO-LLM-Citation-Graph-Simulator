# lib/ — REMOVED vendored bundles (2026-09 enterprise cleanup)

Vendored `vis-network` / `tom-select` / `bindings` bundles were deleted (~750 KB dead
weight, security + Docker-cache risk). Canonical sources are npm packages
(`vis-network@^9.1.2`, `tom-select@^2.3.1` in `package.json`) via `node_modules`
or pinned CDN. `src/dashboard/index.html` does not reference `lib/` — verified.

This directory retains only this README as a pointer. Do not re-vendor bundles here.
