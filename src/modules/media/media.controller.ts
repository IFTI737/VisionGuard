import { CurrentDevice, RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { DeviceAuthGuard, JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { Device } from "@/modules/device/entities/device.entity";
import { MediaService, SegmentMeta, SnapshotMeta } from "@/modules/media/media.service";
import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile,
  UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Response } from "express";

const parseMeta = <T>(raw: unknown): T => {
  try {
    const meta = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!meta?.cameraId) throw new Error();
    return meta as T;
  } catch {
    throw new BadRequestException('Form field "meta" must be JSON with at least cameraId');
  }
};

/** Uploads from devices: form-data with a file and a "meta" JSON field. */
@ApiTags("device api")
@SkipThrottle()
@UseGuards(DeviceAuthGuard)
@Controller("device")
export class DeviceMediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("snapshots")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 8 * 1024 * 1024 } }))
  async snapshot(@CurrentDevice() device: Device, @UploadedFile() file: { buffer: Buffer; mimetype: string }, @Body("meta") meta: string) {
    if (!file) throw new BadRequestException('Form field "image" (a file) is required');
    return await this.mediaService.saveSnapshot(device, parseMeta<SnapshotMeta>(meta), file);
  }

  @Post("segments")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("video", { limits: { fileSize: 100 * 1024 * 1024 } }))
  async segment(@CurrentDevice() device: Device, @UploadedFile() file: { buffer: Buffer; mimetype: string }, @Body("meta") meta: string) {
    if (!file) throw new BadRequestException('Form field "video" (a file) is required');
    return await this.mediaService.saveSegment(device, parseMeta<SegmentMeta>(meta), file);
  }
}

@ApiTags("media")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get("media/:mediaId/url")
  async url(@SiteCtx() ctx: SiteContext, @Param("mediaId", ParseUUIDPipe) mediaId: string) {
    return await this.mediaService.urlFor(ctx, mediaId);
  }

  @Get("snapshots")
  @RequirePermission("incidents.view")
  async snapshots(@SiteCtx() ctx: SiteContext, @Query("cameraId") cameraId?: string, @Query("incidentId") incidentId?: string) {
    return await this.mediaService.listSnapshots(ctx, { cameraId, incidentId });
  }

  @Get("incidents/:id/clip")
  @RequirePermission("recordings.view")
  async clip(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.mediaService.incidentClip(ctx, id);
  }

  @Get("cameras/:cameraId/recordings")
  @RequirePermission("recordings.view")
  async recordings(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string, @Query("from") from: string, @Query("to") to: string) {
    const fromDate = new Date(from), toDate = new Date(to);
    if (isNaN(+fromDate) || isNaN(+toDate) || toDate <= fromDate) throw new BadRequestException("from and to must be dates, with to after from");
    return await this.mediaService.cameraRecordings(ctx, cameraId, fromDate, toDate);
  }

  @Post("cameras/:cameraId/snapshot")
  @HttpCode(202)
  @RequirePermission("live.view")
  async requestSnapshot(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string) {
    return await this.mediaService.requestSnapshot(ctx, cameraId);
  }
}

/** The only route that returns file bytes. No login: the signed token in the URL is the permission, for 5 minutes. */
@ApiTags("media")
@SkipThrottle()
@Controller("media/content")
export class MediaContentController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(":token")
  async content(@Param("token") token: string, @Headers("range") range: string | undefined, @Res() res: Response) {
    const file = await this.mediaService.open(token, range);
    res.setHeader("Content-Type", file.media.mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // the web app runs on another origin
    if (file.range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${file.range.start}-${file.range.end}/${file.size}`);
      res.setHeader("Content-Length", file.range.end - file.range.start + 1);
    } else res.setHeader("Content-Length", file.size);
    file.stream.pipe(res);
  }
}
