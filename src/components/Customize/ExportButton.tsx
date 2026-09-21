import { useState } from "react";
import type { Configuration, Parameter } from "../../types/template";
import { submitExport, pollUntilSettled, visibleConfiguration } from "../../api/exportClient";

interface ExportButtonProps {
  templateId: string;
  parameters: Parameter[];
  configuration: Configuration;
  fileName: string;
}

type ExportState =
  | { phase: "idle" }
  | { phase: "working"; message: string }
  | { phase: "error"; message: string };

export function ExportButton({ templateId, parameters, configuration, fileName }: ExportButtonProps) {
  const [state, setState] = useState<ExportState>({ phase: "idle" });

  async function handleExport() {
    setState({ phase: "working", message: "Preparing your file…" });
    try {
      const { jobId } = await submitExport(
        templateId,
        visibleConfiguration(parameters, configuration),
      );

      const final = await pollUntilSettled(jobId, (status) => {
        if (status.status === "queued") {
          setState({
            phase: "working",
            message:
              status.aheadInQueue > 0
                ? `In queue — ${status.aheadInQueue} ahead of you…`
                : "In queue…",
          });
        } else if (status.status === "rendering") {
          setState({ phase: "working", message: "Rendering your file…" });
        }
      });

      if (final.status === "done" && final.downloadUrl) {
        const a = document.createElement("a");
        a.href = final.downloadUrl;
        a.download = `${fileName}.stl`;
        a.click();
        setState({ phase: "idle" });
      } else {
        setState({ phase: "error", message: final.error ?? "Couldn't export this file." });
      }
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Couldn't export this file.",
      });
    }
  }

  return (
    <div className="export-control">
      <button
        className="export-button"
        disabled={state.phase === "working"}
        onClick={handleExport}
      >
        {state.phase === "working" ? state.message : "Export STL"}
      </button>
      {state.phase === "error" && <p className="export-error">{state.message}</p>}
    </div>
  );
}
