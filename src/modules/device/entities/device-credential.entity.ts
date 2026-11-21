import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Device } from "@/modules/device/entities/device.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "device_credentials" })
export class DeviceCredential {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  deviceId!: string;

  @ManyToOne(() => Device, { onDelete: "CASCADE" })
  @JoinColumn({ name: "device_id" })
  device!: Device;

  @Column({ type: "text" })
  keyPrefix!: string;

  @Column({ type: "bytea", select: false })
  keyHash!: Buffer;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
