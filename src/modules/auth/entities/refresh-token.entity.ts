import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import type { RefreshTokensRevokeReason } from "@/common/constants/check-values";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "refresh_tokens" })
export class RefreshToken {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "uuid" })
  familyId!: string;

  @Column({ type: "bytea", select: false })
  tokenHash!: Buffer;

  @Column({ type: "uuid", nullable: true })
  replacedBy!: string | null;

  @ManyToOne(() => RefreshToken, { onDelete: "SET NULL" })
  @JoinColumn({ name: "replaced_by" })
  replacedByRefreshToken!: RefreshToken | null;

  @Column({ type: "text", nullable: true })
  userAgent!: string | null;

  @Column({ type: "inet", nullable: true })
  ip!: string | null;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  revokeReason!: RefreshTokensRevokeReason | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;
}
