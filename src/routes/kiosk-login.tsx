import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { Loader2, Tablet } from "lucide-react";

export const Route = createFileRoute("/kiosk-login")({
  head: () => ({ meta: [{ title: "キオスクログイン — DishBoard" }] }),
  component: KioskLoginPage,
});

function KioskLoginPage() {
  const { login, logout, user } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.role === "kiosk") navigate({ to: "/kiosk" });
  }, [user]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(loginId, password);
      const { user: freshUser } = await new Promise<{ user: typeof user }>((resolve) => {
        setTimeout(() => resolve({ user }), 100);
      });
      if (freshUser && freshUser.role !== "kiosk") {
        await logout();
        setError("このアカウントはキオスク専用ではありません。スタッフ用ログイン画面をご利用ください。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインできませんでした");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-warm flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-3xl bg-gradient-primary shadow-elevated flex items-center justify-center mb-4">
            <Tablet className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            DishBoard <span className="text-primary">キオスク</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">出退勤打刻専用端末</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 bg-surface rounded-3xl shadow-card p-6 border border-border">
          <div>
            <label className="text-xs font-semibold text-foreground/80 mb-1.5 block">ログインID</label>
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="キオスク用ログインID"
              autoComplete="username"
              className="w-full bg-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground/80 mb-1.5 block">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full bg-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !loginId || !password}
            className="w-full bg-gradient-primary text-primary-foreground rounded-xl py-3.5 font-semibold text-sm shadow-elevated active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            キオスクにログイン
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          スタッフの方は{" "}
          <a href="/login" className="text-primary underline underline-offset-2">
            こちら
          </a>
        </p>
      </div>
    </div>
  );
}
