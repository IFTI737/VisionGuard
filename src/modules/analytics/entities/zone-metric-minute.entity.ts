import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Zone } from "@/modules/camera/entities/zone.entity";

@Entity({ name: "zone_metric_minutes" })
export class ZoneMetricMinute {
  @Column({ type: "uuid" })
  siteId!: string;

  @PrimaryColumn({ type: "uuid" })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: "CASCADE" })
  @JoinColumn({ name: "zone_id" })
  zone!: Zone;

  @PrimaryColumn({ type: "text" })
  metricKey!: string;

  @PrimaryColumn({ type: "timestamptz" })
  bucket!: Date;

  @Column({ type: "smallint" })
  n!: number;

  @Column({ type: "double precision" })
  sum!: number;

  @Column({ type: "real" })
  min!: number;

  @Column({ type: "real" })
  max!: number;

  @Column({ type: "double precision" })
  sumsq!: number;
}
