import { apiFetch } from './api';

export async function getProductsApi() {
  return apiFetch('/products');
}

export async function getSKUsApi() {
  return apiFetch('/skus');
}
