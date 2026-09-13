# lib/ — vendored frontend assets (DEPRECATED, kept for offline fallback)

These bundles are superseded by npm packages (see `package.json`:
`vis-network@^9.1.2`, `tom-select@^2.3.1`). New dashboard work must
`import` from `node_modules` or a pinned CDN — do not add new files here.

Kept (not deleted) so `src/dashboard/index.html` renders fully offline on
existing installs. Run `npm install` then migrate the `<script>` tags, then
delete this directory.
