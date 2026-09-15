# Codex project instructions

## Purpose

This repository contains the owner's personal health-support application. It tracks meals, weight, workouts, and rule-based trends. Preserve the user's records and keep the interface simple enough to operate on an iPhone without technical knowledge.

## Source of truth

- The editable web source stays at the repository root: `index.html`, `css/`, `js/`, `icons/`, `manifest.json`, and `sw.js`.
- `www/` and `ios/App/App/public/` are generated copies. Never edit them directly.
- The iPhone container is configured by `capacitor.config.json` and the generated `ios/` Xcode project.
- GitHub Pages continues to deploy the root web source from `main`.

## Required workflow

1. Read `README.md` and the files related to the requested feature before editing.
2. Preserve existing localStorage data formats unless a backward-compatible migration is included.
3. Never commit plaintext health records, exported backups, OAuth access tokens, n8n webhook URLs, secrets, private keys, or screenshots containing personal health data. The encrypted Codex inbox described below is the only health-record exception: commit only its hybrid-encrypted envelopes.
4. Run `npm run check` after JavaScript changes.
5. Run `npm run build:web` and `npm run ios:sync` after changes that affect the iPhone app.
6. Review `git diff` and confirm that generated files contain no personal data or secrets.
7. Do not push to `main` without a successful check. Prefer a focused branch and pull request for non-trivial changes.

## Health and safety rules

- Treat all analysis shown by the app as rule-based guidance, not diagnosis or medical advice.
- Do not silently change nutrition formulas, thresholds, or target calculations. Explain the proposed change and its effect first.
- Do not delete, reset, overwrite, or migrate user records without an exportable backup and explicit confirmation.
- When sync conflicts are possible, preserve both versions or stop and ask rather than choosing data to discard.

## Product constraints

- Primary device: the owner's iPhone. Keep controls touch-friendly and Japanese copy plain and concise.
- The app must remain usable without Google Drive or n8n configured.
- The existing browser version must keep working while the iPhone version is developed.
- Avoid unnecessary frameworks and large dependencies.

## Food-recording automation

The existing `.claude/skills/record-meal/SKILL.md` documents the previous Claude workflow. Use it only as product history. Do not claim that a meal was recorded unless the required n8n connection is available and the inserted row has been read back successfully.

The preferred Codex workflow is the encrypted inbox:

1. For first-time setup, decode the connection code as base64url JSON and validate `version`, `deviceId`, and the RSA-OAEP-256 public JWK. Commit only that public device document to `codex-devices/<deviceId>.json`, then create `codex-inbox/<deviceId>.json` with `version`, `deviceId`, and an empty `entries` array. A public key is not a secret; never request or store the private key.
2. Research nutrition values from an official or otherwise reliable source and state any important assumptions. Do not add health advice unless the user asks for it.
3. Prepare the validated meal JSON outside the repository and pipe it into `node scripts/encrypt-meal.mjs codex-devices/<deviceId>.json`. Append only the resulting envelope to that device's inbox. Never write the plaintext meal, shell history containing it, or a generated meal link into the repository.
4. After the encrypted envelope is present on `main`, tell the user it was sent and to open the app. Do not claim it has been reflected locally until the user confirms it. The app deduplicates envelopes by ID.
5. Routine encrypted inbox updates may be committed directly to `main` after validating the JSON and confirming the diff contains ciphertext only. Application code changes still require the normal checked branch and pull-request workflow.

If the encrypted inbox is not configured, fall back to the app's one-tap meal-link format. Encode a validated meal JSON payload as UTF-8 base64url and append it to the deployed app URL as `#meal=<payload>`. Use a new random `importId` for each meal. Tell the user that tapping the link performs the local registration; do not claim the record is present until the user confirms it in the app. Never commit the generated link or its health data to the repository.
