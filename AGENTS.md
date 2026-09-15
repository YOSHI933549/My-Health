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
3. Never commit health records, exported backups, OAuth access tokens, n8n webhook URLs, secrets, or screenshots containing personal health data.
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

When n8n is unavailable, use the app's one-tap meal-link format instead. Encode a validated meal JSON payload as UTF-8 base64url and append it to the deployed app URL as `#meal=<payload>`. Use a new random `importId` for each meal. Tell the user that the link is ready and that tapping it performs the local registration; do not claim the record is present until the user confirms it in the app. Never commit the generated link or its health data to the repository.
