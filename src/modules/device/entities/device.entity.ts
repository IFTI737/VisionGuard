import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { DevicesKind, DevicesStatus, DevicesTimeMode } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "devices" })
export class Device {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "text" })
  kind!: DevicesKind;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "pending" })
  status!: DevicesStatus;

  @Column({ type: "text", default: "wall" })
  timeMode!: DevicesTimeMode;

  @Column({ type: "text", nullable: true })
  swVersion!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  capabilities!: any;

  @Column({ type: "integer", default: 1 })
  configVersion!: number;

  @Column({ type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: "inet", nullable: true })
  lastIp!: string | null;

  @Column({ type: "uuid", nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
