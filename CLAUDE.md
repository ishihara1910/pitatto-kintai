# ピタッと勤怠 (pitatto-kintai)

店舗設置キオスク端末専用の打刻（clock-in/out）アプリ。`dishboard-mobile-pro`のkiosk機能を切り出して独立させたプロジェクト（コミット履歴は`dishboard-kiosk`として開始）。TanStack Start + Supabase。Cloudflare Workers / Vercel 両方の設定があるが、どちらが実際に稼働中か要確認。

## 現状（2026-08時点）

早期プロトタイプ。画面は`/kiosk-login`と`/kiosk`の2つのみ。`AppShell.tsx`/`BottomNav.tsx`/`useNotifications.ts`は`dishboard-mobile-pro`から引き継いだ未使用の残骸。

## データ

`../restro-radar-plus`と同一Supabaseプロジェクト（ref: `xvomywhxiiexfnkgipal`）を共有。参照テーブル: `staff_members`, `attendance_logs`, `stores`。認証は`kiosk`ロール専用（他ロールは`/kiosk-login`で拒否される）。

## 注意点

- `wrangler.jsonc`の`name`が`"tanstack-start-app"`のまま（リネームし忘れ）
- `.gitignore`の`.env`行は過去に文字コード破損（NULバイト混入）していた。2026-08-11に修正済み。今後PowerShellで`.gitignore`を編集する際は`-Encoding utf8`を明示すること
- `supabase/functions/generate-shift-report`はコードは存在するがフロントから呼び出すUIがまだ無い
