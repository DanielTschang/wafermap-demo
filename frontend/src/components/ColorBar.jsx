import { interpolateViridis } from 'd3-scale-chromatic'

const GRADIENT = (() => {
  const stops = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9
    return `${interpolateViridis(t)} ${(t * 100).toFixed(0)}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
})()

export default function ColorBar({ colorMin, colorMax, onMinChange, onMaxChange }) {
  return (
    <div style={styles.container}>
      <div style={styles.label}>OVERLAY MAGNITUDE (nm)</div>

      <div style={{ ...styles.gradient, background: GRADIENT }} />

      <div style={styles.rangeRow}>
        <span style={styles.value}>{colorMin.toFixed(0)}</span>
        <span style={styles.value}>{colorMax.toFixed(0)}</span>
      </div>

      <div style={styles.sliderGroup}>
        <label style={styles.sliderLabel}>Min</label>
        <input
          type="range"
          min={0} max={colorMax - 1} step={1}
          value={colorMin}
          onChange={e => onMinChange(Number(e.target.value))}
          style={styles.slider}
        />
      </div>

      <div style={styles.sliderGroup}>
        <label style={styles.sliderLabel}>Max</label>
        <input
          type="range"
          min={colorMin + 1} max={200} step={1}
          value={colorMax}
          onChange={e => onMaxChange(Number(e.target.value))}
          style={styles.slider}
        />
      </div>
    </div>
  )
}

const styles = {
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
  gradient: {
    height: 12,
    borderRadius: 3,
    marginBottom: 4,
  },
  rangeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  value: {
    fontSize: 10,
    color: '#aaa',
  },
  sliderGroup: {
    marginBottom: 6,
  },
  sliderLabel: {
    fontSize: 10,
    color: '#888',
    display: 'block',
    marginBottom: 2,
  },
  slider: {
    width: '100%',
    accentColor: '#4a9eff',
  },
}
