import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { MediaKind, MediaStatus, MediaStorage } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "media" })
export class Media {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", nullable: true })
  siteId!: string | null;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site | null;

  @Column({ type: "text" })
  kind!: MediaKind;

  @Column({ type: "text" })
  storage!: MediaStorage;

  @Column({ type: "text" })
  objectKey!: string;

  @Column({ type: "text" })
  mime!: string;

  @Column({ type: "bigint" })
  bytes!: string;

  @Column({ type: "text", default: "ready" })
  status!: MediaStatus;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;
}
