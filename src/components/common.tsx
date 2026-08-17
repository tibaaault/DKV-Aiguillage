import { useCallback, useRef, useState, type ReactNode } from 'react';

export const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
export const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function num(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return decimals ? nf2.format(value) : nf.format(value);
}

interface DropZoneProps {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  icon?: string;
}

/** Zone de depot acceptant le glisser-deposer et le clic. */
export function DropZone({ label, hint, accept, multiple, onFiles, icon = '📄' }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
    >
      <span className="icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{label}</strong>
      <small>{hint}</small>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Card({
  title,
  hint,
  actions,
  children,
  flush,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      <header>
        <div>
          <h2>{title}</h2>
          {hint && <p className="hint">{hint}</p>}
        </div>
        {actions && <div className="spacer" style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </header>
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      {children && <p style={{ maxWidth: '60ch', margin: '8px auto 0' }}>{children}</p>}
    </div>
  );
}

/** Champ numerique inline, valide a la sortie du champ. */
export function NumberCell({
  value,
  placeholder,
  edited,
  onCommit,
}: {
  value: number | null;
  placeholder: number | null;
  edited: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value != null ? String(value) : '');

  return (
    <input
      className={`cell-input${edited ? ' edited' : ''}`}
      value={shown}
      placeholder={placeholder != null ? nf.format(placeholder) : ''}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft == null) return;
        const trimmed = draft.trim().replace(/\s/g, '').replace(',', '.');
        setDraft(null);
        if (trimmed === '') {
          onCommit(null);
          return;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
