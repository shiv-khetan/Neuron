import * as React from 'react';
import { cn } from '@/lib/utils';

// shadcn's Typography is a documentation set of prose styles, not a registry
// component — these are the canonical styles as reusable elements.

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;
type TextProps = React.HTMLAttributes<HTMLParagraphElement>;

export const TypographyH1 = ({ className, ...props }: HeadingProps) => (
  <h1 className={cn('scroll-m-20 text-4xl font-extrabold tracking-tight text-balance', className)} {...props} />
);
export const TypographyH2 = ({ className, ...props }: HeadingProps) => (
  <h2 className={cn('scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0', className)} {...props} />
);
export const TypographyH3 = ({ className, ...props }: HeadingProps) => (
  <h3 className={cn('scroll-m-20 text-2xl font-semibold tracking-tight', className)} {...props} />
);
export const TypographyH4 = ({ className, ...props }: HeadingProps) => (
  <h4 className={cn('scroll-m-20 text-xl font-semibold tracking-tight', className)} {...props} />
);
export const TypographyP = ({ className, ...props }: TextProps) => (
  <p className={cn('leading-7 [&:not(:first-child)]:mt-6', className)} {...props} />
);
export const TypographyLead = ({ className, ...props }: TextProps) => (
  <p className={cn('text-xl text-muted-foreground', className)} {...props} />
);
export const TypographyLarge = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('text-lg font-semibold', className)} {...props} />
);
export const TypographySmall = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
  <small className={cn('text-sm font-medium leading-none', className)} {...props} />
);
export const TypographyMuted = ({ className, ...props }: TextProps) => (
  <p className={cn('text-sm text-muted-foreground', className)} {...props} />
);
export const TypographyBlockquote = ({ className, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
  <blockquote className={cn('mt-6 border-l-2 pl-6 italic', className)} {...props} />
);
export const TypographyList = ({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
  <ul className={cn('my-6 ml-6 list-disc [&>li]:mt-2', className)} {...props} />
);
export const TypographyInlineCode = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
  <code className={cn('relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold', className)} {...props} />
);
