// 顔の特徴量(128次元の数値)を、端末のブラウザの中で作る。
// 映像・写真はサーバーに送らず、保存もしない。作った特徴量の数値だけをサーバーの関数(face-auth)に渡す。
// ライブラリとモデルは、顔認証を使うときだけ読み込む(使わない画面や店舗の表示は重くならない)。
type FaceApi = typeof import("@vladmandic/face-api");

let apiPromise: Promise<FaceApi> | null = null;

export function loadFaceEngine(): Promise<FaceApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      const base = "/models/face";
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(base),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(base),
        faceapi.nets.faceRecognitionNet.loadFromUri(base),
      ]);
      return faceapi;
    })().catch((e) => {
      apiPromise = null;
      throw e;
    });
  }
  return apiPromise;
}

export interface DescribedFace {
  descriptor: number[];
  score: number;
  /** 顔の幅が画像の幅に占める割合(0〜1)。小さいと遠すぎて精度が落ちる */
  widthRatio: number;
}

export type FaceInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

function inputWidth(input: FaceInput): number {
  if (input instanceof HTMLVideoElement) return input.videoWidth || input.width || 1;
  if (input instanceof HTMLImageElement) return input.naturalWidth || input.width || 1;
  return input.width || 1;
}

/** 画像の中の顔を1つ見つけて特徴量を作る。顔が無い・複数で判別できない場合は null */
export async function describeFace(input: FaceInput): Promise<DescribedFace | null> {
  const faceapi = await loadFaceEngine();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const all = await faceapi.detectAllFaces(input, options).withFaceLandmarks(true).withFaceDescriptors();
  if (all.length !== 1) return null; // 複数人が映っているときは取り違えを避けるため判定しない
  const det = all[0];
  return {
    descriptor: Array.from(det.descriptor),
    score: det.detection.score,
    widthRatio: det.detection.box.width / inputWidth(input),
  };
}

/** 登録・判定に使える品質か(顔がはっきりしていて、ある程度の大きさで映っている) */
export function isUsableFace(f: DescribedFace | null): f is DescribedFace {
  return !!f && f.score >= 0.6 && f.widthRatio >= 0.2;
}
