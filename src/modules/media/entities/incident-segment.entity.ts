import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { RecordingSegment } from "@/modules/media/entities/recording-segment.entity";

@Entity({ name: "incident_segments" })
export class IncidentSegment {
  @PrimaryColumn({ type: "uuid" })
  incidentId!: string;

  @ManyToOne(() => Incident, { onDelete: "CASCADE" })
  @JoinColumn({ name: "incident_id" })
  incident!: Incident;

  @PrimaryColumn({ type: "uuid" })
  segmentId!: string;

  @ManyToOne(() => RecordingSegment, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "segment_id" })
  segment!: RecordingSegment;
}
