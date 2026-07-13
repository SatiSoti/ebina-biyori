# ランドマーク画像

公開地図のランドマーク画像を、1地点1ファイルで保存するフォルダです。

- 対応形式：SVG、PNG、WebP
- ファイル名：半角英小文字・数字・ハイフン
- 推奨比率：横80：縦64（例：800×640px）
- 背景：透明を推奨

同じファイル名で差し替える場合、コードやSupabaseの変更は不要です。拡張子やファイル名を変える場合は、`city-landmarks-data.js` とSupabaseの `city_landmarks.image_path` も変更します。

全素材の確認には、1階層上の `landmark-assets.html` を開きます。
