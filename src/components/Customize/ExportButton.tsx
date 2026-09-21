interface ExportButtonProps {
  stl: ArrayBuffer | null;
  fileName: string;
}

export function ExportButton({ stl, fileName }: ExportButtonProps) {
  function handleExport() {
    if (!stl) return;
    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="export-button" disabled={!stl} onClick={handleExport}>
      Export STL
    </button>
  );
}
