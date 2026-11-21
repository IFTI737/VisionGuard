import { AuthController } from "@/modules/auth/auth.controller";
import { AuthService } from "@/modules/auth/auth.service";
import { CodeService } from "@/modules/auth/code.service";
import { AuthCode } from "@/modules/auth/entities/auth-code.entity";
import { RefreshToken } from "@/modules/auth/entities/refresh-token.entity";
import { JwtStrategy } from "@/modules/auth/strategies/jwt.strategy";
import { RefreshJwtStrategy } from "@/modules/auth/strategies/refresh-jwt.strategy";
import { TokenService } from "@/modules/auth/token.service";
import { User } from "@/modules/user/entities/user.entity";
import { UserModule } from "@/modules/user/user.module";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, AuthCode]),
    PassportModule,
    JwtModule.register({}), // secrets are passed on each sign/verify call
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CodeService, TokenService, JwtStrategy, RefreshJwtStrategy],
  exports: [TokenService, JwtModule],
})
export class AuthModule {}
