// Sesión del panel de administración — un solo lugar que sabe dónde vive el
// token y cómo leer quién es el usuario.
//
// OJO: leer el payload del JWT acá NO es una verificación de seguridad (no
// valida la firma, cualquiera puede editar su localStorage). Sirve solo para
// decidir qué mostrar en la UI: "Iniciar sesión" vs el nombre del usuario.
// Quien manda de verdad es el backend, que valida el token en cada request y
// responde 401 si no sirve — ahí AdminApp cierra la sesión y vuelve al login.

export const ADMIN_TOKEN_KEY = 'inout_admin_token'

export interface AdminSession {
  username: string
  role: string
}

export function getAdminSession(): AdminSession | null {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (!token) return null
  try {
    // base64url → base64 antes de decodificar (atob no acepta -/_).
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    )
    // Token vencido: tratarlo como "sin sesión" en la UI, sin esperar a que
    // el backend lo rechace — evita mostrar un nombre de usuario que ya no
    // puede hacer nada.
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    if (typeof payload.sub !== 'string') return null
    return {
      username: payload.sub,
      role: typeof payload.role === 'string' ? payload.role : '',
    }
  } catch {
    return null
  }
}

export function clearAdminSession(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY)
}
