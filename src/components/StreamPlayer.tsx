import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'

type PlayerState = 'loading' | 'ready' | 'error'

interface StreamPlayerProps {
  poster: string
  streamUrl: string
  title: string
}

const supportsNativeHls = () => {
  if (typeof document === 'undefined') {
    return false
  }

  const probe = document.createElement('video')
  return probe.canPlayType('application/vnd.apple.mpegurl') !== ''
}

export function StreamPlayer({ poster, streamUrl, title }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const unsupportedHls = streamUrl.endsWith('.m3u8') && !supportsNativeHls() && !Hls.isSupported()
  const [playerState, setPlayerState] = useState<PlayerState>(() =>
    unsupportedHls ? 'error' : 'loading',
  )
  const [errorMessage, setErrorMessage] = useState(() =>
    unsupportedHls ? 'Este navegador nao suporta o stream HLS.' : '',
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    let hls: Hls | null = null

    video.muted = true
    video.defaultMuted = true
    video.playsInline = true
    video.autoplay = true

    const markReady = () => setPlayerState('ready')
    const markError = () => {
      setPlayerState('error')
      setErrorMessage('Nao foi possivel carregar o video agora.')
    }
    const tryPlay = () => {
      void video.play().catch(() => {
        setPlayerState((current) => (current === 'loading' ? 'ready' : current))
      })
    }

    video.addEventListener('loadeddata', markReady)
    video.addEventListener('canplay', markReady)
    video.addEventListener('playing', markReady)
    video.addEventListener('error', markError)

    if (streamUrl.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        })

        hls.loadSource(streamUrl)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)
        hls.on(Hls.Events.LEVEL_LOADED, markReady)
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) {
            return
          }

          setPlayerState('error')
          setErrorMessage('O stream respondeu, mas nao abriu corretamente no navegador.')

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls?.startLoad()
            return
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls?.recoverMediaError()
            return
          }

          hls?.destroy()
          hls = null
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl
        video.load()
        tryPlay()
      } else {
        return () => {
          video.removeEventListener('loadeddata', markReady)
          video.removeEventListener('canplay', markReady)
          video.removeEventListener('playing', markReady)
          video.removeEventListener('error', markError)
        }
      }
    } else {
      video.src = streamUrl
      video.load()
      tryPlay()
    }

    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.removeEventListener('loadeddata', markReady)
      video.removeEventListener('canplay', markReady)
      video.removeEventListener('playing', markReady)
      video.removeEventListener('error', markError)
      hls?.destroy()
    }
  }, [reloadKey, streamUrl])

  return (
    <div className="analysis-video-media">
      <video
        ref={videoRef}
        className="analysis-video-player"
        controls
        muted
        autoPlay
        playsInline
        preload="auto"
        poster={poster}
        aria-label={title}
      />

      {playerState !== 'ready' && (
        <div className={`analysis-video-status ${playerState === 'error' ? 'is-error' : ''}`}>
          <strong>{playerState === 'loading' ? 'Abrindo stream...' : 'Falha no video'}</strong>
          <span>{playerState === 'loading' ? 'Conectando ao canal ao vivo.' : errorMessage}</span>
          {playerState === 'error' && !unsupportedHls && (
            <button
              type="button"
              className="analysis-video-retry"
              onClick={() => {
                setPlayerState('loading')
                setErrorMessage('')
                setReloadKey((current) => current + 1)
              }}
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}
    </div>
  )
}
