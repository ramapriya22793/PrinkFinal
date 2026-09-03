import { apiFetch } from './api';

export async function loginApi(email: string, password: string) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function registerApi(userData: Record<string, any>) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

export async function getProfileApi() {
  return apiFetch('/auth/me');
}
