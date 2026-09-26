import { useEffect, useState } from "react";
import { listTemplateImages, type TemplateImage } from "../../api/client";

interface ImageGalleryProps {
  templateId: string;
}

/** Read-only customer-facing view of a Template's Template Images — the
 * Admin-uploaded reference photos of a printed result (see CONTEXT.md:
 * Template Image). Same one-at-a-time carousel as the Admin Panel's, minus
 * the upload/delete controls that belong to Admin only. */
export function ImageGallery({ templateId }: ImageGalleryProps) {
  const [images, setImages] = useState<TemplateImage[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listTemplateImages(templateId)
      .then((imgs) => {
        if (!cancelled) setImages(imgs);
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  if (!images || images.length === 0) return null;

  const current = images[index];

  return (
    <div className="image-carousel">
      <h3>Images</h3>
      <div className="image-carousel-viewer">
        <button
          className="image-carousel-nav"
          disabled={images.length < 2}
          onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
          aria-label="Previous image"
        >
          ←
        </button>
        <img src={current.url} alt={`${templateId} reference ${index + 1}`} />
        <button
          className="image-carousel-nav"
          disabled={images.length < 2}
          onClick={() => setIndex((i) => (i + 1) % images.length)}
          aria-label="Next image"
        >
          →
        </button>
      </div>
      <div className="image-carousel-meta">
        <span>
          {index + 1} / {images.length}
        </span>
      </div>
    </div>
  );
}
