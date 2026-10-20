/** 本机开发媒体适配；只装配隔离开发库，生产由M01实现MediaPort。 */
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import sharp from "sharp";
import type { MediaPort, MediaAccessInput, SqlTx, CommandContext } from "../../../../contracts/shared-types.js";
import { fail, keys, object, uuid } from "../domain.js";
import { LocalRuntime, projectRoot } from "./runtime.js";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const directory = `${projectRoot}/.local/meal-photos`;
const mime = new Map([["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"]] as const);
type Asset = Record<string, any>;
export class LocalMedia implements MediaPort {
  constructor(private runtime: LocalRuntime) {}
  async initialize() { await mkdir(directory, { recursive: true, mode: 0o700 }); }
  async asset(tx: SqlTx, id: string, owner?: string): Promise<Asset> {
    const [asset] = await tx.query<Asset>(
      `SELECT * FROM media_assets WHERE id=? AND purpose='meal_photo'${owner ? " AND user_id=?" : ""}`,
      owner ? [uuid(id), owner] : [uuid(id)],
    );
    if (!asset) fail("NOT_FOUND", "照片不存在或不属于当前账号", 404);
    return asset;
  }
  async assertReady(tx: SqlTx, input: MediaAccessInput) {
    if (input.access !== "owner" || input.purpose !== "meal_photo") fail("FORBIDDEN", "本机媒体仅支持本人餐照", 403);
    const asset = await this.asset(tx, input.assetId, input.actorUserId);
    if (asset.status !== "ready") fail("ASSET_NOT_READY", "照片尚未通过校验", 422);
    return { assetId: asset.id, userId: asset.user_id, purpose: "meal_photo" as const, contentType: asset.content_type, sizeBytes: Number(asset.size_bytes) };
  }
  token(id: string, owner: string, action: string, expiry: number) {
    return `${owner}.${expiry}.${this.runtime.sign(`media:${action}:${id}:${owner}:${expiry}`)}`;
  }
  authorize(id: string, action: string, token: string) {
    uuid(id);
    const parts = token.split(".");
    if (parts.length !== 3) fail("INVALID_MEDIA_TOKEN", "照片链接无效或已过期", 403);
    const [owner, expiry, signature] = parts;
    uuid(owner);
    const expected = Buffer.from(this.runtime.sign(`media:${action}:${id}:${owner}:${expiry}`));
    const actual = Buffer.from(signature);
    if (!Number.isFinite(Number(expiry)) || Number(expiry) <= Date.now() || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      fail("INVALID_MEDIA_TOKEN", "照片链接无效或已过期", 403);
    return owner;
  }
  async createReadUrl(input: MediaAccessInput & { expiresInSeconds?: number }) {
    await this.runtime.readSnapshot((tx) => this.assertReady(tx, input));
    const expiry = Date.now() + Math.min(input.expiresInSeconds ?? 300, 300) * 1000;
    return {
      assetId: input.assetId,
      readUrl: `/api/v1/uploads/${input.assetId}/content?token=${this.token(input.assetId, input.actorUserId!, "read", expiry)}`,
      readUrlExpiresAt: new Date(expiry).toISOString(),
    };
  }
  async presign(tx: SqlTx, ctx: CommandContext, body: unknown) {
    const b = object(body);
    keys(b, ["purpose", "filename", "contentType", "sizeBytes", "checksumSha256"]);
    if (b.purpose !== "meal_photo" || typeof b.filename !== "string" || !b.filename.length || b.filename.length > 150 || typeof b.contentType !== "string" || !mime.has(b.contentType as any))
      fail("INVALID_PHOTO", "只支持JPG、PNG、WebP餐照", 422);
    if (!Number.isInteger(b.sizeBytes) || Number(b.sizeBytes) <= 0 || Number(b.sizeBytes) > MAX_PHOTO_BYTES || typeof b.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/.test(b.checksumSha256))
      fail("INVALID_PHOTO", "照片大小或摘要不正确，需不超过10MB", 422);
    const id = randomUUID(), expiry = Date.parse(ctx.operationNow) + 900000;
    await tx.execute("INSERT INTO media_assets (id,user_id,purpose,bucket,object_key,content_type,size_bytes,checksum_sha256,expires_at) VALUES (?,?,'meal_photo','m03-local',?,?,?,?,?)",
      [id, ctx.userId, `${id}.original`, b.contentType, Number(b.sizeBytes), b.checksumSha256, new Date(expiry)]);
    return { assetId: id, method: "PUT", uploadUrl: `/api/v1/uploads/${id}/binary?token=${this.token(id, ctx.userId, "write", expiry)}`,
      requiredHeaders: { "Content-Type": b.contentType }, maxSizeBytes: MAX_PHOTO_BYTES, expiresAt: new Date(expiry).toISOString() };
  }
  async receive(id: string, token: string, bytes: Buffer, contentType: string) {
    const owner = this.authorize(id, "write", token);
    const asset = await this.runtime.readSnapshot((tx) => this.asset(tx, id, owner));
    if (!Buffer.isBuffer(bytes) || bytes.length !== Number(asset.size_bytes) || bytes.length > MAX_PHOTO_BYTES || contentType !== asset.content_type || createHash("sha256").update(bytes).digest("hex") !== asset.checksum_sha256)
      fail("INVALID_PHOTO", "照片内容、类型或摘要与上传声明不一致", 422);
    if (asset.status === "validating" || asset.status === "ready") return;
    if (asset.status !== "pending" || new Date(asset.expires_at).getTime() < Date.now()) fail("UPLOAD_EXPIRED", "上传已失效，请重新选择照片", 409);
    let safe: Buffer;
    try {
      const image = sharp(bytes, { limitInputPixels: 40000000, failOn: "error", animated: false });
      const metadata = await image.metadata();
      if (metadata.format !== mime.get(contentType as any) || (metadata.pages ?? 1) > 1) throw Error("format");
      safe = await image.rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).toBuffer();
    } catch {
      await this.runtime.runForUser(owner, (tx) => tx.execute("UPDATE media_assets SET status='rejected',error_code='INVALID_IMAGE' WHERE id=? AND status='pending'", [id]));
      fail("INVALID_IMAGE", "无法读取照片，请重新拍摄或换一张有效图片", 422);
    }
    const temporary = `${directory}/${id}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, safe!, { mode: 0o600, flag: "wx" });
      await rename(temporary, `${directory}/${id}.safe`);
      await this.runtime.runForUser(owner, (tx) => tx.execute("UPDATE media_assets SET status='validating',safe_object_key=? WHERE id=? AND user_id=? AND status='pending'", [`${id}.safe`, id, owner]));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async complete(tx: SqlTx, owner: string, id: string, body: unknown) {
    const b = object(body); keys(b, ["checksumSha256"]);
    const asset = await this.asset(tx, id, owner);
    if (b.checksumSha256 !== asset.checksum_sha256) fail("CHECKSUM_MISMATCH", "照片摘要不一致", 422);
    if (!["validating", "ready"].includes(asset.status)) fail("ASSET_NOT_READY", "请先完成照片上传与校验", 422);
    await tx.execute("UPDATE media_assets SET status='ready',expires_at=NULL WHERE id=? AND user_id=? AND status='validating'", [id, owner]);
    return { assetId: id, status: "ready" };
  }
  async content(id: string, token: string) {
    const owner = this.authorize(id, "read", token);
    const asset = await this.runtime.readSnapshot(async (tx) => {
      await this.assertReady(tx, { assetId: id, actorUserId: owner, purpose: "meal_photo", access: "owner" });
      return this.asset(tx, id, owner);
    });
    return { bytes: await readFile(`${directory}/${uuid(id)}.safe`), contentType: asset.content_type as string };
  }
}
