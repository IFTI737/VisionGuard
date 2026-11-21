import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import type { AuditLogsActorKind } from "@/common/constants/check-values";

@Entity({ name: "audit_logs" })
export class AuditLog {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "uuid", nullable: true })
  siteId!: string | null;

  @Column({ type: "text" })
  actorKind!: AuditLogsActorKind;

  @Column({ type: "uuid", nullable: true })
  actorId!: string | null;

  @Column({ type: "text" })
  action!: string;

  @Column({ type: "text", nullable: true })
  entityType!: string | null;

  @Column({ type: "uuid", nullable: true })
  entityId!: string | null;

  @Column({ type: "inet", nullable: true })
  ip!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  data!: any;
}
