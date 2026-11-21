import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "plans" })
export class Plan {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "integer" })
  priceMinor!: number;

  @Column({ type: "char", length: 3, default: "BDT" })
  currency!: string;

  @Column({ type: "smallint" })
  maxCameras!: number;

  @Column({ type: "smallint", nullable: true })
  maxMembers!: number | null;

  @Column({ type: "smallint", default: 0 })
  packSlots!: number;

  @Column({ type: "smallint" })
  recordingDays!: number;

  @Column({ type: "smallint", default: 180 })
  incidentRetentionDays!: number;

  @Column({ type: "boolean", default: true })
  isPublic!: boolean;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
