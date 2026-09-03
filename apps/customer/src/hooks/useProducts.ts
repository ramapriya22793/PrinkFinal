import { useState, useEffect } from 'react';
import { getProductsApi } from '../services/products.api';

export function useProducts() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    getProductsApi()
      .then((res) => setProducts(res.products || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return { products, loading };
}
