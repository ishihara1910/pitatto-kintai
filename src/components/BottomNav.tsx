import { Link, useLocation } from "@tanstack/react-router";
import { Receipt, CalendarDays, Clock, Home, ShoppingCart, type LucideIcon } from "lucide-react";
import { useAuth, type Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const ITEMS: NavItem[] = [
  { to: "/salary",    label: "ホーム",        icon: Home,         roles: ["part_time"] },
  { to: "/dashboard", label: "ホーム",        icon: Home,         roles: ["full_time", "manager", "admin"] },
  { to: "/dashboard", label: "ホーム",        icon: Home,         roles: ["owner"] },
  { to: "/shifts",    label: "シフトボード",  icon: CalendarDays, roles: ["part_time", "full_time", "manager", "owner", "admin"] },
  { to: "/clock",     label: "打刻",          icon: Clock,        roles: ["full_time", "manager"] },
  { to: "/expenses",  label: "経費",          icon: Receipt,      roles: ["full_time", "manager", "owner", "admin"] },
  { to: "/order",     label: "発注",          icon: ShoppingCart, roles: ["full_time", "manager", "admin"] },
];

export function BottomNav() {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return null;

  const visible = ITEMS.filter((i) => {
    if (!i.roles.includes(user.role)) return false;
    if (i.to === "/clock" && user.kioskEnabled) return false;
    return true;
  });

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/95 backdrop-blur-lg safe-bottom">
      <div className="mx-auto max-w-md grid" style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}>
        {visible.map((item) => {
          const active = loc.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={`${item.to}-${item.roles[0]}`}
              to={item.to}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <div className={cn("p-1.5 rounded-xl transition-all", active && "bg-accent")}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}