# 目薬みまもり

家族で共有する点眼確認用の PWA です。Android タブレットにホーム画面追加し、画面を付けたまま常設利用することを想定しています。

公開中の ChatGPT サイト版をローカルで保守できる正本として復元したものです。既存の映画 LP（`nokosu-film-lp`）や `eyedrop-checker` とは別プロジェクトです。

## ローカル起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173/` を開きます。

タブレットから同じ Wi-Fi で確認する場合は、表示された Network URL（例: `http://192.168.x.x:5173/`）を使います。タブレットでは `localhost` は使えません。

## ビルド

```bash
npm run build
npm run preview
```

- Build command: `npm run build`
- Output directory: `dist`

## データの互換性

点眼データは `localStorage['megusuri-medicines-v2']` に保存します。公開版と同じ配列形式を維持しており、未知フィールドは削除しません。

日付またぎ時は前日スナップショットを `localStorage['megusuri-history-v1']` に保存し、全 dose を `upcoming` に戻します。最終稼働日は `localStorage['megusuri-last-active-date']` です。

音声通知の設定だけ、別キー `localStorage['megusuri-voice-settings-v1']` に保存します。

## PWA / 音声通知

- HTTPS 環境で Android Chrome の「ホーム画面に追加」に対応
- 新バージョン検知時は「更新する」バナーを表示（自動では強制リロードしない）
- 画面常時表示（Wake Lock）に対応
- 未点眼時はタブレット自身が Web Speech API（`speechSynthesis` / `ja-JP`）で読み上げ
- 音声は画面表示中のみ動作します（バックグラウンドでは制約あり）
- 現在の再通知間隔の初期値はテスト用の **1分** です。実機確認後に 10分へ変更します
