import { apiFetch } from './api';

export async function getOrdersApi() {
  return apiFetch('/orders');
}

export async function getOrderByIdApi(id: string) {
  return apiFetch(`/orders/${id}`);
}

export async function createOrderApi(orderData: Record<string, any>) {
  return apiFetch('/orders', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });
}
