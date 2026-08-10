import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// シフト判定ロジック（時間帯確認後にここを修正してください）
// clock_in の時刻（HH:MM形式）からシフト区分を返す
// ============================================================
function classifyShift(clockIn: string | null): string {
  if (!clockIn) return "－";
  const h = parseInt(clockIn.split(":")[0], 10);
  if (h >= 5 && h < 9)  return "早";   // 早番: 05:00〜08:59
  if (h >= 9 && h < 12) return "日";   // 日勤: 09:00〜11:59
  if (h >= 12 && h < 16) return "遅";  // 遅番: 12:00〜15:59
  if (h >= 16) return "夜入";           // 夜勤入: 16:00〜23:59
  return "夜明";                         // 夜勤明: 00:00〜04:59
}

const DAY_OF_WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const SHIFT_LABELS = ["早番", "日勤", "遅番", "夜勤入", "夜勤明"];
const SHIFT_CODES  = ["早",   "日",   "遅",   "夜入",  "夜明"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { store_id, store_name, year, month } = await req.json();
    if (!store_id || !year || !month) {
      return new Response(JSON.stringify({ error: "store_id, year, month required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const mm = String(month).padStart(2, "0");
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    const startDate = `${year}-${mm}-01`;
    const endDate   = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();

    // スタッフ一覧（kiosk/admin/owner 除く）
    const { data: staffList } = await supabase
      .from("staff_members")
      .select("id, name")
      .eq("store_id", store_id)
      .eq("status", "active")
      .not("role", "in", '("kiosk","admin","owner")')
      .order("name");

    // 出退勤ログ
    const { data: logs } = await supabase
      .from("attendance_logs")
      .select("staff_id, date, clock_in")
      .eq("store_id", store_id)
      .gte("date", startDate)
      .lt("date", endDate);

    // staff_id × 日(1-31) → シフト区分コード
    const logMap: Record<string, Record<number, string>> = {};
    for (const log of logs ?? []) {
      if (!logMap[log.staff_id]) logMap[log.staff_id] = {};
      const day = parseInt(log.date.split("-")[2], 10);
      logMap[log.staff_id][day] = classifyShift(log.clock_in);
    }

    // 曜日行
    const weekdays = Array.from({ length: daysInMonth }, (_, i) =>
      DAY_OF_WEEK[new Date(year, month - 1, i + 1).getDay()]
    );

    // ========== XLSX 作成 ==========
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [];

    // --- 行1: タイトル/シフト名称/有休・特休・特慶 ---
    aoa.push([
      "", "", "", "", "シフト名称", "－", "有休", "特休", "特慶",
      ...Array(daysInMonth - 3).fill(""),
      "早番", "日勤", "遅番", "夜勤入", "夜勤明", "合計", "未入力",
    ]);

    // --- 行2: 年・月・日付数字 ---
    aoa.push([
      "", "勤怠", "勤怠", `${year}年`, `${month}月`, "",
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
      "", "", "", "", "", "", "",
    ]);

    // --- 行3: 列ヘッダー ---
    aoa.push([
      "No", "No", "ID", "社員名", "職種", "",
      ...weekdays,
      "早番", "日勤", "遅番", "夜勤入", "夜勤明", "合計", "未入力",
    ]);

    // --- スタッフ行（最大25行） ---
    for (let i = 0; i < 25; i++) {
      const s = (staffList ?? [])[i];
      if (s) {
        const daily = Array.from({ length: daysInMonth }, (_, d) =>
          logMap[s.id]?.[d + 1] ?? "－"
        );
        const counts = SHIFT_CODES.map(code => daily.filter(c => c === code).length);
        const total = counts.reduce((a, b) => a + b, 0);
        const unrecorded = daily.filter(c => c === "－").length;
        aoa.push([i + 1, "", "", s.name, "", "－", ...daily, ...counts, total, unrecorded]);
      } else {
        aoa.push([i + 1, "", "", "", "", "－",
          ...Array(daysInMonth).fill("－"), 0, 0, 0, 0, 0, 0, 0]);
      }
    }

    // --- 集計行（早番〜未入力） ---
    const aggLabels = [...SHIFT_LABELS, "合計", "未入力"];
    for (const label of aggLabels) {
      const row: (string | number)[] = ["", "", "", "", label, ""];
      for (let d = 1; d <= daysInMonth; d++) {
        if (label === "合計") {
          row.push((staffList ?? []).filter(s => logMap[s.id]?.[d] && logMap[s.id][d] !== "－").length);
        } else if (label === "未入力") {
          const recorded = (staffList ?? []).filter(s => logMap[s.id]?.[d]).length;
          row.push((staffList?.length ?? 0) - recorded);
        } else {
          const code = SHIFT_CODES[SHIFT_LABELS.indexOf(label)];
          row.push((staffList ?? []).filter(s => logMap[s.id]?.[d] === code).length);
        }
      }
      row.push(...Array(7).fill(""));
      aoa.push(row);
    }

    // --- 予定行事行 ---
    aoa.push(["", "", "", "予定行事", "", "", ...Array(daysInMonth + 6).fill("")]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // 列幅
    ws["!cols"] = [
      { wch: 4 },  // No
      { wch: 6 },  // 勤怠No
      { wch: 6 },  // 勤怠ID
      { wch: 14 }, // 社員名
      { wch: 8 },  // 職種
      { wch: 4 },  // シフト名称(A)
      ...Array(daysInMonth).fill({ wch: 3 }),
      { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 6 }, { wch: 6 }, { wch: 5 }, { wch: 5 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "シフト表");

    const buf: Uint8Array = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const safeName = (store_name ?? "store").replace(/[/\\?%*:|"<>\s]/g, "_");
    const fileName = `shift_${safeName}_${year}-${mm}.xlsx`;

    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(buf.byteLength),
      },
    });
  } catch (err) {
    console.error("generate-shift-report error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
