import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, MinLength } from "class-validator";

export class RegisterDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: "password must be at least 8 characters" })
  password!: string;
}

export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ResendCodeDto {
  @IsEmail()
  email!: string;

  @IsIn(["email_verify", "password_reset"])
  purpose!: "email_verify" | "password_reset";
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class TwoFactorVerifyDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class RefreshDto {
  // The web app sends the refresh token in the httpOnly cookie "vg_rt".
  // Postman and mobile apps may send it in the body instead.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class PasswordConfirmDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
