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

日付またぎ時は前日スナップショットを `localStorage['megusuri-history-v1']` に保存し、全 dose を `upcoming` に戻します。最終稼働日は `localStorage['megusuri-last-active-date']` です。旧版から初めて日次リセット対応版へ入る端末は、一度だけ `upcoming` へ移行し `localStorage['megusuri-daily-reset-migrated-v1']` を立てます（過去履歴は推測保存しません）。

音声通知の設定だけ、別キー `localStorage['megusuri-voice-settings-v1']` に保存します。

## PWA / 音声通知

- HTTPS 環境で Android Chrome の「ホーム画面に追加」に対応
- 新バージョン検知時は「更新する」バナーを表示。夜間 02:00〜04:00 かつ点眼が安全なときだけ自動更新・再読み込みする
- 画面常時表示（Wake Lock）に対応
- 未点眼時はタブレット自身が Web Speech API（`speechSynthesis` / `ja-JP`）で読み上げ
- 音声は画面表示中のみ動作します（バックグラウンドでは制約あり）
- 現在の再通知の初期プリセットは実機確認用の **テスト 1分 / 3分** です。確認後に設定で「運用 10分 / 30分」へ切り替えてください
