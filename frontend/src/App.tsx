import './App.css'
import {useState} from 'react'
import {useWaferData}   from './hooks/useWaferData.ts'
import {useGpuCompute}  from './hooks/useGpuCompute.ts'
import type {FieldParams} from './hooks/useWaferData.ts'
import WaferMapView     from './components/WaferMapView.tsx'
import ColorBar         from './components/ColorBar.tsx'
import DieInfoPanel     from './components/DieInfoPanel.tsx'
import type {SelectedDie} from './components/DieInfoPanel.tsx'
import FieldParamsPanel from './components/FieldParamsPanel.tsx'

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

  const {data, loading, error} = useWaferData(500000, fieldParams)
  const gpuBuffers = useGpuCompute(data, colorMin, colorMax)

  if (loading)                    return <div className="status">Loading wafer data…</div>
  if (error)                      return <div className="status error">Error: {error}</div>
  if (!data || !gpuBuffers)       return <div className="status">Initialising GPU…</div>

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={data.length / 6}
          gpuBuffers={gpuBuffers}
          data={data}
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
        <DieInfoPanel selectedDie={selectedDie} data={data} />
      </div>
    </div>
  )
}
