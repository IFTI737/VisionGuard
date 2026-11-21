import { IRequest } from "@/common/interfaces/request.interface";
import { DeviceAuthService } from "@/modules/device/device-auth.service";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

/**
 * Devices (browser camera, simulator, gateway, the AI model process) do not
 * log in like people. They send:   Authorization: Device vgk_<prefix>_<secret>
 * A device key only works on /v1/device/*, and a user token never works there.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly deviceAuth: DeviceAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: IRequest = context.switchToHttp().getRequest();
    const header = req.headers.authorization || "";
    if (!header.startsWith("Device "))
      throw new UnauthorizedException("Missing device key (Authorization: Device vgk_...)");
    const device = await this.deviceAuth.verifyKey(header.slice(7).trim(), req.ip);
    if (!device) throw new UnauthorizedException("Invalid or revoked device key");
    req.device = device;
    return true;
  }
}
