# YOSHI Health Tracker — Claude Code instructions

このリポジトリはユーザー本人の健康記録アプリです。Claude Codeで食事を登録するときは、
Codexと共通の暗号化受け取り箱を使うこと。

## 食事登録

1. `codex-devices/<deviceId>.json` の公開鍵を使う。接続コードを受け取った場合はbase64url
   JSONを読み取り、`version`、`deviceId`、`publicKey`だけを保存する。秘密鍵は要求・保存しない。
2. JSTの日付・時刻と、検証済みの `date`、`time`、`type`、`name`、`calories`、`protein`、
   `fat`、`carbs`、`memo` を用意する。
3. 平文JSONをリポジトリへ保存せず、次のコマンドへ標準入力で渡す。

```bash
node scripts/encrypt-meal.mjs codex-devices/<deviceId>.json < meal.json
```

4. 出力された暗号化エンベロープだけを、対応する `codex-inbox/<deviceId>.json` の
   `entries` 配列へ追加する。差分に食事名や栄養値が含まれていないことを確認する。
5. JSONを検証し、変更をコミット・プッシュしたあと、ユーザーには「アプリを開いて確認」と伝える。
   アプリ側で確認されるまで、反映済みとは断定しない。

## 禁止事項

- 秘密鍵、接続コード全体、n8n URL・トークン、平文の健康記録をコミットしない。
- `localStorage`の内容やユーザーの健康記録をリセットしない。
- 既存の `codex-*` ファイル名は互換性のため変更しない。Codex専用という意味ではなく、
  CodexとClaude Codeが共有する受け取り箱である。

従来のn8n食事連携は古い端末用の互換経路として残す。新規登録では暗号化受け取り箱を優先する。
