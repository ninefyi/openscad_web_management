import { useRef } from "react";
import { templateFromUpload } from "../../templates/registry";
import type { Template } from "../../types/template";

interface UploadCardProps {
  onUploaded: (template: Template) => void;
}

export function UploadCard({ onUploaded }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    onUploaded(templateFromUpload(file.name, text));
  }

  return (
    <button
      className="template-card upload-card"
      onClick={() => inputRef.current?.click()}
    >
      <div className="template-card-thumb template-card-thumb-upload">＋</div>
      <div className="template-card-body">
        <h3>Upload your own</h3>
        <p>Bring a .scad file with Customizer parameters</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".scad"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </button>
  );
}
