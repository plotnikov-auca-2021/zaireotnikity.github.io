import type { SelectHTMLAttributes, PropsWithChildren } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

export function Select({ label, children, ...props }: PropsWithChildren<SelectProps>) {
  return (
    <label className="field">
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}
