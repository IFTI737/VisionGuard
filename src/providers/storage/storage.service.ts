import { appConfig } from "@/config/app.config";
import { Injectable } from "@nestjs/common";
import { createReadStream, promises as fs } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Where snapshot images and video segments are kept.
 * Local folder now (STORAGE_DIR, outside any public folder). Moving to
 * Cloudflare R2 or S3 later means writing a second class with these same
 * four methods; nothing else in the code touches files directly.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(process.cwd(), appConfig.env.STORAGE_DIR);

  private pathOf(objectKey: string): string {
    const full = resolve(this.root, objectKey);
    if (!full.startsWith(this.root)) throw new Error("Bad object key");
    return full;
  }

  async put(objectKey: string, data: Buffer): Promise<void> {
    const full = this.pathOf(objectKey);
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async size(objectKey: string): Promise<number> {
    return (await fs.stat(this.pathOf(objectKey))).size;
  }

  stream(objectKey: string, range?: { start: number; end: number }) {
    return createReadStream(this.pathOf(objectKey), range);
  }

  async remove(objectKey: string): Promise<void> {
    await fs.rm(this.pathOf(objectKey), { force: true });
  }

  /** e.g. sites/<siteId>/snapshots/2026-11-16/<id>.jpg */
  static key(siteId: string | null, folder: string, fileName: string): string {
    const day = new Date().toISOString().slice(0, 10);
    return join(siteId ? `sites/${siteId}` : "platform", folder, day, fileName).replace(/\\/g, "/");
  }
}
