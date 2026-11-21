import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { UsersLocale, UsersPlatformRole, UsersStatus } from "@/common/constants/check-values";

@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text" })
  email!: string;

  @Column({ type: "timestamptz", nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  phoneNumber!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  phoneVerifiedAt!: Date | null;

  @Column({ type: "text", select: false })
  passwordHash!: string;

  @Column({ type: "boolean", default: false })
  twoFactorEnabled!: boolean;

  @Column({ type: "integer", default: 0 })
  tokenVersion!: number;

  @Column({ type: "text", default: "customer" })
  platformRole!: UsersPlatformRole;

  @Column({ type: "text", default: "active" })
  status!: UsersStatus;

  @Column({ type: "text", default: "bn" })
  locale!: UsersLocale;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
