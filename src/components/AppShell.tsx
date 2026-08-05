import { ReactNode } from "react";
import { useAuth, type Role } from "@/lib/auth";
import { Navigate, useNavigate, useLocation } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";
import { useNotifications } from "@/lib/useNotifications";

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  allowed?: Role[];
  action?: ReactNode;
}

const ROLE_LABEL: Record<Role, string> = {
  part_time: "アルバイト",
  full_time: "正社員",
  manager: "店長",
  owner: "オーナー",
  admin: "管理者",
  kiosk: "出退勤",
};

export function AppShell({ children, title, subtitle, allowed, action }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const { unreadCount } = useNotifications(user?.id);

  if (!user) return <Navigate to="/login" />;
  if (allowed && !allowed.includes(user.role)) return <Navigate to="/" />;

  if (loc.pathname === "/clock" && user.kioskEnabled) return <Navigate to="/" />;

  const handleNotificationClick = () => {
    if (loc.pathname === "/notifications") {
      window.history.back();
    } else {
      navigate({ to: "/notifications" });
    }
  };

  const handleSettingsClick = () => {
    if (loc.pathname === "/settings") {
      window.history.back();
    } else {
      navigate({ to: "/settings" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur-lg border-b border-border">
        <div className="mx-auto max-w-md px-4 pt-3 pb-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate text-foreground">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {action}
            <button
              onClick={handleNotificationClick}
              className={`relative p-2 rounded-xl transition-colors ${
                loc.pathname === "/notifications"
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={handleSettingsClick}
              className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full transition-colors ${
                loc.pathname === "/settings"
                  ? "bg-primary/10 text-primary"
                  : "bg-accent text-accent-foreground hover:bg-accent/80"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-xs font-medium max-w-[60px] truncate">{user.name}</span>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md w-full flex-1 px-4 pt-4 pb-28">{children}</main>
    </div>
  );
}