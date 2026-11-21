import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { SitesKind, SitesMode, SitesStatus } from "@/common/constants/check-values";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "sites" })
export class Site {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text" })
  kind!: SitesKind;

  @Column({ type: "text", default: "Asia/Dhaka" })
  timezone!: string;

  @Column({ type: "text", nullable: true })
  address!: string | null;

  @Column({ type: "smallint", default: 2 })
  sensitivity!: number;

  @Column({ type: "text", default: "armed" })
  mode!: SitesMode;

  @Column({ type: "timestamptz", nullable: true })
  pausedUntil!: Date | null;

  @Column({ type: "time", default: "07:00:00" })
  digestTime!: string;

  @Column({ type: "boolean", default: false })
  shareTrainingData!: boolean;

  @Column({ type: "text", default: "active" })
  status!: SitesStatus;

  @Column({ type: "uuid", nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date | null;
}
