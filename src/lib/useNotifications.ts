import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
};

export function useNotifications(staffId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    if (!staffId) return;

    // authユーザーからprofileIdを取得
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", authUser.id)
      .single();

    if (!profile) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("staff_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("notifications fetch error:", error);
      return;
    }

    const list = (data || []) as Notification[];
    setNotifications(list);
    setUnreadCount(list.filter(n => !n.is_read).length);
  }, [staffId]);

  const markAllRead = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", authUser.id)
      .single();
    if (!profile) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("staff_id", profile.id)
      .eq("is_read", false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const markOneRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  useEffect(() => {
    if (!staffId) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [staffId, fetchNotifications]);

  return { notifications, unreadCount, markAllRead, markOneRead, refetch: fetchNotifications };
}