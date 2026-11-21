import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Area } from "@/modules/site/entities/area.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "member_area_scopes" })
export class MemberAreaScope {
  @Column({ type: "uuid" })
  siteId!: string;

  @PrimaryColumn({ type: "uuid" })
  memberId!: string;

  @ManyToOne(() => SiteMember, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member!: SiteMember;

  @PrimaryColumn({ type: "uuid" })
  areaId!: string;

  @ManyToOne(() => Area, { onDelete: "CASCADE" })
  @JoinColumn({ name: "area_id" })
  area!: Area;
}
