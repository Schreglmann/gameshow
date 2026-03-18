# Spec: NAS Asset Mount

## Goal
A developer utility creates symlinks from the project root to asset folders on a mounted NAS volume, so media files can be served without copying them locally.

## Acceptance criteria
- [ ] `mount` command creates symlinks in the project root pointing to the NAS source for each of the 5 asset folders: `audio`, `audio-guess`, `images`, `image-guess`, `background-music`
- [ ] NAS source path is `/Volumes/Georg-1/Gameshow/Assets/`
- [ ] Script exits with a clear error if the NAS volume is not reachable (source path does not exist)
- [ ] Folders already symlinked are skipped with a status message
- [ ] If a real (non-symlink) directory exists at the target, the script warns and skips it — unless `--force` is passed, in which case it renames it to `<name>.bak` before creating the symlink
- [ ] `unmount` command removes each symlink; real directories and `.bak` folders are left untouched
- [ ] Run via: `npm run mount-assets` / `npm run unmount-assets`

## State / data changes
- No application state changes — operates only on filesystem symlinks in the project root
- Creates symlinks: `./audio → /Volumes/Georg-1/Gameshow/Assets/audio` (and equivalent for each folder)

## UI behaviour
- CLI only (`mount-assets.ts`)
- Prints per-folder status: `✓ mounted`, `→ already mounted`, `⚠ skipped (real directory — use --force)`, `✓ unmounted`, `– not a symlink, skipped`
- Prints a summary at the end

## Out of scope
- Automounting on system startup
- Mounting subfolders within each asset folder individually
- Integration with the Express server or Vite config
