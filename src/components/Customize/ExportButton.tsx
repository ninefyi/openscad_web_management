import { useState } from "react";
import { Link } from "react-router-dom";
import type { Configuration, Parameter } from "../../types/template";
import { submitExport, pollUntilSettled, visibleConfiguration } from "../../api/exportClient";
import { useAccount } from "../../state/AccountContext";

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

// Export requires a signed-in Account (see CONTEXT.md: Export) — unlike
// Render on server, which stays anonymous-capable since it shares the same
// Export Job pipeline but never produces a download.
export function ExportButton({ templateId, parameters, configuration, fileName }: ExportButtonProps) {
  const [state, setState] = useState<ExportState>({ phase: "idle" });
  const { account } = useAccount();

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

  if (account === null) {
    return (
      <div className="export-control">
        <Link className="admin-link" to="/login">
          Sign in to export
        </Link>
      </div>
    );
  }

  return (
    <div className="export-control">
      <button
        className="export-button"
        disabled={state.phase === "working" || account === undefined}
        onClick={handleExport}
      >
        {state.phase === "working" ? state.message : "Export STL"}
      </button>
      {state.phase === "error" && <p className="export-error">{state.message}</p>}
    </div>
  );
}
