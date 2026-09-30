import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GalleryTemplate } from "../../api/client";

interface TemplateCardProps {
  template: GalleryTemplate;
}

// Template Images take the thumbnail's place when an Admin has uploaded any
// (see CONTEXT.md: Template Image); the auto-captured thumbnail is the
// fallback. Not a <Link> itself — the carousel's arrow buttons can't live
// inside a link, so the image area and the text each link on their own.
export function TemplateCard({ template }: TemplateCardProps) {
  const href = `/t/${template.id}`;

  return (
    <div className="template-card">
      <div className="template-card-thumb">
        {template.images.length > 0 ? (
          <CardCarousel template={template} href={href} />
        ) : (
          <Link to={href} tabIndex={-1} aria-hidden="true" className="template-card-thumb-link">
            {template.hasThumbnail ? (
              <img src={`/api/templates/${template.id}/thumbnail`} alt="" />
            ) : (
              <span className="template-card-thumb-placeholder">{template.name.charAt(0)}</span>
            )}
          </Link>
        )}
      </div>
      <Link className="template-card-body" to={href}>
        <h3>{template.name}</h3>
        {template.description && <p>{template.description}</p>}
        <p className="template-card-downloads">
          <span aria-hidden="true">↓</span> {template.downloadCount.toLocaleString()}{" "}
          {template.downloadCount === 1 ? "download" : "downloads"}
        </p>
      </Link>
    </div>
  );
}

function CardCarousel({ template, href }: { template: GalleryTemplate; href: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = template.images.length;

  function goTo(next: number) {
    const track = trackRef.current;
    if (!track) return;
    const wrapped = (next + count) % count;
    track.scrollTo({ left: wrapped * track.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="card-carousel">
      <div
        className="card-carousel-track"
        ref={trackRef}
        onScroll={(e) => {
          const track = e.currentTarget;
          setIndex(Math.round(track.scrollLeft / track.clientWidth));
        }}
      >
        {template.images.map((image, i) => (
          <Link
            key={image.id}
            className="card-carousel-slide"
            to={href}
            tabIndex={i === index ? 0 : -1}
            draggable={false}
          >
            <img
              src={image.url}
              alt={`${template.name} — image ${i + 1} of ${count}`}
              loading="lazy"
              draggable={false}
            />
          </Link>
        ))}
      </div>
      {count > 1 && (
        <>
          <button
            type="button"
            className="card-carousel-nav card-carousel-prev"
            onClick={() => goTo(index - 1)}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            type="button"
            className="card-carousel-nav card-carousel-next"
            onClick={() => goTo(index + 1)}
            aria-label="Next image"
          >
            ›
          </button>
          <div className="card-carousel-dots" aria-hidden="true">
            {template.images.map((image, i) => (
              <span key={image.id} className={i === index ? "active" : undefined} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
