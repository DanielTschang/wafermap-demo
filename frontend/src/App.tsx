import './App.css'
import {useState, useCallback} from 'react'
import {useWaferData}   from './hooks/useWaferData.ts'
import {useGpuCompute}  from './hooks/useGpuCompute.ts'
import type {FieldParams} from './hooks/useWaferData.ts'
import WaferMapView     from './components/WaferMapView.tsx'
import ColorBar         from './components/ColorBar.tsx'
import DieInfoPanel     from './components/DieInfoPanel.tsx'
import type {SelectedDie} from './components/DieInfoPanel.tsx'
import FieldParamsPanel from './components/FieldParamsPanel.tsx'
import QuadrantView      from './components/QuadrantView.tsx'

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
  const [deviceReady, setDeviceReady] = useState(false)

  const {data, loading, error} = useWaferData(500000, fieldParams)

  // Gate compute on device being ready — DeckGL creates the device, then notifies us
  const gpuBuffers = useGpuCompute(deviceReady ? data : null, colorMin, colorMax)

  const handleDeviceReady = useCallback(() => setDeviceReady(true), [])

  if (loading) return <div className="status">Loading wafer data…</div>
  if (error)   return <div className="status error">Error: {error}</div>

  return (
    <div className="layout">
      <div className="main-area">
        <div className="map-area">
          <WaferMapView
            n={gpuBuffers && data ? data.length / 6 : 0}
            gpuBuffers={gpuBuffers}
            data={data}
            fieldParams={fieldParams}
            onDieClick={setSelectedDie}
            onDeviceReady={handleDeviceReady}
          />
        </div>
        <div className="quadrant-area">
          <QuadrantView data={data} />
        </div>
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
