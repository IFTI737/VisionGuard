import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { AuthCodesChannel, AuthCodesPurpose } from "@/common/constants/check-values";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "auth_codes" })
export class AuthCode {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text" })
  purpose!: AuthCodesPurpose;

  @Column({ type: "text" })
  channel!: AuthCodesChannel;

  @Column({ type: "text" })
  target!: string;

  @Column({ type: "bytea", select: false })
  codeHash!: Buffer;

  @Column({ type: "smallint", default: 0 })
  attempts!: number;

  @Column({ type: "smallint", default: 5 })
  maxAttempts!: number;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
