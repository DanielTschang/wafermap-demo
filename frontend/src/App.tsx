import './App.css'
import { useState, useMemo } from 'react'
import { useWaferData }                        from './hooks/useWaferData.ts'
import { prepareWaferArrays, buildColorArray } from './utils/colormap.ts'
import WaferMapView                            from './components/WaferMapView.tsx'
import ColorBar                                from './components/ColorBar.tsx'
import DieInfoPanel                            from './components/DieInfoPanel.tsx'
import type { SelectedDie }                    from './components/DieInfoPanel.tsx'

export default function App() {
  const [colorMin, setColorMin]       = useState(0)
  const [colorMax, setColorMax]       = useState(50)
  const [selectedDie, setSelectedDie] = useState<SelectedDie | null>(null)

  const { data, loading, error } = useWaferData(500000)

  const waferArrays = useMemo(() => {
    if (!data) return null
    return prepareWaferArrays(data)
  }, [data])

  const colors = useMemo(() => {
    if (!data) return null
    return buildColorArray(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  if (loading) return <div className="status">Loading wafer data…</div>
  if (error)   return <div className="status error">Error: {error}</div>
  if (!waferArrays || !colors) return null

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={waferArrays.n}
          positions={waferArrays.positions}
          colors={colors}
          arrowSources={waferArrays.arrowSources}
          arrowTargets={waferArrays.arrowTargets}
          data={data!}
          onDieClick={setSelectedDie}
        />
      </div>
      <div className="sidebar">
        <ColorBar
          colorMin={colorMin}
          colorMax={colorMax}
          onMinChange={setColorMin}
          onMaxChange={setColorMax}
        />
        <DieInfoPanel selectedDie={selectedDie} data={data!} />
      </div>
    </div>
  )
}
