# 鉛筆テクスチャ(紙とペン風テーマ)

`css/style.css` の紙とペン風テーマで使う、鉛筆で描いた線・塗り・紙の画像です。
手描きの見た目を CSS のグラデーションで真似るのではなく、紙の凹凸(紙の目)に
芯の粉が乗る様子を計算して画像にしてあります。線の中に紙の白い粒が残るのはそのためです。

画像はすべて `scripts/pencil-textures/gen.mjs` で作ったもので、手で編集はしていません。
iPhone の画面に合わせて CSS の 3 倍(紙は 2 倍、力こぶは 4 倍)の解像度で作っています。

## 部品と使い道

| ファイル | 使い道 |
| --- | --- |
| `frame-graphite.png` / `frame-terra.png` / `frame-red.png` | ボタンの二重線の枠(`border-image`、12px で 9 分割)。黒鉛・テラコッタ(主ボタンと選択中)・赤(危険な操作) |
| `frame-thin.png` | ファイル選択ボタンの細い枠 |
| `hatch.png` / `hatch-dense.png` | 色鉛筆の斜線。マスクにして `background-color` で色を付ける(カレンダー・部位の札・リング)。`hatch.png` はグラフの塗りにも使う |
| `ring.png` | 栄養リングの鉛筆の二重丸 |
| `loop.png` / `loop-wide.png` | 選んだ日付・区分タグを鉛筆でぐるっと囲む丸(マスク) |
| `cross.png` | 削除ボタンの赤鉛筆のバツ(マスク) |
| `swoosh-a.png` / `swoosh-b.png` | 見出しの下線(3 分割の `border-image`、右端が少し跳ねる) |
| `swoosh-terra.png` | 選択中のタブと今日の日付の短い下線 |
| `rule.png` / `rule-terra.png` | 入力欄の記入線(フォーカス中はテラコッタ)と一覧の区切り線 |
| `wave.png` | 区切りの波線 |
| `torn.png` / `torn-shadow.png` | 下のタブバーのちぎったノートの縁とその影 |
| `desk.webp` / `napkin.webp` / `notebook.webp` / `tint-terra.webp` | 机・カード・ノート・主ボタンの塗りの紙(継ぎ目なしで敷き詰める) |
| `mascot.png` | 見出しの力こぶの落書き(`index.html`) |
| `grain.png` | グラフの線と塗りを紙の目で少しかすれさせる消しゴム(`js/app.js`) |

## 作り直すとき

1. `scripts/pencil-textures/assets.js` の部品の太さ・濃さ・色などを変える
   (`lib.js` は鉛筆の描き方そのもの)。
2. Playwright を用意して実行する(リポジトリの依存には入れていません)。

   ```bash
   npm install --no-save playwright
   npx playwright install chromium   # Chromium が無いときだけ
   node scripts/pencil-textures/gen.mjs              # 全部
   node scripts/pencil-textures/gen.mjs css/tex rule # rule.png だけ
   ```

   手元の Chromium を使うときは `CHROMIUM_PATH=/path/to/chrome` を付けます。
   乱数の種は部品ごとに固定なので、何も変えなければ同じ画像がもう一度できます。
3. **`sw.js` の `CACHE_VERSION` を上げる。** この画像はアイコンと同じく
   キャッシュ優先で配っているので、上げないと古い画像を使い続ける端末が出ます。
