import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Gallery } from "./components/Gallery/Gallery";
import { TemplatePage } from "./pages/TemplatePage";
import { AdminList } from "./admin/AdminList";
import { AdminEditor } from "./admin/AdminEditor";
import { Signup } from "./account/Signup";
import { Login } from "./account/Login";
import { MyDesigns } from "./account/MyDesigns";
import { AccountProvider } from "./state/AccountContext";

export default function App() {
  return (
    <AccountProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Gallery />} />
          <Route path="/t/:id" element={<TemplatePage />} />
          <Route path="/admin" element={<AdminList />} />
          <Route path="/admin/new" element={<AdminEditor />} />
          <Route path="/admin/:id" element={<AdminEditor />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/designs" element={<MyDesigns />} />
        </Routes>
      </BrowserRouter>
    </AccountProvider>
  );
}
