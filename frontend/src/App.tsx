import './App.css'
import { useState, useMemo } from 'react'
import { useWaferData }                                         from './hooks/useWaferData.ts'
import type { FieldParams }                                     from './hooks/useWaferData.ts'
import { prepareWaferArrays, buildColorArray, buildArrowPolygons } from './utils/colormap.ts'
import WaferMapView                                             from './components/WaferMapView.tsx'
import ColorBar                                                 from './components/ColorBar.tsx'
import DieInfoPanel                                             from './components/DieInfoPanel.tsx'
import type { SelectedDie }                                     from './components/DieInfoPanel.tsx'
import FieldParamsPanel                                         from './components/FieldParamsPanel.tsx'

const DEFAULT_FIELD_PARAMS: FieldParams = {
  fieldSizeX: 25.8,
  fieldSizeY: 32.5,
  fieldOffsetX: 0,
  fieldOffsetY: 6.101,
}

export default function App() {
  const [colorMin, setColorMin]       = useState(0)
  const [colorMax, setColorMax]       = useState(50)
  const [selectedDie, setSelectedDie] = useState<SelectedDie | null>(null)
  const [fieldParams, setFieldParams] = useState<FieldParams>(DEFAULT_FIELD_PARAMS)

  const { data, loading, error } = useWaferData(500000, fieldParams)

  const waferArrays = useMemo(() => {
    if (!data) return null
    return prepareWaferArrays(data)
  }, [data])

  const colors = useMemo(() => {
    if (!data) return null
    return buildColorArray(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  const arrowPolygons = useMemo(() => {
    if (!data) return null
    return buildArrowPolygons(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  if (loading) return <div className="status">Loading wafer data…</div>
  if (error)   return <div className="status error">Error: {error}</div>
  if (!waferArrays || !colors || !arrowPolygons) return null

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={waferArrays.n}
          positions={waferArrays.positions}
          colors={colors}
          arrowPolygons={arrowPolygons}
          data={data!}
          fieldParams={fieldParams}
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
        <FieldParamsPanel params={fieldParams} onApply={setFieldParams} />
        <DieInfoPanel selectedDie={selectedDie} data={data!} />
      </div>
    </div>
  )
}
