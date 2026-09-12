import { HashRouter, Route, Routes } from "react-router-dom";

import { AppHeader } from "./components/AppHeader";
import { DecisionPage } from "./pages/DecisionPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  return (
    <HashRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/trades/:tradeDigest" element={<DecisionPage />} />
        <Route path="*" element={<DecisionPage />} />
      </Routes>
    </HashRouter>
  );
}
