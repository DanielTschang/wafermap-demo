import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = 'http://localhost:8080/api/wafer-data'

export interface FieldParams {
  fieldSizeX: number
  fieldSizeY: number
  fieldOffsetX: number
  fieldOffsetY: number
}

interface WaferDataResult {
  data: Float32Array | null
  loading: boolean
  error: string | null
}

export function useWaferData(points = 500000, fieldParams?: FieldParams): WaferDataResult {
  const [data, setData]       = useState<Float32Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ points: String(points) })
    if (fieldParams) {
      params.set('fieldSizeX',   String(fieldParams.fieldSizeX))
      params.set('fieldSizeY',   String(fieldParams.fieldSizeY))
      params.set('fieldOffsetX', String(fieldParams.fieldOffsetX))
      params.set('fieldOffsetY', String(fieldParams.fieldOffsetY))
    }

    axios.get<ArrayBuffer>(`${API_URL}?${params}`, { responseType: 'arraybuffer' })
      .then(res => {
        if (!cancelled) {
          setData(new Float32Array(res.data))
          setLoading(false)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [points, fieldParams])

  return { data, loading, error }
}
