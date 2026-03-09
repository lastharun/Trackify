# Trackify

Chrome extension + local backend + worker + desktop control center for product and text tracking.

## Main parts

- `extension/`: Chrome extension
- `backend/`: local API and sync logic
- `workers/`: background product processor
- `registry/`: central device registry and admin panel
- `desktop/`: Electron desktop shell

## Local development

```bash
npm install
npm run dev:backend
npm run dev:worker
```

Registry:

```bash
npm run dev:registry
```

Desktop shell:

```bash
npm run desktop
```

## Desktop builds

macOS:

```bash
npm run dist:desktop:mac
```

Windows installer:

```bash
npm run dist:desktop:win
```

## Extension update package

```bash
npm run build:extension-update
```

This generates:

- `registry/public/downloads/Trackify-Extension-*.zip`
- `registry/public/updates/extension.json`

## Notes

- Do not commit `.env` files or local SQLite databases.
- Registry secrets must stay in server-side env files.
