/** Thumbnail strip for pasted/dropped/picked images (§4.4, max 10). */
import { X } from 'lucide-react'
import { useT } from '@/i18n'
import type { ImageAttachment } from '@shared/types'
import './Attachments.css'

export function Attachments({ images, onRemove }: { images: ImageAttachment[]; onRemove: (index: number) => void }) {
  const t = useT()
  if (images.length === 0) return null
  return (
    <div className="em-composer-attachments">
      {images.map((img, i) => (
        <div className="em-composer-attachment" key={i}>
          <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name || `attachment-${i}`} />
          <button type="button" className="em-composer-attachment__remove" aria-label={t('shell.composer.removeAttachment')} onClick={() => onRemove(i)}>
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  )
}
