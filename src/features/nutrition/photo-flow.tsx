"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Camera,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { Dialog } from "./dialog";
import {
  abortDelay,
  messageOf,
  type Capabilities,
  type NutritionClient,
  type RecognitionConfirmation,
} from "./api";
import { newKey } from "./meal-editor";
export function PhotoFlow({
  open,
  client,
  capabilities,
  onCapabilitiesChange,
  onClose,
  onManual,
  onRecognized,
}: {
  open: boolean;
  client: NutritionClient;
  capabilities: Capabilities;
  onCapabilitiesChange?(value: Capabilities): void;
  onClose(): void;
  onManual(): void;
  onRecognized(result: RecognitionConfirmation): void;
}) {
  const camera = useRef<HTMLInputElement>(null),
    album = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    run = useRef(0),
    fileVersion = useRef(0);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState("");
  const asset = useRef(""),
    uploadKey = useRef(""),
    jobKey = useRef("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  useEffect(() => {
    if (!open || capabilities.mode !== "local_fixture" || !onCapabilitiesChange) return;
    const lifetime = new AbortController();
    let sequence = 0;
    async function check() {
      const current = ++sequence;
      const request = new AbortController();
      const abort = () => request.abort();
      lifetime.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 5000);
      setChecking(true);
      setCheckError("");
      try {
        const next = await client.capabilities(request.signal);
        if (!lifetime.signal.aborted && current === sequence) onCapabilitiesChange?.(next);
      } catch {
        if (!lifetime.signal.aborted && current === sequence)
          setCheckError("暂时无法连接识别服务，请重新检查；当前照片已保留。");
      } finally {
        clearTimeout(timeout);
        lifetime.signal.removeEventListener("abort", abort);
        if (!lifetime.signal.aborted && current === sequence) setChecking(false);
      }
    }
    const resume = () => { if (!document.hidden) void check(); };
    void check();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      lifetime.abort();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [open, client, capabilities.mode, onCapabilitiesChange, checkAttempt]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraRun = useRef(0);
  const [cameraState, setCameraState] = useState<"idle" | "opening" | "live" | "capturing">("idle");
  const [videoReady, setVideoReady] = useState(false);
  // Also invalidates a permission request which may resolve after the dialog closes.
  const stopCamera = useCallback(() => {
    cameraRun.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setVideoReady(false);
    setCameraState("idle");
  }, []);
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    if (!open) {
      fileVersion.current++;
      stopCamera();
    }
  }, [open, stopCamera]);
  useEffect(() => {
    if (cameraState !== "live" || !video.current || !stream.current) return;
    const current = cameraRun.current;
    video.current.srcObject = stream.current;
    void video.current.play().catch(() => {
      if (current !== cameraRun.current) return;
      stopCamera();
      setError("无法显示相机画面，请重试，或用Chrome / Safari打开此页面后拍摄");
    });
  }, [cameraState, stopCamera]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stopCamera(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stopCamera);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stopCamera);
    };
  }, [stopCamera]);
  useEffect(
    () => () => {
      fileVersion.current++;
      run.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!open) {
      run.current++;
      controller.current?.abort();
      setBusy(false);
    }
  }, [open]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    e.target.value = "";
    if (!selected) return;
    stopCamera();
    await selectPhoto(selected);
  }
  async function selectPhoto(selected: File) {
    const current = ++fileVersion.current;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      setError("请选择JPG、PNG或WebP图片；HEIC请先转换为JPG");
      return;
    }
    if (selected.size === 0 || selected.size > 10 * 1024 * 1024) {
      setError("图片不能为空，大小需不超过10MB");
      return;
    }
    const url = URL.createObjectURL(selected);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 40000000)
        throw Error("图片像素过大，请选择不超过4000万像素的照片");
      if (current !== fileVersion.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setPreview(url);
      setFile(selected);
      setStatus("");
      setJobId("");
      asset.current = "";
      uploadKey.current = newKey();
      jobKey.current = newKey();
    } catch (err) {
      URL.revokeObjectURL(url);
      if (current === fileVersion.current)
        setError(
          err instanceof Error && err.message.includes("像素")
            ? err.message
            : "无法读取这张图片，请重新拍摄或换一张图片",
        );
    }
  }
  async function openCamera() {
    stopCamera();
    setError("");
    // Mobile browsers delegate still photography to the native camera. On
    // desktop, capture=environment is only a hint and usually opens a file picker.
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (mobile) {
      camera.current?.click();
      return;
    }
    if (!window.isSecureContext) {
      setError("网页相机需要HTTPS或本机localhost地址。请用本机预览地址打开，或从相册选择照片");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持网页相机，请用Chrome / Safari打开此页面，或从相册选择照片");
      return;
    }
    const current = ++cameraRun.current;
    setCameraState("opening");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (current !== cameraRun.current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      setCameraState("live");
    } catch (err) {
      if (current !== cameraRun.current) return;
      stopCamera();
      const name = err instanceof Error ? err.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "未获得摄像头权限。请在浏览器的网站设置和系统相机隐私设置中允许访问；内置预览若不支持授权，可用Chrome / Safari打开此页面"
        : name === "NotFoundError"
          ? "没有找到可用摄像头，请检查设备连接，或从相册选择照片"
          : name === "NotReadableError"
            ? "摄像头暂时无法使用，请关闭正在占用相机的应用后重试，或从相册选择照片"
            : "相机启动失败，请重试，或用Chrome / Safari打开此页面后拍摄");
    }
  }
  async function takePhoto() {
    const element = video.current;
    if (!element || !videoReady || cameraState !== "live") return;
    const current = cameraRun.current;
    setCameraState("capturing");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) throw Error("相机画面尚未就绪，请重试");
      context.drawImage(element, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (result) => result ? resolve(result) : reject(Error("拍摄失败，请重试")), "image/jpeg", 0.9,
      ));
      if (current !== cameraRun.current) return;
      stopCamera();
      await selectPhoto(new File([blob], `meal-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch (err) {
      if (current !== cameraRun.current) return;
      setCameraState("live");
      setError(messageOf(err));
    }
  }
  async function recognize() {
    if (!file || busy || checking || checkError) return;
    if (!capabilities.upload || !capabilities.recognition) {
      setError("上传和AI识别服务尚未接入，照片目前仅保留在设备预览");
      return;
    }
    const id = ++run.current;
    const c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    setStatus("正在准备照片");
    try {
      if (!asset.current)
        asset.current = await client.upload(
          file,
          uploadKey.current,
          c.signal,
          setStatus,
        );
      let job = jobId;
      if (!job) {
        setStatus("创建识别任务");
        const created = await client.createJob(
          asset.current,
          jobKey.current,
          c.signal,
        );
        job = created.id;
        if (id !== run.current) return;
        setJobId(job);
      }
      setStatus("正在识别这一餐");
      const deadline = Date.now() + 180000;
      while (!c.signal.aborted && Date.now() < deadline) {
        const result = await client.job(job, c.signal);
        if (id !== run.current) return;
        if (result.status === "succeeded") {
          onRecognized({
            assetId: asset.current,
            jobId: job,
            items: result.items,
          });
          return;
        }
        if (result.status === "failed" || result.status === "canceled") {
          setStatus(result.status === "canceled" ? "识别已取消" : "识别未完成");
          throw Error(result.error?.message ?? "识别已取消，可选择手动记录");
        }
        await abortDelay(1500, c.signal);
      }
      if (!c.signal.aborted)
        setStatus("任务仍在处理中，可稍后查看；不会自动重新发起识别");
    } catch (e) {
      if (!c.signal.aborted && id === run.current) setError(messageOf(e));
    } finally {
      if (id === run.current) setBusy(false);
    }
  }
  async function cancel() {
    if (!jobId) return;
    try {
      const r = await client.cancelJob(jobId);
      run.current++;
      controller.current?.abort();
      setBusy(false);
      setStatus(
        r.status === "succeeded"
          ? "任务已完成，可查看结果"
          : "识别已取消，没有保存饮食记录",
      );
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <Dialog open={open} title="拍下你的这一餐" onClose={onClose}>
      <p className="nt-hint">拍照或从相册选择，核对识别结果后再保存。</p>
      <input
        ref={camera}
        className="nt-file"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍摄餐食照片"
        onChange={choose}
      />
      <input
        ref={album}
        className="nt-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="从相册选择餐食照片"
        onChange={choose}
      />
      {cameraState !== "idle" ? (
        <div className="nt-camera">
          {cameraState === "opening" ? (
            <p className="nt-hint" role="status">正在请求相机权限，请在浏览器提示中选择允许。也可以取消，改用相册。</p>
          ) : (
            <video ref={video} autoPlay playsInline muted aria-label="相机实时取景"
              onLoadedData={() => setVideoReady(true)} />
          )}
          <div className="nt-add-row">
            {cameraState !== "opening" && <button className="primary-button"
              disabled={!videoReady || cameraState === "capturing"} onClick={takePhoto}>
              <Camera size={17} /> {cameraState === "capturing" ? "正在拍摄" : "拍摄照片"}
            </button>}
            <button className="outline-button" onClick={stopCamera}>取消拍摄</button>
          </div>
        </div>
      ) : preview ? (
        <div className="nt-photo-preview">
          <img src={preview} alt="待确认的餐食照片，仅在本机预览" />
          <span>照片预览</span>
        </div>
      ) : (
        <div className="nt-photo-empty">
          <Camera size={38} />
          <h3>把这一餐，轻轻记下来</h3>
          <p>清晰拍下食物，尽量让整个餐盘入镜。</p>
        </div>
      )}
      <div className="nt-add-row">
        <button
          className="outline-button"
          disabled={busy || cameraState !== "idle"}
          onClick={openCamera}
        >
          <Camera size={17} /> {preview ? "重新拍摄" : "打开相机"}
        </button>
        <button
          className="outline-button"
          disabled={busy}
          onClick={() => { stopCamera(); album.current?.click(); }}
        >
          <ImagePlus size={17} /> 从相册选择
        </button>
      </div>
      <ol className="nt-photo-steps">
        <li className={preview ? "done" : "active"}>
          <span>1</span>拍照预览
        </li>
        <li className={busy ? "active" : ""}>
          <span>2</span>上传与识别
        </li>
        <li>
          <span>3</span>核对后保存
        </li>
      </ol>
      {(!capabilities.upload || !capabilities.recognition) && (
        <div className="nt-service-note">
          <ShieldCheck size={20} />
          <div>
            <strong>{capabilities.upload ? "本机识别模型尚未就绪" : "照片目前只在你的设备上预览"}</strong>
            <p>
              {capabilities.upload ? "请先启动本机视觉服务并完成模型下载，刷新后再试。现在可以先手动记录。" : "上传与AI识别服务尚未接入。现在可以先手动记录，照片不会随手动记录保存。"}
            </p>
          </div>
        </div>
      )}
      {capabilities.mode === "local_fixture" && capabilities.upload && capabilities.recognition && (
        <p className="nt-hint">照片上传到这台电脑，由本机模型识别。份量和营养是估算，核对确认后才会保存一餐。</p>
      )}
      {checking && <p className="nt-hint" role="status">正在检查上传与识别服务…</p>}
      {checkError && <p className="nt-error" role="alert">{checkError}</p>}
      {capabilities.mode === "local_fixture" && (!capabilities.upload || !capabilities.recognition || checkError) && (
        <button className="outline-button" disabled={checking || busy} onClick={() => setCheckAttempt((x) => x + 1)}>
          <RotateCcw size={16} /> 重新检查服务
        </button>
      )}
      {status && (
        <p className="nt-hint" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="nt-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button full-width"
        disabled={
          !file || busy || checking || !!checkError || cameraState !== "idle" || !capabilities.upload || !capabilities.recognition
        }
        onClick={recognize}
      >
        {busy ? (
          <LoaderCircle className="nt-spin" size={17} />
        ) : jobId ? (
          <RotateCcw size={17} />
        ) : (
          <ArrowRight size={17} />
        )}{" "}
        {checking ? "正在检查服务" : !capabilities.upload || !capabilities.recognition
          ? "上传与识别待接入"
          : busy
          ? status || "正在处理"
          : jobId
            ? "查看这次识别结果"
            : "上传并识别"}
      </button>
      {jobId && (
        <button className="text-link nt-centered" onClick={cancel}>
          取消这次识别
        </button>
      )}
      <button className="text-link nt-centered" onClick={onManual}>
        先手动记录这餐 <ArrowRight size={15} />
      </button>
      <p className="nt-hint nt-centered">关闭或取消不会自动保存一餐</p>
    </Dialog>
  );
}
