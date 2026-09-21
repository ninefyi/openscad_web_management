import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Gallery } from "./components/Gallery/Gallery";
import { TemplatePage } from "./pages/TemplatePage";
import { UploadedTemplatePage } from "./pages/UploadedTemplatePage";
import { AdminList } from "./admin/AdminList";
import { AdminEditor } from "./admin/AdminEditor";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/t/upload" element={<UploadedTemplatePage />} />
        <Route path="/t/:id" element={<TemplatePage />} />
        <Route path="/admin" element={<AdminList />} />
        <Route path="/admin/new" element={<AdminEditor />} />
        <Route path="/admin/:id" element={<AdminEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
