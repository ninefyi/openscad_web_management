import { useEffect, useRef, useState } from "react";
import {
  listTemplateImages,
  uploadTemplateImage,
  deleteTemplateImage,
  type TemplateImage,
} from "../api/adminClient";

const MAX_IMAGES = 3;

interface ImageCarouselProps {
  templateId: string;
}

/** Up to 3 reference images an Admin can attach to a Built-in Template,
 * beyond the single auto-captured thumbnail (see CONTEXT.md: Template
 * Image) — reviewed here as a one-at-a-time carousel with prev/next nav. */
export function ImageCarousel({ templateId }: ImageCarouselProps) {
  const [images, setImages] = useState<TemplateImage[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function reload() {
    listTemplateImages(templateId)
      .then((imgs) => {
        setImages(imgs);
        setIndex((i) => Math.min(i, Math.max(imgs.length - 1, 0)));
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, [templateId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadTemplateImage(templateId, file);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload this image.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(imageId: string) {
    if (!confirm("Delete this image?")) return;
    try {
      await deleteTemplateImage(templateId, imageId);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete this image.");
    }
  }

  if (!images) return null;

  const current = images[index];

  return (
    <div className="image-carousel">
      <h3>Images</h3>
      {error && <p className="account-error">{error}</p>}

      {images.length > 0 && current && (
        <div className="image-carousel-viewer">
          <button
            className="image-carousel-nav"
            disabled={images.length < 2}
            onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
            aria-label="Previous image"
          >
            ←
          </button>
          <img src={current.url} alt={`Template image ${index + 1}`} />
          <button
            className="image-carousel-nav"
            disabled={images.length < 2}
            onClick={() => setIndex((i) => (i + 1) % images.length)}
            aria-label="Next image"
          >
            →
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="image-carousel-meta">
          <span>
            {index + 1} / {images.length}
          </span>
          {current && (
            <button className="link-button" onClick={() => handleDelete(current.id)}>
              Delete this image
            </button>
          )}
        </div>
      )}

      {images.length === 0 && <p className="parameter-panel-empty">No images yet.</p>}

      {images.length < MAX_IMAGES ? (
        <label className="admin-link image-carousel-upload">
          {uploading ? "Uploading…" : "Add image"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            disabled={uploading}
            hidden
          />
        </label>
      ) : (
        <p className="parameter-panel-empty">Up to {MAX_IMAGES} images.</p>
      )}
    </div>
  );
}
