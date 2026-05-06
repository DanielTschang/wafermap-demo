import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = 'http://localhost:8080/api/wafer-data'

export function useWaferData(points = 500000) {
  const [data, setData]       = useState(null)   // Float32Array
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    axios.get(`${API_URL}?points=${points}`, { responseType: 'arraybuffer' })
      .then(res => {
        if (!cancelled) {
          setData(new Float32Array(res.data))
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [points])

  return { data, loading, error }
}
