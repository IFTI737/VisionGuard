import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import type { ObjectClassesKind } from "@/common/constants/check-values";

@Entity({ name: "object_classes" })
export class ObjectClass {
  @PrimaryColumn({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  kind!: ObjectClassesKind;

  @Column({ type: "text", nullable: true })
  parentCode!: string | null;

  @ManyToOne(() => ObjectClass, { onDelete: "SET NULL" })
  @JoinColumn({ name: "parent_code", referencedColumnName: "code" })
  parentCodeObjectClass!: ObjectClass | null;

  @Column({ type: "text" })
  nameEn!: string;

  @Column({ type: "text" })
  nameBn!: string;
}
