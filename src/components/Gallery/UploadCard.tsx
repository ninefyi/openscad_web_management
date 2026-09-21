import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { templateFromUpload } from "../../templates/registry";

export function UploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function handleFile(file: File) {
    const text = await file.text();
    const template = templateFromUpload(file.name, text);
    navigate("/t/upload", { state: { template } });
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
