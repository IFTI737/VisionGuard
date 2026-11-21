// Platform roles (users.platform_role). Site roles (owner, manager, guard...)
// are a different thing: they live in site_members.role.
export enum Role {
  CUSTOMER = "customer",
  SUPPORT = "support",
  ADMIN = "admin",
}
