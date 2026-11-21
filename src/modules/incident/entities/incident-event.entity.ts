import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { IncidentEventsType } from "@/common/constants/check-values";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "incident_events" })
export class IncidentEvent {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id!: string;

  @Column({ type: "uuid" })
  incidentId!: string;

  @ManyToOne(() => Incident, { onDelete: "CASCADE" })
  @JoinColumn({ name: "incident_id" })
  incident!: Incident;

  @Column({ type: "text" })
  type!: IncidentEventsType;

  @Column({ type: "uuid", nullable: true })
  actorMemberId!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_member_id" })
  actorMember!: SiteMember | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  data!: any;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
