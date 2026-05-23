import React from 'react';
import { cn } from '../../lib/utils';

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-obsidian-border bg-obsidian-surface p-4',
      className
    )}
    {...props}
  />
));

Card.displayName = 'Card';
