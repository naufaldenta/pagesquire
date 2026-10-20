'use client';
import { useEffect } from 'react';
export default function Ready() {
  useEffect(() => {
    window.nextDemo?.navigation.committed(location.href);
  }, []);
  return null;
}
