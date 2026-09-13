import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { LogIn, LogOut, ChevronLeft, Users, Coffee, ArrowUpDown, GripVertical, Check, HeartHandshake, Building2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/kiosk")({
  head: () => ({ meta: [{ title: "出退勤 — ピタッと勤怠" }] }),
  component: KioskPage,
});

interface StaffMember {
  id: string;
  name: string;
  role: string;
  hourly_rate: number;
  wage_type: string | null;
  daily_rate: number | null;
  sort_order: number | null;
}

interface HelpStore {
  id: string;
  name: string;
}

interface AttendanceLog {
  id: string;
  date?: string;
  clock_in: string | null;
  clock_out: string | null;
  actual_cost: number | null;
  break_start: string | null;
  break_end: string | null;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function breakMinsBetween(breakStart?: string | null, breakEnd?: string | null): number {
  if (!breakStart || !breakEnd) return 0;
  const bsMins = timeToMins(breakStart);
  let beMins = timeToMins(breakEnd);
  if (beMins < bsMins) beMins += 24 * 60;
  return Math.max(0, beMins - bsMins);
}

// 残業（1日8時間超、+25%）・深夜（22-翌5時、+25%）の割増賃金（重複部分は+50%）。
// 雇用形態を問わずすべての時給制スタッフに労働基準法上適用されるためロールによる区別はしない。
// priorWeeklyNormalMinutes: 同じ週（日曜起算）のこの日より前の日の「日8時間以内」時間の合計（分）。
// 積み上げが週40時間を超えた分も同様に残業として扱う（省略時は週次判定なし＝従来の日次のみ）
// 日給制（wageType==='daily'）は出勤した日は実働時間に関わらずdailyRateを固定で計上する
function calcCost(
  clockIn: string, clockOut: string, hourlyRate: number,
  breakStart?: string | null, breakEnd?: string | null, priorWeeklyNormalMinutes: number = 0,
  wageType?: string | null, dailyRate?: number | null,
) {
  if (wageType === "daily") return dailyRate ?? 0;

  const startMins = timeToMins(clockIn);
  let endMins = timeToMins(clockOut);
  if (endMins <= startMins) endMins += 24 * 60;

  const breakMins = breakMinsBetween(breakStart, breakEnd);
  const workMins = endMins - startMins - breakMins;

  const DAILY_OT_THRESHOLD = 8 * 60;
  const WEEKLY_OT_THRESHOLD = 40 * 60;
  const LATE_START = 22 * 60;

  let effectiveMins = 0;
  let weeklyAccum = priorWeeklyNormalMinutes;
  for (let elapsed = 0; elapsed < workMins; elapsed++) {
    const normalizedMin = (startMins + elapsed) % (24 * 60);
    const isLate = normalizedMin >= LATE_START || normalizedMin < 5 * 60;
    const isDailyOvertime = elapsed >= DAILY_OT_THRESHOLD;

    let isOvertime: boolean;
    if (isDailyOvertime) {
      isOvertime = true;
    } else {
      weeklyAccum += 1;
      isOvertime = weeklyAccum > WEEKLY_OT_THRESHOLD;
    }

    if (isOvertime && isLate) effectiveMins += 1.5;
    else if (isOvertime) effectiveMins += 1.25;
    else if (isLate) effectiveMins += 1.25;
    else effectiveMins += 1.0;
  }

  return Math.round((effectiveMins / 60) * hourlyRate);
}

// 日8時間以内の「通常」扱い分の実働時間（分）。週40時間判定の積み上げに使う
function dailyNormalMinutes(clockIn: string, clockOut: string, breakStart?: string | null, breakEnd?: string | null): number {
  const startMins = timeToMins(clockIn);
  let endMins = timeToMins(clockOut);
  if (endMins <= startMins) endMins += 24 * 60;
  const workMins = Math.max(0, endMins - startMins - breakMinsBetween(breakStart, breakEnd));
  return Math.min(workMins, 8 * 60);
}

// dateを含む週（日曜起算）の日曜日の日付文字列（YYYY-MM-DD）を返す
function sundayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return toDateStr(d);
}

function KioskPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffTodayLogs, setStaffTodayLogs] = useState<Record<string, { clock_in: string; clock_out: string | null; break_start: string | null; break_end: string | null }>>({});
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [todayLog, setTodayLog] = useState<AttendanceLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [showStaffList, setShowStaffList] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  /* ─ ヘルプ(応援)出勤 ─ */
  const [showHelpStoreList, setShowHelpStoreList] = useState(false);
  const [showHelpStaffList, setShowHelpStaffList] = useState(false);
  const [helpStores, setHelpStores] = useState<HelpStore[]>([]);
  const [helpStaffList, setHelpStaffList] = useState<StaffMember[]>([]);
  const [selectedHelpStore, setSelectedHelpStore] = useState<HelpStore | null>(null);
  const [loadingHelp, setLoadingHelp] = useState(false);
  const [helpBadge, setHelpBadge] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== 'kiosk') {
      navigate({ to: '/kiosk-login' });
    }
  }, [user, navigate]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadStaffAndLogs = async () => {
    if (!user?.storeId) return;
    const today = toDateStr(new Date());
    try {
      const [{ data: members }, { data: logs }] = await Promise.all([
        supabase.from("staff_members").select("id, name, role, hourly_rate, wage_type, daily_rate, sort_order")
          .eq("store_id", user.storeId).eq("status", "active")
          .not("role", "in", '("admin","owner","kiosk")')
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("name"),
        supabase.from("attendance_logs").select("staff_id, clock_in, clock_out, break_start, break_end")
          .eq("store_id", user.storeId).eq("date", today),
      ]);
      setStaffList((members || []) as StaffMember[]);
      const logMap: Record<string, { clock_in: string; clock_out: string | null; break_start: string | null; break_end: string | null }> = {};
      for (const log of logs || []) {
        if (log.clock_in) logMap[log.staff_id] = { clock_in: log.clock_in, clock_out: log.clock_out, break_start: log.break_start, break_end: log.break_end };
      }
      setStaffTodayLogs(logMap);
    } catch {
      toast.error('スタッフ情報の読み込みに失敗しました');
    }
  };

  useEffect(() => {
    loadStaffAndLogs();
  }, [user?.storeId]);

  // 長押し(250ms)してからドラッグ開始とする。スクロール操作と誤反応しないようにするため
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = staffList.findIndex(s => s.id === active.id);
    const newIndex = staffList.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(staffList, oldIndex, newIndex);
    setStaffList(reordered);
    setSavingOrder(true);
    try {
      await Promise.all(
        reordered.map((s, idx) =>
          supabase.from("staff_members").update({ sort_order: idx + 1 }).eq("id", s.id)
        )
      );
    } catch {
      toast.error("並び順の保存に失敗しました");
    } finally {
      setSavingOrder(false);
    }
  };

  const selectStaff = async (staff: StaffMember, helpStoreName?: string) => {
    setSelectedStaff(staff);
    setHelpBadge(helpStoreName ?? null);
    setShowStaffList(false);
    setShowHelpStoreList(false);
    setShowHelpStaffList(false);
    setLoading(true);
    const today = toDateStr(new Date());
    const { data } = await supabase
      .from("attendance_logs")
      .select("id, clock_in, clock_out, actual_cost, break_start, break_end")
      .eq("staff_id", staff.id)
      .eq("date", today)
      .maybeSingle();
    setTodayLog(data || null);
    setLoading(false);
  };

  // ヘルプ(応援)出勤:同じ企業内の他店舗一覧を表示する
  const openHelpStoreList = async () => {
    if (!user?.enterpriseId) return;
    setLoadingHelp(true);
    setShowHelpStoreList(true);
    try {
      const { data } = await supabase
        .from("stores")
        .select("id, name")
        .eq("enterprise_id", user.enterpriseId)
        .neq("id", user.storeId)
        .order("name");
      setHelpStores((data || []) as HelpStore[]);
    } catch {
      toast.error("店舗一覧の読み込みに失敗しました");
    } finally {
      setLoadingHelp(false);
    }
  };

  // ヘルプ(応援)出勤:選択した店舗の従業員一覧を表示する
  const openHelpStaffList = async (store: HelpStore) => {
    setSelectedHelpStore(store);
    setLoadingHelp(true);
    setShowHelpStaffList(true);
    try {
      const { data: members } = await supabase
        .from("staff_members")
        .select("id, name, role, hourly_rate, wage_type, daily_rate, sort_order")
        .eq("store_id", store.id).eq("status", "active")
        .not("role", "in", '("admin","owner","kiosk")')
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("name");
      setHelpStaffList((members || []) as StaffMember[]);
    } catch {
      toast.error("スタッフ情報の読み込みに失敗しました");
    } finally {
      setLoadingHelp(false);
    }
  };

  // 打刻時刻は端末側の時計ではなく、record_punch() RPC内のサーバーnow()を正とする
  // （端末の時計を変更した打刻の偽装を防ぐため。restro-radar-plus側の自己打刻画面と共通の仕組み）
  const punch = async (action: "in" | "out" | "break_start" | "break_end") => {
    if (!selectedStaff || !user) return;

    if (action === "in") {
      const { data, error } = await supabase.rpc("record_punch", {
        p_staff_id: selectedStaff.id,
        p_staff_name: selectedStaff.name,
        p_store_id: user.storeId,
        p_hourly_rate: selectedStaff.hourly_rate,
        p_action: "in",
      });

      if (error || !data) { console.error("出勤打刻 error:", error); toast.error(`出勤打刻に失敗しました: ${error?.message ?? ""}`); return; }
      const row = data as unknown as AttendanceLog;
      toast.success(`${selectedStaff.name}さん ${row.clock_in} 出勤しました`);
      setTodayLog(row);
      setTimeout(() => {
        setSelectedStaff(null);
        setTodayLog(null);
        setHelpBadge(null);
        loadStaffAndLogs();
      }, 3000);

    } else if (action === "break_start") {
      if (!todayLog) return;
      // 既に休憩記録がある場合は上書きしない（2回目以降の休憩は記録しない旨を通知）
      if (todayLog.break_start) {
        toast.info("本日の休憩は既に記録済みです");
        return;
      }
      const { data, error } = await supabase.rpc("record_punch", {
        p_staff_id: selectedStaff.id,
        p_staff_name: selectedStaff.name,
        p_store_id: user.storeId,
        p_hourly_rate: selectedStaff.hourly_rate,
        p_action: "break_start",
      });

      if (error || !data) { toast.error(`休憩打刻に失敗しました: ${error?.message ?? ""}`); return; }
      const row = data as unknown as AttendanceLog;
      toast.success(`${selectedStaff.name}さん ${row.break_start} 休憩開始`);
      setTodayLog(row);
      setTimeout(() => {
        setSelectedStaff(null);
        setTodayLog(null);
        setHelpBadge(null);
        loadStaffAndLogs();
      }, 3000);

    } else if (action === "break_end") {
      if (!todayLog) return;
      const { data, error } = await supabase.rpc("record_punch", {
        p_staff_id: selectedStaff.id,
        p_staff_name: selectedStaff.name,
        p_store_id: user.storeId,
        p_hourly_rate: selectedStaff.hourly_rate,
        p_action: "break_end",
      });

      if (error || !data) { toast.error(`休憩終了打刻に失敗しました: ${error?.message ?? ""}`); return; }
      const row = data as unknown as AttendanceLog;
      toast.success(`${selectedStaff.name}さん ${row.break_end} 休憩終了`);
      setTodayLog(row);
      setTimeout(() => {
        setSelectedStaff(null);
        setTodayLog(null);
        setHelpBadge(null);
        loadStaffAndLogs();
      }, 3000);

    } else {
      if (!todayLog) return;
      const { data, error } = await supabase.rpc("record_punch", {
        p_staff_id: selectedStaff.id,
        p_staff_name: selectedStaff.name,
        p_store_id: user.storeId,
        p_hourly_rate: selectedStaff.hourly_rate,
        p_action: "out",
      });

      if (error || !data) { console.error("退勤打刻 error:", error); toast.error(`退勤打刻に失敗しました: ${error?.message ?? ""}`); return; }
      const row = data as unknown as AttendanceLog;
      if (row.clock_in && row.clock_out && row.date) {
        const sunday = sundayOfWeek(row.date);
        const { data: weekRows } = await supabase.from("attendance_logs")
          .select("date, clock_in, clock_out, break_start, break_end, is_legal_holiday")
          .eq("staff_id", selectedStaff.id)
          .gte("date", sunday).lt("date", row.date);
        const priorWeeklyMins = (weekRows ?? [])
          .filter((r: any) => !r.is_legal_holiday && r.clock_in && r.clock_out)
          .reduce((sum: number, r: any) => sum + dailyNormalMinutes(r.clock_in, r.clock_out, r.break_start, r.break_end), 0);
        const cost = calcCost(row.clock_in, row.clock_out, selectedStaff.hourly_rate, row.break_start, row.break_end, priorWeeklyMins, selectedStaff.wage_type, selectedStaff.daily_rate);
        await supabase.from("attendance_logs").update({ actual_cost: cost }).eq("id", row.id);
      }
      toast.success(`${selectedStaff.name}さん ${row.clock_out} 退勤しました`);
      setTodayLog(row);
      setTimeout(() => {
        setSelectedStaff(null);
        setTodayLog(null);
        setHelpBadge(null);
        loadStaffAndLogs();
      }, 3000);
    }
  };

  const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });

  const isOnBreak = todayLog?.clock_in && todayLog?.break_start && !todayLog?.break_end && !todayLog?.clock_out;
  const isWorking = todayLog?.clock_in && !todayLog?.clock_out && !isOnBreak;
  const isDone = todayLog?.clock_in && todayLog?.clock_out;

  if (showHelpStoreList) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setShowHelpStoreList(false)}
              className="p-2 rounded-xl bg-secondary"
            >
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold flex-1">ヘルプ：店舗を選択</h1>
          </div>
          {loadingHelp ? (
            <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="space-y-3">
              {helpStores.map(store => (
                <button
                  key={store.id}
                  onClick={() => openHelpStaffList(store)}
                  className="w-full bg-white border border-border rounded-2xl p-5 text-left flex items-center justify-between active:scale-[0.98] transition shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Building2 size={20} className="text-orange-500" />
                    <p className="text-lg font-bold text-foreground">{store.name}</p>
                  </div>
                  <ChevronLeft size={20} className="rotate-180 text-muted-foreground" />
                </button>
              ))}
              {helpStores.length === 0 && (
                <p className="text-center text-muted-foreground py-12">ヘルプ可能な他店舗がありません</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showHelpStaffList) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => { setShowHelpStaffList(false); setShowHelpStoreList(true); }}
              className="p-2 rounded-xl bg-secondary"
            >
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold flex-1">ヘルプ：{selectedHelpStore?.name}</h1>
          </div>
          {loadingHelp ? (
            <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
          ) : (
            <div className="space-y-3">
              {helpStaffList.map(staff => (
                <button
                  key={staff.id}
                  onClick={() => selectStaff(staff, selectedHelpStore?.name)}
                  className="w-full bg-white border border-border rounded-2xl p-5 text-left flex items-center justify-between active:scale-[0.98] transition shadow-sm"
                >
                  <p className="text-lg font-bold text-foreground">{staff.name}</p>
                  <ChevronLeft size={20} className="rotate-180 text-muted-foreground" />
                </button>
              ))}
              {helpStaffList.length === 0 && (
                <p className="text-center text-muted-foreground py-12">従業員が登録されていません</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showStaffList) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => (reorderMode ? setReorderMode(false) : setShowStaffList(false))}
              className="p-2 rounded-xl bg-secondary"
            >
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold flex-1">{reorderMode ? "並び替え" : "従業員を選択"}</h1>
            {reorderMode ? (
              <button
                onClick={() => setReorderMode(false)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-primary text-primary-foreground text-sm font-bold"
              >
                <Check size={16} /> 完了
              </button>
            ) : (
              <button
                onClick={() => setReorderMode(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-sm font-medium"
              >
                <ArrowUpDown size={16} /> 並び替え
              </button>
            )}
          </div>
          {reorderMode && (
            <p className="text-xs text-muted-foreground mb-6">
              {savingOrder ? "保存中..." : "カードを長押しすると並び替えられます"}
            </p>
          )}
          {!reorderMode && <div className="mb-6" />}

          {reorderMode ? (
            <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={staffList.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {staffList.map(staff => (
                    <SortableStaffCard key={staff.id} staff={staff} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="space-y-3">
              {staffList.map(staff => (
                <button
                  key={staff.id}
                  onClick={() => selectStaff(staff)}
                  className="w-full bg-white border border-border rounded-2xl p-5 text-left flex items-center justify-between active:scale-[0.98] transition shadow-sm"
                >
                  <div>
                    <p className="text-lg font-bold text-foreground">{staff.name}</p>
                    {staffTodayLogs[staff.id] && (() => {
                      const l = staffTodayLogs[staff.id];
                      const isBreaking = l.break_start && !l.break_end && !l.clock_out;
                      const color = l.clock_out ? '#9ca3af' : isBreaking ? '#f97316' : '#16a34a';
                      const label = l.clock_out
                        ? `退勤済 ${l.clock_in} → ${l.clock_out}`
                        : isBreaking
                          ? `休憩中 ${l.break_start}〜`
                          : `出勤中 ${l.clock_in}〜`;
                      return <p className="text-xs mt-0.5 font-medium" style={{ color }}>{label}</p>;
                    })()}
                  </div>
                  <ChevronLeft size={20} className="rotate-180 text-muted-foreground" />
                </button>
              ))}
              {staffList.length === 0 && (
                <p className="text-center text-muted-foreground py-12">従業員が登録されていません</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-md mx-auto w-full px-6 pt-8 pb-2 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{user?.storeName}</p>
          <h1 className="text-base font-bold text-foreground">ピタッと勤怠</h1>
        </div>
        <button
          onClick={logout}
          className="text-xs text-muted-foreground px-3 py-1.5 rounded-lg bg-secondary"
        >
          ログアウト
        </button>
      </div>

      <div className="max-w-md mx-auto w-full px-6 mt-4">
        <section className="rounded-3xl bg-gradient-primary text-primary-foreground p-8 text-center shadow-lg">
          <p className="text-sm opacity-90">{date}</p>
          <p className="text-6xl font-bold tracking-tight tabular-nums mt-2">{time}</p>
          {selectedStaff && (
            <div className="mt-4 px-4 py-2 rounded-full bg-white/20 text-base font-bold inline-block">
              {selectedStaff.name}さん
              {helpBadge && <span className="ml-1.5 text-sm font-medium opacity-90">(ヘルプ:{helpBadge}より)</span>}
            </div>
          )}
        </section>
      </div>

      <div className="max-w-md mx-auto w-full px-6 mt-6 space-y-3 flex-1">
        {!selectedStaff ? (
          <>
            <p className="text-center text-muted-foreground text-sm mb-2">
              従業員を選択して出退勤してください
            </p>
            <button
              onClick={() => setShowStaffList(true)}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-6 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg"
            >
              <Users size={24} />
              従業員を選択する
            </button>
            <button
              onClick={openHelpStoreList}
              className="w-full bg-white border-2 border-orange-300 text-orange-600 rounded-2xl py-5 font-bold text-base flex items-center justify-center gap-3 active:scale-[0.98] transition"
            >
              <HeartHandshake size={22} />
              ヘルプ（他店舗から応援）
            </button>
          </>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground">読み込み中...</div>
        ) : isDone ? (
          <div className="text-center">
            <div className="bg-muted rounded-2xl py-8 px-4 mb-4">
              <p className="text-base font-medium text-muted-foreground">本日の勤務が終了しました</p>
              <p className="text-sm text-muted-foreground mt-1">
                {todayLog?.clock_in} → {todayLog?.clock_out}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">3秒後に戻ります...</p>
          </div>
        ) : isOnBreak ? (
          <>
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 text-center">
              <p className="text-sm text-orange-700 font-medium">休憩中</p>
              <p className="text-xs text-muted-foreground mt-1">休憩開始: {todayLog?.break_start}</p>
            </div>
            <button
              onClick={() => punch("break_end")}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-6 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg"
            >
              <Coffee size={24} />
              休憩終了
            </button>
            <button
              onClick={() => { setSelectedStaff(null); setTodayLog(null); setHelpBadge(null); }}
              className="w-full bg-secondary text-foreground rounded-2xl py-4 font-medium text-sm"
            >
              戻る
            </button>
          </>
        ) : isWorking ? (
          <>
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
              <p className="text-sm text-green-700 font-medium">出勤中</p>
              <p className="text-xs text-muted-foreground mt-1">出勤時刻: {todayLog?.clock_in}</p>
            </div>
            <button
              onClick={() => punch("out")}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-6 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg"
            >
              <LogOut size={24} />
              退勤する
            </button>
            <button
              onClick={() => punch("break_start")}
              className="w-full bg-orange-400 text-white rounded-2xl py-6 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg"
            >
              <Coffee size={24} />
              休憩開始
            </button>
            <button
              onClick={() => { setSelectedStaff(null); setTodayLog(null); setHelpBadge(null); }}
              className="w-full bg-secondary text-foreground rounded-2xl py-4 font-medium text-sm"
            >
              戻る
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => punch("in")}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-6 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg"
            >
              <LogIn size={24} />
              出勤する
            </button>
            <button
              onClick={() => { setSelectedStaff(null); setTodayLog(null); setHelpBadge(null); }}
              className="w-full bg-secondary text-foreground rounded-2xl py-4 font-medium text-sm"
            >
              戻る
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SortableStaffCard({ staff }: { staff: StaffMember }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: staff.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="w-full bg-white border border-border rounded-2xl p-5 flex items-center justify-between shadow-sm touch-none select-none"
    >
      <p className="text-lg font-bold text-foreground">{staff.name}</p>
      <GripVertical size={20} className="text-muted-foreground flex-shrink-0" />
    </div>
  );
}