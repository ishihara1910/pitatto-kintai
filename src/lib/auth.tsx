import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { supabase } from "./supabase";

export type Role = "part_time" | "full_time" | "manager" | "owner" | "admin" | "kiosk";

export interface User {
  id: string;
  name: string;
  role: Role;
  storeId: string;
  storeName: string;
  hourlyWage: number;
  enterpriseId: string;
  kioskEnabled: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (loginId: string, password: string) => Promise<User | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTO_LOGOUT_MS = 30 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = () => {
    if (user?.role === 'kiosk') return; // kiosk は自動ログアウトしない
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { logout(); }, AUTO_LOGOUT_MS);
  };

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handleActivity = () => { if (user && user.role !== 'kiosk') resetTimer(); };
    events.forEach(e => window.addEventListener(e, handleActivity));
    return () => events.forEach(e => window.removeEventListener(e, handleActivity));
  }, [user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        localStorage.setItem("tab_hidden_at", Date.now().toString());
      } else if (document.visibilityState === "visible") {
        const hiddenAt = localStorage.getItem("tab_hidden_at");
        if (hiddenAt) {
          const elapsed = Date.now() - parseInt(hiddenAt);
          if (elapsed > AUTO_LOGOUT_MS && user?.role !== 'kiosk') logout();
          localStorage.removeItem("tab_hidden_at");
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) fetchUserProfile(session.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) fetchUserProfile(session.user.id);
      else { setUser(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) resetTimer();
    else if (timerRef.current) clearTimeout(timerRef.current);
  }, [user]);

  const fetchUserProfile = async (authUserId: string): Promise<User | null> => {
    let { data: staff, error: staffError } = await supabase
      .from("staff_members")
      .select("id, name, role, store_id, hourly_rate, enterprise_id, auth_user_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (staffError) console.error("fetchUserProfile (auth_user_id検索) error:", staffError);

    if (!staff) {
      const { data: staffByUserId, error: staffByUserIdError } = await supabase
        .from("staff_members")
        .select("id, name, role, store_id, hourly_rate, enterprise_id, auth_user_id")
        .eq("user_id", authUserId)
        .maybeSingle();
      if (staffByUserIdError) console.error("fetchUserProfile (user_id検索) error:", staffByUserIdError);
      staff = staffByUserId;

      // auth_user_idが未設定の場合は自動更新
      if (staff && !staff.auth_user_id) {
        await supabase
          .from("staff_members")
          .update({ auth_user_id: authUserId })
          .eq("id", staff.id);
      }
    }

    if (!staff) {
      setUser(null);
      setLoading(false);
      return null;
    }

    let storeName = "";
    let kioskEnabled = false;

    if (staff.store_id) {
      const { data: store } = await supabase
        .from("stores")
        .select("name, kiosk_enabled")
        .eq("id", staff.store_id)
        .maybeSingle();
      storeName = store?.name ?? "";
      kioskEnabled = store?.kiosk_enabled ?? false;
    }

    const nextUser: User = {
      id: staff.id,
      name: staff.name,
      role: staff.role as Role,
      storeId: staff.store_id ?? "",
      storeName,
      hourlyWage: staff.hourly_rate ?? 0,
      enterpriseId: staff.enterprise_id ?? "",
      kioskEnabled,
    };
    setUser(nextUser);
    setLoading(false);
    return nextUser;
  };

  const login = async (loginId: string, password: string): Promise<User | null> => {
    const { data, error } = await supabase.functions.invoke("staff-login", {
      body: { login_id: loginId, password },
    });

    if (error || data?.error) {
      const serverMsg = (error as any)?.context?.error || data?.error;
      throw new Error(serverMsg || "IDまたはパスワードが正しくありません");
    }

    if (data?.session) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) throw new Error("セッション設定に失敗しました");
      const authUserId = data.session.user?.id;
      if (authUserId) return fetchUserProfile(authUserId);
    }
    // リダイレクトは各ページのuseEffectに任せる
    return null;
  };

  const logout = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await supabase.auth.signOut();
    setUser(null);
    setLoading(false);
    window.location.href = "/kiosk-login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function canAccess(role: Role | undefined, allowed: Role[]) {
  return !!role && allowed.includes(role);
}