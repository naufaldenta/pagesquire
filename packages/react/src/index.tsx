import { useEffect, useRef } from 'react';
import { mountWidget } from '@pagesquire/client';
import type { AssistantClient, WidgetOptions } from '@pagesquire/client';

export interface PageSquireWidgetProps extends WidgetOptions {
  client: AssistantClient;
  className?: string;
}

/** Keep client identity stable and mount in a persistent layout for SPA visits. */
export function PageSquireWidget({
  client,
  title,
  placeholder,
  className,
}: PageSquireWidgetProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    return mountWidget(host.current, client, {
      ...(title ? { title } : {}),
      ...(placeholder ? { placeholder } : {}),
    });
  }, [client, title, placeholder]);
  return <div ref={host} className={className} data-pagesquire-root="" />;
}
