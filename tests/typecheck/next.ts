import type { useRouter } from 'next/navigation.js';
import { createNextNavigation } from '@pagesquire/react/next';
export function connect(
  router: ReturnType<typeof useRouter>,
  document: Document,
) {
  return createNextNavigation(router, { document });
}
