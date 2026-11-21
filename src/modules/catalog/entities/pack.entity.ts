import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { PacksStatus } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "packs" })
export class Pack {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "uuid", nullable: true })
  customSiteId!: string | null;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "custom_site_id" })
  customSite!: Site | null;

  @Column({ type: "integer", default: 0 })
  addonPriceMinor!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  manifest!: any;

  @Column({ type: "text", default: "active" })
  status!: PacksStatus;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
