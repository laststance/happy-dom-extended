import { useRef, useState, type ChangeEvent } from 'react'

/** Profile field that previews the chosen avatar and shows its pixel size before the user saves.
 * Decoding the file with createImageBitmap and drawing it needs real image and Canvas support.
 * @returns A labelled PNG file input, a preview canvas and the decoded size.
 * @example <AvatarUploader />
 */
export function AvatarUploader() {
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [imageSize, setImageSize] = useState<string | null>(null)

  async function previewAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const bitmap = await createImageBitmap(file)
    try {
      const preview = previewRef.current
      preview
        ?.getContext('2d')
        ?.drawImage(bitmap, 0, 0, preview.width, preview.height)
      setImageSize(`${bitmap.width} × ${bitmap.height} px`)
    } finally {
      bitmap.close()
    }
  }

  return (
    <div>
      <label htmlFor="avatar">Avatar</label>
      <input
        id="avatar"
        type="file"
        accept="image/png"
        onChange={(event) => void previewAvatar(event)}
      />
      <canvas
        ref={previewRef}
        width={4}
        height={4}
        role="img"
        aria-label="Avatar preview"
      />
      {imageSize ? <p>{imageSize}</p> : null}
    </div>
  )
}
