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
4. Run `npm run check` after JavaScript changes. A new test is picked up when it is named `scripts/test-*.mjs`; `npm run check` runs those files on its own.
5. Run `npm run build:web` and `npm run ios:sync` after changes that affect the iPhone app.
6. Review `git diff` and confirm that generated files contain no personal data or secrets.
7. Do not push to `main` without a successful check. Prefer a focused branch and pull request for non-trivial changes.
8. After raising `CACHE_VERSION` in `sw.js`, run `node scripts/check-references.mjs --write-cache-stamp`.

## 完了と見直し

`CLAUDE.md` の「完了と見直し」と同じ内容である。見どころは `REVIEW.md`。上の Required workflow と、下の食事登録の禁止事項・コミットメッセージの許可リストは、この節で弱めない。main へ直接置いてよい受け取り箱の既存の例外も残す。

1. 完了と言う前に `npm run check` を実際に実行する。画面や iPhone アプリに関係する変更では `npm run build:web` も実行する。iPhone アプリに影響する変更では、これまでどおり `npm run ios:sync` も実行する。成功か失敗か分かる出力を、報告と PR 本文に載せる。実行していないなら完了と言わない。
2. 変更のあと、PR を出す前に、Claude Code では `/code-review`（不具合探し）と `/security-review`（安全面の確認）を走らせる。このコマンドが使えない環境では、同じ観点で差分を自分で見直す。安全面の確認には、平文の健康記録、秘密鍵、接続コード全体、n8n の URL、トークンが差分やコミットメッセージに入っていないかを含める。
3. AI の見直しと修正の往復は3回まで。それでも直らないときは、同じ修正を続けず、やり方そのものを見直して、何が問題かを報告する。

`scripts/add-meal.mjs` での暗号化受け取り箱への食事追加（既定の登録）は、この見直しの対象外である。その完了の判断とコミットは、下の Food-recording automation に従う。

見直しで繰り返した指摘は `REVIEW.md` に足す。指摘にはファイルと行を添える。直すことがなければ、その旨を書く。

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

`.claude/skills/record-meal/SKILL.md` is the procedure for looking up a meal and sending it to the app. Do not add health advice unless the user asks for it.

The preferred workflow is the encrypted inbox:

1. For first-time setup, decode the connection code as base64url JSON and validate `version`, `deviceId`, and the RSA-OAEP-256 public JWK. Commit only that public device document to `codex-devices/<deviceId>.json`, then create `codex-inbox/<deviceId>.json` with `version`, `deviceId`, and an empty `entries` array. A public key is not a secret; never request or store the private key.
2. Research nutrition values from an official or otherwise reliable source and state any important assumptions. Do not add health advice unless the user asks for it.
3. Prepare the meal JSON outside the repository and pipe it to `node scripts/add-meal.mjs <deviceId>`. The device id is the only argument. The command checks the fields, types, and `YYYY-MM-DD` / `HH:MM` shape, encrypts with that device's public key, appends the envelope, and checks that `scripts/check-codex-inbox.mjs` passes and that the meal name and nutrient values are not stored in plaintext. It prints the commit message. It does not commit or push. If it fails, the inbox file is left unchanged. Never write the plaintext meal, shell history containing it, or a generated meal link into the repository. The command must not print the meal body.
4. Commit and push with the one line the command printed. After that envelope is on `main`, tell the user it was sent and to open the app. Do not claim it has been reflected locally until the user confirms it. The app deduplicates envelopes by ID.
5. Routine encrypted inbox updates may be committed directly to `main` after the command succeeds. Application code changes still require the normal checked branch and pull-request workflow. The commit message for an inbox or public-key change must be exactly one of these lines, with no dish name, nutrient value, or weight: `朝食を暗号化受け取り箱に追加`, `昼食を暗号化受け取り箱に追加`, `夕食を暗号化受け取り箱に追加`, `間食を暗号化受け取り箱に追加`, `暗号化受け取り箱の公開鍵を追加`, `暗号化受け取り箱の公開鍵を更新`, `暗号化受け取り箱を接続`.

n8n remains a compatibility path for a device that has no encrypted inbox. Claim that an n8n row was recorded only after the inserted row has been read back.

If the encrypted inbox is not configured, fall back to the app's one-tap meal-link format. Encode a validated meal JSON payload as UTF-8 base64url and append it to the deployed app URL as `#meal=<payload>`. Use a new random `importId` for each meal. Tell the user that tapping the link performs the local registration; do not claim the record is present until the user confirms it in the app. Never commit the generated link or its health data to the repository.
