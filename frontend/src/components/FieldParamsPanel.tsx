import { useState } from 'react'
import type { FieldParams } from '../hooks/useWaferData.ts'

interface FieldParamsPanelProps {
  params: FieldParams
  onApply: (params: FieldParams) => void
}

export default function FieldParamsPanel({ params, onApply }: FieldParamsPanelProps) {
  const [draft, setDraft] = useState<FieldParams>(params)

  function set(key: keyof FieldParams, raw: string) {
    const v = parseFloat(raw)
    if (!isNaN(v)) setDraft(prev => ({ ...prev, [key]: v }))
  }

  return (
    <div style={styles.container}>
      <div style={styles.label}>FIELD PARAMS</div>
      <div style={styles.grid}>
        <NumInput label="Size X (mm)"   value={draft.fieldSizeX}   onChange={v => set('fieldSizeX',   v)} />
        <NumInput label="Size Y (mm)"   value={draft.fieldSizeY}   onChange={v => set('fieldSizeY',   v)} />
        <NumInput label="Offset X (mm)" value={draft.fieldOffsetX} onChange={v => set('fieldOffsetX', v)} />
        <NumInput label="Offset Y (mm)" value={draft.fieldOffsetY} onChange={v => set('fieldOffsetY', v)} />
      </div>
      <button style={styles.btn} onClick={() => onApply(draft)}>Apply</button>
    </div>
  )
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={styles.inputLabel}>{label}</div>
      <input
        type="number"
        step="0.5"
        defaultValue={value}
        key={value}
        onChange={e => onChange(e.target.value)}
        style={styles.input}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1e1e36',
    borderRadius: 6,
    padding: '12px 10px',
  },
  label: {
    fontSize: 9,
    color: '#888',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  grid: { marginBottom: 8 },
  inputLabel: { fontSize: 10, color: '#888', marginBottom: 2 },
  input: {
    width: '100%',
    background: '#13132a',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#ccc',
    fontSize: 11,
    padding: '3px 6px',
    boxSizing: 'border-box',
  },
  btn: {
    width: '100%',
    background: '#2a4a7f',
    border: 'none',
    borderRadius: 4,
    color: '#ccc',
    fontSize: 11,
    padding: '5px 0',
    cursor: 'pointer',
  },
}
