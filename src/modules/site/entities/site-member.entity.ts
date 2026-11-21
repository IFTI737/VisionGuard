import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { SiteMembersRole, SiteMembersStatus } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "site_members" })
export class SiteMember {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid", nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User | null;

  @Column({ type: "text" })
  role!: SiteMembersRole;

  @Column({ type: "text", default: "active" })
  status!: SiteMembersStatus;

  @Column({ type: "text" })
  displayName!: string;

  @Column({ type: "text", nullable: true })
  phone!: string | null;

  @Column({ type: "text", array: true, default: () => "'{}'::text[]" })
  permissions!: string[];

  @Column({ type: "boolean", default: true })
  allAreas!: boolean;

  @Column({ type: "smallint", nullable: true })
  callPriority!: number | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  notifyPrefs!: any;

  @Column({ type: "uuid", nullable: true })
  invitedBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by" })
  invitedBySiteMember!: SiteMember | null;

  @Column({ type: "bytea", nullable: true, select: false })
  inviteTokenHash!: Buffer | null;

  @Column({ type: "timestamptz", nullable: true })
  invitedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  joinedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
