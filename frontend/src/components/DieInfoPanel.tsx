import { useMemo } from 'react'

export interface SelectedDie {
  interX: number
  interY: number
}

interface DieStats {
  count: number
  avgMag: number
  maxMag: number
  avgOvlX: number
  avgOvlY: number
}

function computeDieStats(data: Float32Array, interX: number, interY: number): DieStats | null {
  let count = 0, sumMag = 0, maxMag = 0, sumOvlX = 0, sumOvlY = 0
  const n = data.length / 6
  for (let i = 0; i < n; i++) {
    if (data[i * 6] === interX && data[i * 6 + 1] === interY) {
      const ovlX = data[i * 6 + 4]
      const ovlY = data[i * 6 + 5]
      const mag  = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
      count++
      sumMag  += mag
      maxMag   = Math.max(maxMag, mag)
      sumOvlX += ovlX
      sumOvlY += ovlY
    }
  }
  if (count === 0) return null
  return {
    count,
    avgMag:  sumMag  / count,
    maxMag,
    avgOvlX: sumOvlX / count,
    avgOvlY: sumOvlY / count,
  }
}

interface DieInfoPanelProps {
  selectedDie: SelectedDie | null
  data: Float32Array
}

export default function DieInfoPanel({ selectedDie, data }: DieInfoPanelProps) {
  const stats = useMemo(() => {
    if (!selectedDie) return null
    return computeDieStats(data, selectedDie.interX, selectedDie.interY)
  }, [selectedDie, data])

  if (!selectedDie) {
    return (
      <div style={styles.container}>
        <div style={styles.label}>SELECTED DIE</div>
        <div style={styles.empty}>Click a point to select its die</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.label}>SELECTED DIE</div>
      <div style={styles.dieName}>
        Die ({selectedDie.interX.toFixed(1)}, {selectedDie.interY.toFixed(1)}) mm
      </div>
      {stats && (
        <div style={styles.stats}>
          <Row label="Points"    value={stats.count} />
          <Row label="Avg |ovl|" value={`${stats.avgMag.toFixed(1)} nm`} />
          <Row label="Max |ovl|" value={`${stats.maxMag.toFixed(1)} nm`} />
          <Row label="Avg ovlX"  value={`${stats.avgOvlX.toFixed(1)} nm`} />
          <Row label="Avg ovlY"  value={`${stats.avgOvlY.toFixed(1)} nm`} />
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1e1e36',
    borderRadius: 6,
    padding: '12px 10px',
    flex: 1,
  },
  label: {
    fontSize: 9,
    color: '#888',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  empty: {
    fontSize: 10,
    color: '#555',
    fontStyle: 'italic',
  },
  dieName: {
    fontSize: 11,
    color: '#4a9eff',
    marginBottom: 10,
  },
  stats: { marginTop: 4 },
  rowLabel: { fontSize: 10, color: '#888' },
  rowValue: { fontSize: 10, color: '#ccc' },
}
