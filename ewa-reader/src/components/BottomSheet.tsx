import type { PropsWithChildren } from 'react';
import { Button } from './Button';

interface BottomSheetProps {
  title: string;
  onClose: () => void;
  closeLabel: string;
}

export function BottomSheet({ title, onClose, closeLabel, children }: PropsWithChildren<BottomSheetProps>) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>{closeLabel}</Button>
        </header>
        <div className="sheet-content">{children}</div>
      </section>
    </div>
  );
}
