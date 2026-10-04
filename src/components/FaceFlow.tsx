import { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ScanFace } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { describeFace, isUsableFace, loadFaceEngine } from "@/lib/faceEngine";

// 顔認証の画面部品。映像は端末の中だけで使い、サーバーへ送るのは特徴量(数値)だけ。
// 判定・登録・削除はサーバーの関数 face-auth が行う。

export async function callFaceAuth<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("face-auth", { body });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

type CameraState = "starting" | "ready" | "error";

function useFaceCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
        await loadFaceEngine();
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return { videoRef, state };
}

function CameraView({ videoRef, state }: { videoRef: React.RefObject<HTMLVideoElement | null>; state: CameraState }) {
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
      <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover -scale-x-100" />
      {state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center text-white/90 text-sm bg-black/60 text-center px-4">
          {state === "starting" ? "カメラを準備しています…" : "カメラを使えません"}
        </div>
      )}
    </div>
  );
}

/* ─ トップ画面: 顔を映すだけで本人を自動判定する ─ */
export function FaceAutoMatch({ storeId, onMatched }: { storeId: string; onMatched: (staffId: string) => void }) {
  const { videoRef, state } = useFaceCamera();
  const [msg, setMsg] = useState("顔を映すと自動で確認します");
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
    if (state !== "ready") return;
    let stopped = false;
    let busy = false;
    let misses = 0;
    let lastCall = 0;
    const GIVE_UP = "見つかりませんでした。一覧から選んでください";
    const tick = async () => {
      if (stopped || busy) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      busy = true;
      try {
        const f = await describeFace(v);
        if (!isUsableFace(f)) { misses = 0; setMsg("顔を映すと自動で確認します"); return; }
        if (misses >= 4) { setMsg(GIVE_UP); return; }
        if (Date.now() - lastCall < 1500) return;
        lastCall = Date.now();
        setMsg("確認しています…");
        const r = await callFaceAuth<{ matched: boolean; staff_id?: string }>({ action: "match", store_id: storeId, descriptor: f.descriptor });
        if (r.matched && r.staff_id) { stopped = true; onMatchedRef.current(r.staff_id); return; }
        misses++;
        setMsg(misses >= 4 ? GIVE_UP : "もう一度、顔をまっすぐ映してください");
      } catch {
        misses = 99;
        setMsg("顔の確認を使えません。一覧から選んでください");
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, 700);
    return () => { stopped = true; clearInterval(id); };
  }, [state, storeId, videoRef]);

  if (state === "error") return null; // カメラが使えない端末では、従来どおり一覧から選ぶ
  return (
    <div className="rounded-2xl bg-white border border-border p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-2 text-sm font-bold text-foreground">
        <ScanFace size={18} className="text-orange-500" /> 顔で打刻
      </div>
      <CameraView videoRef={videoRef} state={state} />
      <p className="text-center text-sm text-muted-foreground mt-2">{msg}</p>
    </div>
  );
}

/* ─ 一覧から選んだあと: 本人の顔か確認する(再撮影は最大3回) ─ */
export function FaceVerifyScreen({
  staffName, staffId, onSuccess, onPending, onCancel,
}: {
  staffName: string; staffId: string;
  onSuccess: () => void;
  /** 3回確認できなかった場合に、店長の承認待ちとして打刻を進める */
  onPending: () => void;
  onCancel: () => void;
}) {
  const MAX_ATTEMPTS = 3;
  const { videoRef, state } = useFaceCamera();
  const [attempts, setAttempts] = useState(0);
  const [msg, setMsg] = useState("顔をまっすぐ映してください");
  const failed = attempts >= MAX_ATTEMPTS || state === "error";

  useEffect(() => {
    if (state !== "ready" || attempts >= MAX_ATTEMPTS) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      busy = true;
      try {
        const f = await describeFace(v);
        if (!isUsableFace(f)) return;
        setMsg("確認しています…");
        const r = await callFaceAuth<{ ok: boolean }>({ action: "verify", staff_id: staffId, descriptor: f.descriptor });
        if (stopped) return;
        if (r.ok) { stopped = true; onSuccess(); return; }
        stopped = true;
        setAttempts((a) => a + 1);
        setMsg("確認できませんでした。もう一度お試しください");
      } catch {
        stopped = true;
        setAttempts(MAX_ATTEMPTS);
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, 700);
    return () => { stopped = true; clearInterval(id); };
  }, [state, attempts, staffId, videoRef]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-6 py-8 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="p-2 rounded-xl bg-secondary"><ChevronLeft size={20} /></button>
          <h1 className="text-xl font-bold flex-1">{staffName}さん：顔の確認</h1>
        </div>
        <CameraView videoRef={videoRef} state={state} />
        {!failed ? (
          <p className="text-center text-base font-medium text-foreground">
            {msg}{attempts > 0 && <span className="text-sm text-muted-foreground">（{attempts}/{MAX_ATTEMPTS}）</span>}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 text-center">
              <p className="text-sm font-bold text-orange-800">
                {state === "error" ? "カメラを使えませんでした" : "顔を確認できませんでした"}
              </p>
              <p className="text-xs text-orange-700 mt-1">このまま打刻できます。店長があとで確認します。</p>
            </div>
            <button
              onClick={onPending}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-5 font-bold text-base active:scale-[0.98] transition shadow-lg"
            >
              このまま打刻する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─ 顔が未登録の従業員: 同意 → 撮影 → 登録 ─ */
export function FaceEnrollScreen({
  staffName, staffId, onDone, onCancel,
}: {
  staffName: string; staffId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const NEEDED = 3;
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!agreed) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-6 py-10 space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="p-2 rounded-xl bg-secondary"><ChevronLeft size={20} /></button>
            <h1 className="text-xl font-bold flex-1">{staffName}さん</h1>
          </div>
          <div className="rounded-3xl bg-white border border-border p-6 text-center shadow-sm space-y-3">
            <Camera size={36} className="mx-auto text-orange-500" />
            <p className="text-lg font-bold text-foreground">打刻用の顔認証写真の撮影を始めます。よろしいですか？</p>
            <p className="text-sm text-muted-foreground">（店舗での打刻にのみ使用します）</p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => setAgreed(true)}
              className="w-full bg-gradient-primary text-primary-foreground rounded-2xl py-5 font-bold text-lg active:scale-[0.98] transition shadow-lg"
            >
              はい
            </button>
            <button onClick={onCancel} className="w-full bg-secondary text-foreground rounded-2xl py-4 font-medium text-sm">
              キャンセル
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <EnrollCapture
    staffName={staffName} needed={NEEDED} saving={saving} error={error}
    onCancel={onCancel}
    onCaptured={async (descriptors) => {
      setSaving(true);
      setError(null);
      try {
        await callFaceAuth({ action: "enroll", staff_id: staffId, descriptors, consent: true });
        onDone();
      } catch {
        setError("登録できませんでした。もう一度お試しください");
        setSaving(false);
      }
    }}
  />;
}

function EnrollCapture({
  staffName, needed, saving, error, onCaptured, onCancel,
}: {
  staffName: string; needed: number; saving: boolean; error: string | null;
  onCaptured: (descriptors: number[][]) => void;
  onCancel: () => void;
}) {
  const { videoRef, state } = useFaceCamera();
  const [count, setCount] = useState(0);
  const collected = useRef<number[][]>([]);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  useEffect(() => {
    if (state !== "ready" || saving) return;
    let stopped = false;
    let busy = false;
    let last = 0;
    collected.current = [];
    setCount(0);
    const tick = async () => {
      if (stopped || busy || Date.now() - last < 900) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      busy = true;
      try {
        const f = await describeFace(v);
        if (!isUsableFace(f)) return;
        last = Date.now();
        collected.current.push(f.descriptor);
        setCount(collected.current.length);
        if (collected.current.length >= needed) {
          stopped = true;
          onCapturedRef.current(collected.current.slice());
        }
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, 500);
    return () => { stopped = true; clearInterval(id); };
  }, [state, saving, needed, videoRef, error]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-6 py-8 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="p-2 rounded-xl bg-secondary"><ChevronLeft size={20} /></button>
          <h1 className="text-xl font-bold flex-1">{staffName}さん：顔の登録</h1>
        </div>
        <CameraView videoRef={videoRef} state={state} />
        <div className="flex justify-center gap-2">
          {Array.from({ length: needed }).map((_, i) => (
            <span key={i} className={`h-3 w-3 rounded-full ${i < count ? "bg-green-500" : "bg-border"}`} />
          ))}
        </div>
        <p className="text-center text-base font-medium text-foreground">
          {error ?? (saving ? "登録しています…" : state === "error" ? "カメラを使えませんでした" : "顔をまっすぐ映して、少しずつ向きを変えてください")}
        </p>
        {state === "error" && (
          <p className="text-center text-xs text-muted-foreground">
            カメラが使えない場合は、店長が従業員管理から、写真をアップロードして登録できます。
          </p>
        )}
      </div>
    </div>
  );
}
