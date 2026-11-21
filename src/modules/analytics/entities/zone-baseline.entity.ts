import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { Zone } from "@/modules/camera/entities/zone.entity";

@Entity({ name: "zone_baselines" })
export class ZoneBaseline {
  @PrimaryColumn({ type: "uuid" })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: "CASCADE" })
  @JoinColumn({ name: "zone_id" })
  zone!: Zone;

  @PrimaryColumn({ type: "text" })
  metricKey!: string;

  @PrimaryColumn({ type: "smallint" })
  hourOfWeek!: number;

  @Column({ type: "smallint" })
  nWeeks!: number;

  @Column({ type: "real" })
  median!: number;

  @Column({ type: "real" })
  mad!: number;

  @Column({ type: "real" })
  mean!: number;

  @Column({ type: "real" })
  std!: number;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
