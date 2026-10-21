import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { describeFace, isUsableFace, loadFaceEngine } from "@/lib/faceEngine";

// 顔認証の画面部品。映像は端末の中だけで使い、サーバーへ送るのは特徴量(数値)だけ。
// 判定・登録・削除はサーバーの関数 face-auth が行う。
// 打刻の画面で「顔認証をする」「顔を登録する」を押したときに、画面いっぱいのカメラで表示する。

export async function callFaceAuth<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("face-auth", { body });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

/** カメラ画面を開いたまま、これ以上待っても進まないとみなす時間(キオスクが開きっぱなしにならないように) */
const CAMERA_TIMEOUT_MS = 30_000;

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

/** 一定時間で onTimeout を呼ぶ(画面を開いたまま放置されたとき、トップ画面に戻すため) */
function useTimeout(onTimeout: () => void, ms: number) {
  const ref = useRef(onTimeout);
  ref.current = onTimeout;
  useEffect(() => {
    const id = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(id);
  }, [ms]);
}

/** 少しあとに実行する(画面を閉じたら取り消す。閉じたあとに打刻の画面を勝手に動かさないため) */
function useLater() {
  const ids = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { ids.current.forEach(clearTimeout); ids.current = []; }, []);
  return useRef((fn: () => void, ms: number) => { ids.current.push(setTimeout(fn, ms)); }).current;
}

/* ─ 画面いっぱいのカメラ: 中央に顔を合わせる枠、上に「やめる」、下に案内 ─ */
function FullScreenCamera({
  videoRef, state, title, onClose, frame, flash, children,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: CameraState;
  title: string;
  onClose: () => void;
  /** 枠の色: 待機中=白、成功=緑 */
  frame: "idle" | "ok";
  /** 撮影した瞬間に、画面を一瞬白く光らせる */
  flash: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black text-white overflow-hidden">
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover -scale-x-100" />
      {/* 顔を合わせる枠(楕円)。枠の外側を暗くする */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`rounded-[50%] border-4 transition-colors duration-300 ${frame === "ok" ? "border-green-400" : "border-white/90"}`}
          style={{ width: "min(68vw, 52vh)", height: "min(88vw, 68vh)", boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)" }}
        />
      </div>
      <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-300 ${flash ? "opacity-80" : "opacity-0"}`} />

      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-4 pb-3 bg-gradient-to-b from-black/70 to-transparent"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <button onClick={onClose} className="flex items-center gap-1 rounded-full bg-white/20 px-4 py-2 text-sm font-bold active:scale-95 transition">
          <X size={18} /> やめる
        </button>
        <h1 className="flex-1 text-base font-bold truncate">{title}</h1>
      </div>

      {state !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-center px-6 text-base">
          {state === "starting" ? "カメラを準備しています…" : "カメラを使えませんでした"}
        </div>
      )}

      <div className="absolute bottom-0 inset-x-0 z-10 px-6 pt-10 text-center bg-gradient-to-t from-black/80 via-black/60 to-transparent space-y-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}>
        {children}
      </div>
    </div>
  );
}

/** 本人の確認で、1回に送る枚数と、1枚ごとの間隔 */
const VERIFY_FRAMES = 3;
const VERIFY_FRAME_GAP_MS = 350;
/** 撮っている途中で、これだけ顔が見えなければ、撮った分を捨てて最初からにする */
const VERIFY_LOST_MS = 1500;

/* ─ 打刻の前に、本人の顔か確認する(確認できない回数が3回で、店長の承認待ちとして進められる) ─ */
export function FaceVerifyScreen({
  staffName, staffId, onSuccess, onPending, onCancel, onTimeout,
}: {
  staffName: string; staffId: string;
  onSuccess: () => void;
  /** 3回確認できなかった場合に、店長の承認待ちとして打刻を進める */
  onPending: () => void;
  /** 「やめる」: 打刻の画面に戻る */
  onCancel: () => void;
  /** 放置されたとき: トップ画面に戻る */
  onTimeout: () => void;
}) {
  const MAX_ATTEMPTS = 3;
  const { videoRef, state } = useFaceCamera();
  const [attempts, setAttempts] = useState(0);
  const [checking, setChecking] = useState(false);
  const [ok, setOk] = useState(false);
  const failed = attempts >= MAX_ATTEMPTS || state === "error";
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const later = useLater();
  useTimeout(onTimeout, CAMERA_TIMEOUT_MS);

  useEffect(() => {
    if (state !== "ready" || attempts >= MAX_ATTEMPTS) return;
    let stopped = false;
    let busy = false;
    // 1回の確認で、少し間をあけて連続で撮った数枚を送る(サーバーは、そのうち2枚以上が基準内のときだけ合格にする)
    const frames: number[][] = [];
    let lastFrame = 0;
    const tick = async () => {
      if (stopped || busy) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      if (Date.now() - lastFrame < VERIFY_FRAME_GAP_MS) return;
      busy = true;
      try {
        const f = await describeFace(v);
        if (stopped) return;
        if (!isUsableFace(f)) {
          // 途中で顔が枠から外れたら、撮った分を捨てて「枠に顔を合わせてください」に戻す
          if (frames.length > 0 && Date.now() - lastFrame > VERIFY_LOST_MS) { frames.length = 0; setChecking(false); }
          return;
        }
        lastFrame = Date.now();
        frames.push(f.descriptor);
        setChecking(true);
        if (frames.length < VERIFY_FRAMES) return;
        const r = await callFaceAuth<{ ok: boolean }>({ action: "verify", staff_id: staffId, descriptors: frames.splice(0) });
        if (stopped) return;
        stopped = true;
        setChecking(false);
        if (r.ok) {
          setOk(true);
          later(() => onSuccessRef.current(), 900);   // 「確認しました」を見せてから戻る
          return;
        }
        setAttempts((a) => a + 1);
      } catch {
        stopped = true;
        setChecking(false);
        setAttempts(MAX_ATTEMPTS);
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, 200);
    return () => { stopped = true; clearInterval(id); };
  }, [state, attempts, staffId, videoRef, later]);

  return (
    <FullScreenCamera videoRef={videoRef} state={state} title={`${staffName}さん：顔認証`} onClose={onCancel} frame={ok ? "ok" : "idle"} flash={false}>
      {ok ? (
        <p className="text-2xl font-bold text-green-300">✓ 本人を確認しました</p>
      ) : failed ? (
        <div className="space-y-3">
          <p className="text-xl font-bold">{state === "error" ? "カメラを使えませんでした" : "顔を確認できませんでした"}</p>
          <p className="text-sm text-white/85">このまま打刻できます。店長があとで確認します。</p>
          <button
            onClick={onPending}
            className="w-full max-w-md mx-auto bg-gradient-primary text-primary-foreground rounded-2xl py-5 font-bold text-lg active:scale-[0.98] transition shadow-lg"
          >
            このまま打刻する
          </button>
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold">
            {checking ? "確認しています…" : attempts > 0 ? "確認できませんでした。もう一度、枠に顔を合わせてください" : "枠に顔を合わせてください"}
          </p>
          <p className="text-sm text-white/85">ボタンは押しません。顔を映すと、自動で確認します。</p>
          {attempts > 0 && <p className="text-base font-bold text-orange-300">{attempts}/{MAX_ATTEMPTS} 回</p>}
        </>
      )}
    </FullScreenCamera>
  );
}

/* ─ 顔が未登録の従業員: 同意 → 撮影(自動で3枚) → 登録 ─ */
export function FaceEnrollScreen({
  staffName, staffId, onDone, onCancel, onTimeout,
}: {
  staffName: string; staffId: string;
  onDone: () => void;
  /** 「やめる」「キャンセル」: 打刻の画面に戻る */
  onCancel: () => void;
  /** 放置されたとき: トップ画面に戻る */
  onTimeout: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const later = useLater();

  if (!agreed) {
    return <EnrollConsent staffName={staffName} onAgree={() => setAgreed(true)} onCancel={onCancel} onTimeout={onTimeout} />;
  }

  return <EnrollCapture
    staffName={staffName} saving={saving} done={done} error={error}
    onCancel={onCancel} onTimeout={onTimeout}
    onCaptured={async (descriptors) => {
      setSaving(true);
      setError(null);
      try {
        await callFaceAuth({ action: "enroll", staff_id: staffId, descriptors, consent: true });
        setSaving(false);
        setDone(true);
        later(onDone, 1200);   // 「登録が完了しました」を見せてから戻る
      } catch {
        setError("登録できませんでした。もう一度、枠に顔を合わせてください");
        setSaving(false);
      }
    }}
  />;
}

function EnrollConsent({ staffName, onAgree, onCancel, onTimeout }: {
  staffName: string; onAgree: () => void; onCancel: () => void; onTimeout: () => void;
}) {
  useTimeout(onTimeout, CAMERA_TIMEOUT_MS);
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-6">
        <h1 className="text-xl font-bold">{staffName}さん：顔の登録</h1>
        <div className="rounded-3xl bg-white border border-border p-6 text-center shadow-sm space-y-3">
          <Camera size={36} className="mx-auto text-orange-500" />
          <p className="text-lg font-bold text-foreground">打刻用の顔認証写真の撮影を始めます。よろしいですか？</p>
          <p className="text-sm text-muted-foreground">（店舗での打刻にのみ使用します）</p>
          <p className="text-sm font-bold text-foreground pt-2">
            撮影のボタンはありません。<br />カメラの枠に顔を合わせると、自動で3回撮影します。
          </p>
        </div>
        <div className="space-y-3">
          <button
            onClick={onAgree}
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

/** 1枚ずつ、向きを少し変えて撮る(登録の精度を上げるため) */
const ENROLL_STEPS = ["正面を向いてください", "少しだけ右を向いてください", "少しだけ左を向いてください"];
/** 1枚撮ってから次を撮るまでの間隔(案内を読んで、向きを変える時間) */
const ENROLL_INTERVAL_MS = 1500;

function EnrollCapture({
  staffName, saving, done, error, onCaptured, onCancel, onTimeout,
}: {
  staffName: string; saving: boolean; done: boolean; error: string | null;
  onCaptured: (descriptors: number[][]) => void;
  onCancel: () => void;
  onTimeout: () => void;
}) {
  const needed = ENROLL_STEPS.length;
  const { videoRef, state } = useFaceCamera();
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const collected = useRef<number[][]>([]);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;
  const later = useLater();
  useTimeout(onTimeout, CAMERA_TIMEOUT_MS);

  useEffect(() => {
    if (state !== "ready" || saving || done) return;
    let stopped = false;
    let busy = false;
    let last = Date.now();
    collected.current = [];
    setCount(0);
    const tick = async () => {
      if (stopped || busy || Date.now() - last < ENROLL_INTERVAL_MS) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      busy = true;
      try {
        const f = await describeFace(v);
        if (!isUsableFace(f) || stopped) return;
        last = Date.now();
        collected.current.push(f.descriptor);
        setCount(collected.current.length);
        setFlash(true);
        later(() => setFlash(false), 250);
        if (collected.current.length >= needed) {
          stopped = true;
          onCapturedRef.current(collected.current.slice());
        }
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, 300);
    return () => { stopped = true; clearInterval(id); };
    // error が変わったら(登録に失敗したら)、最初から撮り直す
  }, [state, saving, done, needed, videoRef, error, later]);

  return (
    <FullScreenCamera videoRef={videoRef} state={state} title={`${staffName}さん：顔の登録`} onClose={onCancel} frame={done ? "ok" : "idle"} flash={flash}>
      {done ? (
        <p className="text-2xl font-bold text-green-300">✓ 登録が完了しました</p>
      ) : saving ? (
        <p className="text-2xl font-bold">登録しています…</p>
      ) : state === "error" ? (
        <>
          <p className="text-xl font-bold">カメラを使えませんでした</p>
          <p className="text-sm text-white/85">カメラが使えない場合は、店長が従業員管理から、写真をアップロードして登録できます。</p>
        </>
      ) : (
        <>
          {error && <p className="text-base font-bold text-orange-300">{error}</p>}
          <p className="text-2xl font-bold">{ENROLL_STEPS[Math.min(count, needed - 1)]}</p>
          <div className="flex justify-center gap-3">
            {Array.from({ length: needed }).map((_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full ${i < count ? "bg-green-400" : "bg-white/40"}`} />
            ))}
          </div>
          <p className="text-base font-bold">{count > 0 ? `✓ ${count}/${needed} 枚撮影しました` : `0/${needed} 枚`}</p>
          <p className="text-sm text-white/85">ボタンは押しません。枠に顔を合わせると、自動で撮影します。</p>
        </>
      )}
    </FullScreenCamera>
  );
}
