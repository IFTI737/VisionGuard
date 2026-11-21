export interface AuthUser {
  id: string;
  email?: string;
  roles: string[]; // [platform role]
  jti: string; // id of the access token, used by logout
  exp: number; // expiry of the access token (epoch seconds)
}
