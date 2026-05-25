import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

const fieldBase =
  "h-9 w-full rounded-md border bg-[var(--card)] px-3 text-sm text-[var(--fg)] " +
  "border-[var(--border)] placeholder:text-[var(--muted)] " +
  "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent " +
  "transition-colors";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(fieldBase, "appearance-none pr-8 cursor-pointer", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.6rem center",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "muted" | "new";
  className?: string;
}) {
  const variants: Record<string, string> = {
    default: "border-[var(--border)] text-[var(--fg)] bg-[var(--accent)]",
    muted: "border-[var(--border)] text-[var(--muted)] bg-transparent",
    new: "border-transparent text-white bg-emerald-600 dark:bg-emerald-500",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  onClick,
  className,
  as: As = "div",
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  as?: "div" | "a";
  href?: string;
}) {
  const cls = cn(
    "block rounded-xl border bg-[var(--card)] border-[var(--border)] p-4 text-left",
    "transition-all hover:border-[var(--ring)]/40 hover:shadow-sm",
    onClick || href ? "cursor-pointer" : "",
    className,
  );
  if (As === "a") {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <div className={cls} onClick={onClick}>
      {children}
    </div>
  );
}
