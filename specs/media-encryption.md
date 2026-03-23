# Spec: Media Encryption

## Goal
Sensitive game configs (questions, answers) are encrypted in the git repository using git-crypt so they are not exposed in the commit history or to collaborators without the key.

## Acceptance criteria
- [x] `config.json` is encrypted with git-crypt and appears as binary in the repo to unauthorised readers
- [x] `games/*.json` files are encrypted (excluding templates)
- [x] Template files (`games/_template-*.json`) are NOT encrypted — they must be readable without the key
- [x] `config.template.json` is NOT encrypted
- [x] `npm run media:encrypt` triggers git-crypt lock (encrypts tracked files)
- [x] `npm run media:decrypt` triggers git-crypt unlock with the key (decrypts for local use)
- [x] The app works normally when git-crypt is unlocked (files are transparently decrypted)
- [x] `.gitattributes` defines which files are managed by git-crypt

## State / data changes
- No runtime state changes
- Files: `media-crypt.ts`, `.gitattributes`
- Scripts: `npm run media:encrypt`, `npm run media:decrypt`

## UI behaviour
- No browser UI; CLI scripts only
- Error if git-crypt is not installed or key is unavailable

## Out of scope
- Encrypting media files (audio, images) — only JSON configs are encrypted
- Key rotation
- Per-collaborator access control
